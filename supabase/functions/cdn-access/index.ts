/**
 * cdn-access — the CDN orchestrator.
 *
 * Authenticates the caller's Supabase user JWT, then issues access to private
 * B2 objects WITHOUT ever holding B2 credentials:
 *
 *   op = "delivery"  → mints a short-lived Ed25519 view token and returns a
 *                      cdn.mintonix.com URL. The client streams it through the
 *                      Worker's cached data plane.
 *   op = "upload"    → calls the Worker's /presign control plane (service-token
 *                      auth) for a presigned PUT, which the client uploads
 *                      DIRECTLY to B2.
 *   op = "delete"    → calls /presign for a presigned DELETE; client then DELETEs
 *                      the object on B2. Any key under the caller's namespace
 *                      (no basename allowlist — users may remove pipeline
 *                      outputs when deleting a match).
 *
 * Secrets this function holds (set with `supabase secrets set`):
 *   CDN_JWT_PRIVATE_KEY     Ed25519 PKCS8 PEM — mints view tokens (NOT a B2 cred)
 *   PRESIGN_SERVICE_TOKEN   shared secret to call the Worker's /presign
 *   CDN_BASE_URL            e.g. https://cdn.mintonix.com  (delivery origin)
 *   CDN_PRESIGN_URL         e.g. https://cdn.mintonix.com/presign
 *   DELIVERY_TOKEN_TTL_SECONDS  optional, default 300
 *   CORS_ALLOW_ORIGIN       production: set to the app origin (default * for local)
 * SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
 *
 * AUTHORIZATION: authn + namespace check. The caller must be a logged-in user
 * (getUser) AND `key` must live under their own `users/<uid>/` prefix, so a user
 * can neither presign a PUT/DELETE over nor mint a delivery token for another
 * user's object. Cross-user reads (sharing) are a future read-side grant — see
 * the TODO(sharing) in the handler and the README.
 */

// npm: (not esm.sh) — CI/deploy bundle must not depend on a live CDN (522s).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

interface RequestBody {
  op?: "delivery" | "upload" | "delete";
  key?: string;
  expiresIn?: number;
}

// Production should set CORS_ALLOW_ORIGIN to the app origin; * is local-dev only.
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

/** Client-writable basenames under users/<uid>/<match_id>/. Pipeline outputs are service-presigned only. */
const UPLOAD_BASENAME_ALLOW = new Set([
  "original.mp4",
  "annotation.json",
]);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Same key hygiene the Worker enforces — reject traversal / absolute keys.
function isValidKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("..")) return false;
  return /^[A-Za-z0-9!_.*'()/\-]+$/.test(key);
}

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

async function mintDeliveryUrl(key: string): Promise<Response> {
  const ttl = Number(Deno.env.get("DELIVERY_TOKEN_TTL_SECONDS") ?? "300");
  const base = Deno.env.get("CDN_BASE_URL");
  if (!base) return json(500, { error: "CDN_BASE_URL not configured" });

  const token = await new SignJWT({ key })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(await getSigningKey());

  const url = `${base.replace(/\/$/, "")}/${key}?t=${token}`;
  return json(200, {
    op: "delivery",
    url,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  });
}

async function mintPresigned(
  key: string,
  b2Op: "PUT" | "DELETE",
  clientOp: "upload" | "delete",
): Promise<Response> {
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const serviceToken = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !serviceToken) {
    return json(500, { error: "presign control plane not configured" });
  }

  const resp = await fetch(presignUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({ key, op: b2Op }),
  });

  if (!resp.ok) {
    return json(502, { error: "presign failed", status: resp.status });
  }
  // { url, method, key, expiresAt } from the Worker.
  return json(200, { op: clientOp, ...(await resp.json()) });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  // --- Authenticate the caller ----------------------------------------------
  const authHeader = request.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json(401, { error: "Not authenticated" });

  // --- Parse + validate -----------------------------------------------------
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const key = body.key ?? "";
  if (!isValidKey(key)) return json(400, { error: "Invalid or missing key" });

  // --- Authorize the key ----------------------------------------------------
  // User objects live under `users/<uid>/<match_id>/…` (constructable prefix;
  // see SUPABASE.md). Access control is a prefix check with no DB lookup: a
  // caller may only touch keys inside their own `users/<uid>/` namespace. This
  // gates BOTH the write path (can't presign a PUT over someone else's object)
  // and the read path (can't mint a delivery token for someone else's object).
  // System/BWF objects under `bwf/<match_id>/` are never writable here.
  //
  // Compute-worker writes (normalized.mp4, thumbnail.jpg) do NOT come through
  // here — they're minted by the service-authed job dispatcher, which writes
  // into the match prefix directly.
  //
  // TODO(sharing): to serve another user's object (public/shared links), look
  // `key` up in a `shares` table on the `delivery` path and mint a token even
  // when the prefix isn't the caller's. The key never moves out of the owner's
  // namespace; sharing is purely a read-side grant.
  const namespace = `users/${user.id}/`;
  if (!key.startsWith(namespace)) {
    return json(403, { error: "Forbidden: key is outside your namespace" });
  }

  // Expect users/<uid>/<match_id>/<basename> (at least 4 segments) for mutate ops.
  const parts = key.split("/");
  const underMatch = parts.length >= 4 && !!parts[2];

  switch (body.op) {
    case "delivery":
      return mintDeliveryUrl(key);
    case "upload": {
      // Allowlist basenames so clients cannot overwrite pipeline outputs
      // (normalized.mp4, detections.json, …) under their namespace.
      const basename = key.slice(key.lastIndexOf("/") + 1);
      if (!UPLOAD_BASENAME_ALLOW.has(basename)) {
        return json(403, {
          error: `upload key basename must be one of: ${[...UPLOAD_BASENAME_ALLOW].join(", ")}`,
        });
      }
      if (!underMatch) {
        return json(400, { error: "upload key must be users/<uid>/<match_id>/<file>" });
      }
      return mintPresigned(key, "PUT", "upload");
    }
    case "delete": {
      // No basename allowlist: users may remove any object under their match
      // prefix (original, annotation, pipeline outputs) when deleting a match.
      if (!underMatch) {
        return json(400, { error: "delete key must be users/<uid>/<match_id>/<file>" });
      }
      return mintPresigned(key, "DELETE", "delete");
    }
    default:
      return json(400, { error: 'op must be "delivery", "upload", or "delete"' });
  }
});
