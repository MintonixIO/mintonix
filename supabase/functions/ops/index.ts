/**
 * ops — service-only control plane (pipeline token auth).
 *
 *   POST /functions/v1/ops/set-stage   (verify_jwt=false; token auth in-function)
 *     Body: {
 *       match_id: string,
 *       stage: "normalize" | "detect" | "analyze",
 *       enqueue?: boolean,               // default true
 *       cancel_live?: boolean,           // default true
 *       purge?: boolean                  // default false — delete stage+later B2 outputs
 *     }
 *     -> 200 {
 *       ok, match_id, job_id, stage, enqueue, …ops_set_stage fields,
 *       purged?: string[]
 *     }
 *
 *   POST /functions/v1/ops/model-urls
 *     Body: { keys: string[] }   // each key must be under models/<file>
 *     -> 200 {
 *       urls: { [key]: "https://cdn…/<key>?t=<jwt>" },
 *       expiresAt: iso
 *     }
 *     Mints short-lived CDN *delivery* tokens (data plane) so CI can pull
 *     product weights through Cloudflare (Bandwidth Alliance free egress).
 *     Does NOT return direct B2 presigns.
 *
 * Dual truth: jobs.stage/status is what runs next; B2 objects are stage evidence.
 *
 * Flow set-stage (never irreversible DELETE before DB accept; never enqueue while purging):
 *   purge=false → one ops_set_stage(enqueue as requested)
 *   purge=true  → ops_set_stage(enqueue=false) → LIST+DELETE →
 *                 if user enqueue=true, second ops_set_stage(enqueue=true)
 *
 * Secrets:
 *   PIPELINE_SERVICE_TOKEN  (same auth path as matches-ingest)
 *   CDN_PRESIGN_URL, PRESIGN_SERVICE_TOKEN  (only when purge=true)
 *   CDN_JWT_PRIVATE_KEY, CDN_BASE_URL       (model-urls delivery mint)
 *   MODELS_DELIVERY_TOKEN_TTL_SECONDS       optional, default 1800
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY injected by the platform.
 */

// npm: (not esm.sh) — CI/deploy bundle must not depend on a live CDN (522s).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";
import {
  isStage,
  outputsToPurge,
  relativeBasename,
  type Stage,
} from "./stage_outputs.ts";

// Re-export pure helpers for callers/tests that import from index.
export { outputsToPurge, relativeBasename, isStage } from "./stage_outputs.ts";
export {
  isModelCacheKey,
  MODEL_CACHE_PREFIX,
} from "./model_urls.ts";
import { isModelCacheKey, MODEL_CACHE_PREFIX } from "./model_urls.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time compare via SHA-256 so length mismatch does not short-circuit. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function cdnControl(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const token = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !token) throw new Error("presign_not_configured");
  const resp = await fetch(presignUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    console.error(JSON.stringify({
      event: "ops.cdn_error",
      op: body.op,
      status: resp.status,
      detail,
    }));
    throw new Error(`cdn_${String(body.op ?? "op").toLowerCase()}_failed`);
  }
  return await resp.json() as Record<string, unknown>;
}

async function listPrefixKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      op: "LIST",
      prefix,
      maxKeys: 1000,
    };
    if (token) body.continuationToken = token;
    const result = await cdnControl(body);
    const batch = (result.keys as string[] | undefined) ?? [];
    keys.push(...batch);
    if (!result.isTruncated) break;
    token = result.nextContinuationToken as string | undefined;
    if (!token) break;
  }
  return keys;
}

async function deleteB2Key(key: string): Promise<void> {
  const signed = await cdnControl({ op: "DELETE", key });
  const url = signed.url as string;
  const resp = await fetch(url, { method: "DELETE" });
  if (!resp.ok && resp.status !== 404 && resp.status !== 204) {
    console.error(JSON.stringify({
      event: "ops.delete_http_error",
      key,
      status: resp.status,
    }));
    throw new Error("delete_failed");
  }
}

type RpcResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; data: Record<string, unknown> };

async function callOpsSetStage(
  service: ReturnType<typeof serviceClient>,
  args: {
    matchId: string;
    stage: string;
    enqueue: boolean;
    cancelLive: boolean;
  },
): Promise<RpcResult> {
  const { data, error } = await service.rpc("ops_set_stage", {
    p_match_id: args.matchId,
    p_stage: args.stage,
    p_enqueue: args.enqueue,
    p_cancel_live: args.cancelLive,
  });
  if (error) {
    console.error(JSON.stringify({
      event: "ops.rpc_error",
      message: error.message,
      match_id: args.matchId,
    }));
    return {
      ok: false,
      status: 500,
      data: { error: "ops_set_stage_failed", code: "rpc_error" },
    };
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.rejected === true || result.ok === false) {
    return { ok: false, status: 409, data: result };
  }
  return { ok: true, data: result };
}

async function purgeStageOutputs(
  prefix: string,
  stage: Stage,
): Promise<{ ok: true; purged: string[] } | { ok: false; code: string; purged: string[] }> {
  const purged: string[] = [];
  const want = outputsToPurge(stage);
  let keys: string[];
  try {
    keys = await listPrefixKeys(prefix);
  } catch (e) {
    console.error(JSON.stringify({ event: "ops.list_failed", error: String(e), prefix }));
    return { ok: false, code: "cdn_list_failed", purged };
  }

  for (const key of keys) {
    const base = relativeBasename(key, prefix);
    if (base === null || !want.has(base)) continue;
    try {
      await deleteB2Key(key);
      purged.push(key);
    } catch (e) {
      console.error(JSON.stringify({
        event: "ops.delete_failed",
        key,
        error: String(e),
      }));
      return { ok: false, code: "cdn_delete_failed", purged };
    }
  }
  return { ok: true, purged };
}

interface SetStageBody {
  match_id?: string;
  stage?: string;
  enqueue?: boolean;
  cancel_live?: boolean;
  purge?: boolean;
}

async function handleSetStage(body: SetStageBody): Promise<Response> {
  const matchIdIn = (body.match_id ?? "").trim();
  const stage = (body.stage ?? "").trim();
  const enqueue = body.enqueue !== false;
  const cancelLive = body.cancel_live !== false;
  const purge = body.purge === true;

  if (!matchIdIn) return json(400, { error: "match_id is required", code: "bad_request" });
  if (!isStage(stage)) {
    return json(400, { error: "stage must be normalize|detect|analyze", code: "bad_request" });
  }

  const service = serviceClient();

  const { data: match, error: matchErr } = await service
    .from("matches")
    .select("id, owner_id")
    .eq("id", matchIdIn)
    .maybeSingle();
  if (matchErr) {
    console.error(JSON.stringify({ event: "ops.match_lookup_error", message: matchErr.message }));
    return json(500, { error: "match_lookup_failed", code: "db_error" });
  }
  if (!match) return json(404, { error: "match_not_found", code: "not_found" });

  // Prefer committed row identity for prefix construction.
  const matchId = match.id as string;
  const ownerId = match.owner_id as string | null;
  const prefix = ownerId
    ? `users/${ownerId}/${matchId}/`
    : `bwf/${matchId}/`;

  // No purge: single RPC with requested enqueue.
  if (!purge) {
    const result = await callOpsSetStage(service, {
      matchId,
      stage,
      enqueue,
      cancelLive,
    });
    if (!result.ok) return json(result.status, result.data);
    return json(200, { ...result.data, purged: [] });
  }

  // Purge path: always set stage with enqueue=false first so dispatch cannot
  // race LIST+DELETE. Then purge. Then optional second RPC if user wanted enqueue.
  const staged = await callOpsSetStage(service, {
    matchId,
    stage,
    enqueue: false,
    cancelLive,
  });
  if (!staged.ok) return json(staged.status, staged.data);

  const purgeResult = await purgeStageOutputs(prefix, stage as Stage);
  if (!purgeResult.ok) {
    return json(502, {
      error: purgeResult.code === "cdn_list_failed" ? "list_failed" : "delete_failed",
      code: purgeResult.code,
      stage_set: true,
      enqueue_pending: enqueue,
      ...staged.data,
      // Reflect actual post-RPC state (not dispatchable until enqueue RPC).
      enqueue: false,
      purged: purgeResult.purged,
    });
  }

  if (!enqueue) {
    return json(200, {
      ...staged.data,
      enqueue: false,
      purged: purgeResult.purged,
    });
  }

  // Second RPC: put job on jobs_interactive only after purge finished.
  const queued = await callOpsSetStage(service, {
    matchId,
    stage,
    enqueue: true,
    cancelLive: true, // live is non-dispatchable queued from step 1
  });
  if (!queued.ok) {
    return json(queued.status === 409 ? 500 : queued.status, {
      ...queued.data,
      code: queued.data.code ?? "purge_ok_enqueue_failed",
      stage_set: true,
      purge_ok: true,
      purged: purgeResult.purged,
      parked: staged.data,
    });
  }

  return json(200, {
    ...queued.data,
    purged: purgeResult.purged,
    purged_then_enqueued: true,
    canceled_job_id: staged.data.canceled_job_id ?? queued.data.canceled_job_id,
  });
}

/**
 * Auth: x-pipeline-token must match PIPELINE_SERVICE_TOKEN and/or the service
 * role key. CI uses GitHub `SUPABASE_SERVICE_KEY` (service role) with the same
 * header; local tooling may still use a dedicated pipeline token. Either is
 * accepted so both naming schemes work without dual edge secrets.
 */
async function authorizeOps(request: Request): Promise<Response | null> {
  const pipeline = Deno.env.get("PIPELINE_SERVICE_TOKEN") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!pipeline && !serviceRole) {
    return json(500, { error: "pipeline_token_not_configured", code: "config_error" });
  }
  const provided = request.headers.get("x-pipeline-token") ?? "";
  if (!provided) {
    return json(401, { error: "bad_token", code: "unauthorized" });
  }
  const okPipeline = pipeline ? await timingSafeEqual(provided, pipeline) : false;
  const okService = serviceRole ? await timingSafeEqual(provided, serviceRole) : false;
  if (!okPipeline && !okService) {
    return json(401, { error: "bad_token", code: "unauthorized" });
  }
  return null;
}

// ---------------------------------------------------------------- model-urls

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
let cachedSigningKey: SigningKey | undefined;

async function getSigningKey(): Promise<SigningKey> {
  if (!cachedSigningKey) {
    const pem = Deno.env.get("CDN_JWT_PRIVATE_KEY");
    if (!pem) throw new Error("CDN_JWT_PRIVATE_KEY is not set");
    cachedSigningKey = await importPKCS8(pem, "EdDSA");
  }
  return cachedSigningKey;
}

async function mintDeliveryUrl(key: string, ttlSec: number): Promise<string> {
  const base = Deno.env.get("CDN_BASE_URL");
  if (!base) throw new Error("CDN_BASE_URL is not set");
  const token = await new SignJWT({ key })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(await getSigningKey());
  return `${base.replace(/\/$/, "")}/${key}?t=${token}`;
}

interface ModelUrlsBody {
  keys?: string[];
}

/**
 * Mint CDN data-plane delivery URLs for product model weights.
 * Keys must pass isModelCacheKey (models/<filename>).
 */
async function handleModelUrls(body: ModelUrlsBody): Promise<Response> {
  const keys = body.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return json(400, {
      error: "keys must be a non-empty array",
      code: "bad_request",
    });
  }
  if (keys.length > 32) {
    return json(400, { error: "too many keys (max 32)", code: "bad_request" });
  }

  const bad = keys.filter((k) => typeof k !== "string" || !isModelCacheKey(k));
  if (bad.length) {
    return json(403, {
      error: `keys must be under ${MODEL_CACHE_PREFIX}<filename>`,
      code: "forbidden_key",
      rejected: bad.slice(0, 8),
    });
  }

  const ttl = Number(
    Deno.env.get("MODELS_DELIVERY_TOKEN_TTL_SECONDS") ??
      Deno.env.get("DELIVERY_TOKEN_TTL_SECONDS") ??
      "1800",
  );
  const ttlSec = Number.isFinite(ttl) && ttl > 0 ? Math.min(ttl, 7200) : 1800;

  try {
    const urls: Record<string, string> = {};
    for (const key of keys) {
      urls[key] = await mintDeliveryUrl(key, ttlSec);
    }
    return json(200, {
      op: "model-urls",
      urls,
      expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      ttl_sec: ttlSec,
    });
  } catch (e) {
    console.error(JSON.stringify({
      event: "ops.model_urls_error",
      error: e instanceof Error ? e.message : String(e),
    }));
    return json(500, { error: "mint_failed", code: "config_error" });
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed", code: "bad_method" });

  const authFail = await authorizeOps(request);
  if (authFail) return authFail;

  const path = new URL(request.url).pathname;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_json", code: "bad_request" });
  }

  if (path.endsWith("/model-urls")) {
    return handleModelUrls(body as ModelUrlsBody);
  }

  // Require explicit /set-stage subpath (no bare /ops).
  if (!path.endsWith("/set-stage")) {
    return json(404, { error: "unknown_route", code: "not_found" });
  }

  return handleSetStage(body as SetStageBody);
});
