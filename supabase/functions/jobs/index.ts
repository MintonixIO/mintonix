/**
 * jobs — the pipeline's job-lifecycle engine. One function, two routes,
 * because dispatch opens every stage and callback closes it, and they share
 * the pieces that must never drift apart: the stage routing table, the HMAC
 * job token (dispatch mints, callback verifies), and the queue semantics.
 *
 *   POST /functions/v1/jobs/dispatch    (cron / manual; x-pipeline-token auth)
 *     Pops queued jobs (interactive before bulk) via the dispatch_next_job
 *     RPC, presigns every input/output through the CDN Worker's /presign
 *     control plane, and POSTs the stage envelope to the vast serverless
 *     endpoint in the background. Body (all optional):
 *       { "max": 1, "vt": 10800, "max_running": 2 }
 *     -> 200 { "dispatched": [ { job_id, stage, attempt } ] }
 *
 *   POST /functions/v1/jobs/callback    (vast worker; Bearer job-token auth)
 *     The worker's only way to report. Verifies the single-use HMAC token,
 *     then settles the stage through the complete_job RPC in one transaction:
 *     assets registered, job terminal (or re-queued for retry), videos rolled
 *     up, next stage enqueued. First terminal write wins — replays no-op.
 *
 * Deployed with verify_jwt=false (the worker has no Supabase JWT), so EACH
 * route enforces its own credential and unmatched paths 404.
 *
 * Trust model: the vast worker receives presigned URLs + this job token and
 * nothing else. The token is bound to (job_id, attempt): a callback from a
 * superseded attempt is rejected, which is what makes retry-safe single-use
 * work without a token table.
 *
 * The dispatch → vast call runs via EdgeRuntime.waitUntil because routing can
 * wait minutes for a GPU to spin up, and the job itself runs far longer than
 * any edge function. If this background task is killed mid-wait, nothing is
 * lost: the worker reports via callback on its own, and a job that never got
 * a worker reappears when its queue visibility timeout expires.
 *
 * Secrets:
 *   PIPELINE_SERVICE_TOKEN  auth for /dispatch (shared with videos-ingest)
 *   JOB_TOKEN_SECRET        HMAC secret for the callback token
 *   CDN_PRESIGN_URL         CDN Worker control plane (e.g. https://…/presign)
 *   PRESIGN_SERVICE_TOKEN   auth for /presign (shared with cdn-access)
 *   VAST_ENDPOINT_NAME      vast serverless endpoint name (exact string)
 *   VAST_API_KEY            vast ACCOUNT API key. The endpoint-scoped signed
 *                           key that /route/ actually authenticates with is
 *                           resolved from it at runtime (it expires weekly,
 *                           so it must never be stored as a secret)
 *   VAST_AUTOSCALER_URL     optional, default https://run.vast.ai
 *   VAST_TLS_CA             optional PEM: vast's self-signed worker CA
 *                           (jvastai_root.cer); without it the endpoint must
 *                           run with USE_SSL=false / UNSECURED=true
 *   PRESIGN_EXPIRY_SECONDS  optional, default 14400 — raise the CDN Worker's
 *                           PRESIGN_MAX_EXPIRY_SECONDS to match, or URLs
 *                           expire mid-job
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY injected by the platform.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { jwtVerify, SignJWT } from "https://esm.sh/jose@5.9.6";

const MAX_ATTEMPTS = 3; // dispatches per job before it's terminally failed
const TOKEN_AUD = "jobs-callback";
const ROUTE_DEADLINE_MS = 240_000; // GPU cold start budget within waitUntil

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ---------------------------------------------------------------- presign

async function presign(key: string, op: "GET" | "PUT"): Promise<string> {
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const token = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !token) throw new Error("presign control plane not configured");
  const expiresIn = Number(Deno.env.get("PRESIGN_EXPIRY_SECONDS") ?? "14400");
  const resp = await fetch(presignUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key, op, expiresIn }),
  });
  if (!resp.ok) throw new Error(`presign ${op} ${key} failed: ${resp.status}`);
  const { url } = await resp.json() as { url: string };
  return url;
}

// ---------------------------------------------------------------- job token

function tokenSecret(): Uint8Array {
  const secret = Deno.env.get("JOB_TOKEN_SECRET");
  if (!secret) throw new Error("JOB_TOKEN_SECRET not configured");
  return new TextEncoder().encode(secret);
}

interface JobClaims {
  job_id: string;
  video_id: string;
  attempt: number;
}

function mintJobToken(claims: JobClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(tokenSecret());
}

// ---------------------------------------------------------------- stages

/** What dispatch_next_job returns for one popped job. */
interface DispatchedJob {
  job_id: string;
  stage: string;
  attempt: number;
  params: Record<string, unknown>;
  priority: number;
  queue: string;
  video_id: string;
  source_kind: string;
  source_url: string | null;
  b2_prefix: string;
  assets: Record<string, string>; // kind -> b2_key
}

/** The worker's callback body: {request_id, status, error?, …stage result}. */
type CallbackBody = Record<string, unknown> & {
  request_id?: string;
  status?: string;
  error?: string;
};

interface Settlement {
  assets: Array<Record<string, unknown>>;
  video: Record<string, unknown>;
  next: { stage: string; params: Record<string, unknown> } | null;
}

/**
 * The stage routing table — the one place that knows, per stage, how to turn
 * a job row into a worker envelope and a worker result into DB writes + the
 * next stage. detect and analyze slot in here once their worker contracts
 * are pinned; until then normalize is terminal and completing it makes the
 * video ready.
 */
const STAGES: Record<string, {
  route: string;
  buildEnvelope(job: DispatchedJob, token: string): Promise<Record<string, unknown>>;
  settle(job: DispatchedJob, body: CallbackBody, ok: boolean): Settlement;
}> = {
  normalize: {
    route: "/normalize/sync",

    async buildEnvelope(job, token) {
      const prefix = job.b2_prefix;
      const env: Record<string, unknown> = {
        request_id: job.job_id,
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/jobs/callback`,
        callback_token: token,
      };
      // Source: B2 is canonical the moment original.mkv exists (a retry never
      // refetches YouTube); a first-attempt youtube job downloads via yt-dlp
      // and MUST archive the pristine original before anything can fail.
      if (job.assets.original) {
        env.input_url = await presign(job.assets.original, "GET");
      } else if (job.source_kind === "youtube" && job.source_url) {
        env.input_url = job.source_url;
        env.original_upload_url = await presign(`${prefix}original.mkv`, "PUT");
      } else {
        throw new Error("no input: no original asset registered and source is not youtube");
      }
      env.output_upload_url = await presign(`${prefix}normalized.mp4`, "PUT");
      env.thumbnail_upload_url = await presign(`${prefix}thumbnail.jpg`, "PUT");
      const vfc = job.params?.valid_frames_config;
      if (vfc) {
        env.valid_frames_config = vfc;
        env.valid_frames_upload_url = await presign(`${prefix}valid.mp4`, "PUT");
        env.manifest_upload_url = await presign(`${prefix}frame_manifest.csv`, "PUT");
      }
      return env;
    },

    settle(job, body, ok) {
      const prefix = job.b2_prefix;
      const assets: Array<Record<string, unknown>> = [];
      // The original archive is real even when the job then failed (that's
      // the GPU-gate design: archive first, so the retry sources from B2).
      if (job.source_kind === "youtube" && (ok || body.original_archived === true)) {
        assets.push({
          kind: "original",
          b2_key: job.assets.original ?? `${prefix}original.mkv`,
          meta: body.source ? { probe: body.source } : {},
        });
      }
      if (ok) {
        const { width, height, fps, codec, audio_codec, pixel_fmt, duration, elapsed_sec } = body;
        assets.push({
          kind: "normalized",
          b2_key: `${prefix}normalized.mp4`,
          bytes: body.file_size,
          meta: { width, height, fps, codec, audio_codec, pixel_fmt, duration, elapsed_sec },
        });
        if (body.thumbnail) {
          assets.push({
            kind: "thumbnail",
            b2_key: `${prefix}thumbnail.jpg`,
            bytes: (body.thumbnail as Record<string, unknown>).file_size,
            meta: body.thumbnail,
          });
        }
        if (body.valid_frames) {
          const vf = body.valid_frames as Record<string, unknown>;
          assets.push({ kind: "valid", b2_key: `${prefix}valid.mp4`, bytes: vf.file_size, meta: vf });
          assets.push({
            kind: "frame_manifest",
            b2_key: `${prefix}frame_manifest.csv`,
            bytes: vf.manifest_file_size,
          });
        }
      }
      // detect is next once its dispatcher contract lands; today normalize
      // completing means the video is ready.
      const next = null;
      const video = ok
        ? {
          status: next ? "processing" : "ready",
          duration_sec: body.duration,
          width: body.width,
          height: body.height,
          fps: body.fps,
        }
        : {};
      return { assets, video, next };
    },
  },
};

// ---------------------------------------------------------------- vast

// Vast workers serve TLS signed by vast's own CA. With VAST_TLS_CA set we
// trust exactly that CA; otherwise fall back to the default fetch (which
// requires the endpoint to run UNSECURED / USE_SSL=false).
let vastClient: Deno.HttpClient | null | undefined;
function getVastClient(): Deno.HttpClient | undefined {
  if (vastClient !== undefined) return vastClient ?? undefined;
  const ca = Deno.env.get("VAST_TLS_CA");
  if (!ca) {
    vastClient = null;
    return undefined;
  }
  try {
    vastClient = Deno.createHttpClient({ caCerts: [ca] });
  } catch (e) {
    console.warn(`VAST_TLS_CA set but createHttpClient unavailable (${e}); using default TLS roots`);
    vastClient = null;
  }
  return vastClient ?? undefined;
}

// /route/ authenticates with an ENDPOINT-scoped signed key, not the account
// key — and vast rotates it (observed expiry: ~1 week), so it can't live in a
// secret. Resolve it from the account key via the console API the way the
// vastai SDK does, and cache it per isolate well under its lifetime.
let endpointKeyCache: { name: string; key: string; fetchedAt: number } | null = null;

async function resolveEndpointKey(endpointName: string, accountKey: string): Promise<string> {
  const now = Date.now();
  if (
    endpointKeyCache && endpointKeyCache.name === endpointName &&
    now - endpointKeyCache.fetchedAt < 3600_000
  ) {
    return endpointKeyCache.key;
  }
  const resp = await fetch("https://console.vast.ai/api/v0/endptjobs/", {
    headers: { Authorization: `Bearer ${accountKey}` },
  });
  if (!resp.ok) throw new Error(`vast endptjobs failed: ${resp.status}`);
  const data = await resp.json() as {
    results?: Array<{ endpoint_name: string; api_key: string }>;
  };
  const match = data.results?.find((r) => r.endpoint_name === endpointName);
  if (!match) throw new Error(`vast endpoint '${endpointName}' not found on this account`);
  endpointKeyCache = { name: endpointName, key: match.api_key, fetchedAt: now };
  return match.api_key;
}

/**
 * The vast serverless protocol (vastai-sdk client.py/endpoint.py): poll
 * POST {autoscaler}/route/ {endpoint, api_key, cost, request_idx,
 * replay_timeout} until the response carries a worker `url` (that response
 * body IS the auth_data), then POST {url}{route} with
 * {auth_data, session_id: null, payload: {"input": envelope}}.
 *
 * We do not wait for the worker's response body — the job runs for many
 * minutes and reports through /jobs/callback from inside its own thread. An
 * early return here (4xx/5xx) is logged as it means the job never started.
 */
async function invokeVast(route: string, envelope: Record<string, unknown>, jobId: string): Promise<void> {
  const endpoint = Deno.env.get("VAST_ENDPOINT_NAME");
  const accountKey = Deno.env.get("VAST_API_KEY");
  if (!endpoint || !accountKey) throw new Error("VAST_ENDPOINT_NAME / VAST_API_KEY not configured");
  const apiKey = await resolveEndpointKey(endpoint, accountKey);
  const autoscaler = Deno.env.get("VAST_AUTOSCALER_URL") ?? "https://run.vast.ai";

  let requestIdx = 0;
  let auth: Record<string, unknown> | null = null;
  let delay = 1000;
  const deadline = Date.now() + ROUTE_DEADLINE_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(`${autoscaler}/route/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        endpoint,
        api_key: apiKey,
        cost: 10000, // matches the worker's NORMALIZE_WORKLOAD weight
        request_idx: requestIdx,
        replay_timeout: 60,
      }),
    });
    if (!resp.ok) {
      throw new Error(`vast /route/ failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    }
    const body = await resp.json() as Record<string, unknown>;
    requestIdx = (body.request_idx as number) ?? requestIdx;
    if (body.url) {
      auth = body;
      break;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 15_000);
  }
  if (!auth) {
    // Not fatal for the job: the queue message reappears after the visibility
    // timeout and the job is re-dispatched.
    throw new Error(`no vast worker became ready within ${ROUTE_DEADLINE_MS / 1000}s`);
  }

  console.log(JSON.stringify({ event: "dispatch.routed", jobId, worker: auth.url }));
  const workerResp = await fetch(`${auth.url}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ auth_data: auth, session_id: null, payload: { input: envelope } }),
    ...(getVastClient() ? { client: getVastClient() } : {}),
  } as RequestInit);
  console.log(JSON.stringify({
    event: "dispatch.worker_responded",
    jobId,
    status: workerResp.status,
    body: (await workerResp.text()).slice(0, 500),
  }));
}

// ---------------------------------------------------------------- /dispatch

async function handleDispatch(request: Request): Promise<Response> {
  const serviceToken = Deno.env.get("PIPELINE_SERVICE_TOKEN");
  if (!serviceToken) return json(500, { error: "PIPELINE_SERVICE_TOKEN not configured" });
  const provided = request.headers.get("x-pipeline-token") ?? "";
  if (!provided || !timingSafeEqual(provided, serviceToken)) {
    return json(401, { error: "Bad pipeline token" });
  }

  let opts: { max?: number; vt?: number; max_running?: number } = {};
  try {
    opts = await request.json();
  } catch {
    // empty body is fine
  }
  const max = Math.min(Math.max(opts.max ?? 1, 1), 10);

  const service = serviceClient();
  const dispatched: Array<Record<string, unknown>> = [];
  for (let i = 0; i < max; i++) {
    const { data, error } = await service.rpc("dispatch_next_job", {
      p_vt: opts.vt ?? 10800,
      p_max_running: opts.max_running ?? 2,
    });
    if (error) return json(500, { error: `dispatch_next_job: ${error.message}`, dispatched });
    if (!data) break;
    const job = data as DispatchedJob;

    const spec = STAGES[job.stage];
    try {
      if (!spec) throw new Error(`no dispatcher for stage '${job.stage}'`);
      const token = await mintJobToken({
        job_id: job.job_id,
        video_id: job.video_id,
        attempt: job.attempt,
      });
      const envelope = await spec.buildEnvelope(job, token);
      const invocation = invokeVast(spec.route, envelope, job.job_id).catch((e) =>
        console.error(JSON.stringify({ event: "dispatch.invoke_failed", jobId: job.job_id, error: String(e) }))
      );
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(invocation);
      dispatched.push({ job_id: job.job_id, stage: job.stage, attempt: job.attempt });
    } catch (e) {
      // Un-dispatchable (bad stage, no input, presign down): fail it now so it
      // doesn't sit invisible until the visibility timeout.
      await service.rpc("complete_job", {
        p_job_id: job.job_id,
        p_status: "failed",
        p_error: `dispatch: ${e}`,
        p_retry: job.attempt < MAX_ATTEMPTS,
      });
      dispatched.push({ job_id: job.job_id, stage: job.stage, error: String(e) });
    }
  }
  return json(200, { dispatched });
}

// ---------------------------------------------------------------- /callback

async function handleCallback(request: Request): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return json(401, { error: "Missing job token" });

  let claims: JobClaims;
  try {
    const { payload } = await jwtVerify(token, tokenSecret(), {
      audience: TOKEN_AUD,
      algorithms: ["HS256"],
    });
    claims = payload as unknown as JobClaims;
  } catch {
    return json(403, { error: "Invalid or expired job token" });
  }

  let body: CallbackBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  if (body.request_id && body.request_id !== claims.job_id) {
    return json(400, { error: "request_id does not match job token" });
  }

  interface JobRow {
    id: string;
    stage: string;
    status: string;
    attempt: number;
    params: Record<string, unknown> | null;
    priority: number;
    queue: string;
    video_id: string;
    videos: { source_kind: string; source_url: string | null; b2_prefix: string };
  }
  const service = serviceClient();
  const { data, error } = await service
    .from("jobs")
    .select(
      "id, stage, status, attempt, params, priority, queue, video_id, videos ( source_kind, source_url, b2_prefix )",
    )
    .eq("id", claims.job_id)
    .single();
  if (error || !data) return json(404, { error: `job ${claims.job_id} not found` });
  const job = data as unknown as JobRow;

  // Bound to (job_id, attempt): a callback from an attempt that has since
  // been re-dispatched is stale — the newer attempt owns this job now.
  if (claims.attempt !== job.attempt) {
    return json(409, { error: `stale callback: token attempt ${claims.attempt}, job attempt ${job.attempt}` });
  }

  const video = job.videos;
  const jobView: DispatchedJob = {
    job_id: job.id,
    stage: job.stage,
    attempt: job.attempt,
    params: job.params ?? {},
    priority: job.priority,
    queue: job.queue,
    video_id: job.video_id,
    source_kind: video.source_kind,
    source_url: video.source_url,
    b2_prefix: video.b2_prefix,
    assets: {},
  };

  const spec = STAGES[job.stage];
  if (!spec) return json(500, { error: `no settlement for stage '${job.stage}'` });
  const ok = body.status === "success";
  const { assets, video: videoPatch, next } = spec.settle(jobView, body, ok);

  const { data: result, error: rpcError } = await service.rpc("complete_job", {
    p_job_id: job.id,
    p_status: ok ? "complete" : "failed",
    p_error: ok ? null : String(body.error ?? "unknown worker error"),
    p_assets: assets,
    p_video: videoPatch,
    p_retry: !ok && job.attempt < MAX_ATTEMPTS,
    p_next_stage: next?.stage ?? null,
    p_next_params: next?.params ?? {},
  });
  if (rpcError) return json(500, { error: `complete_job: ${rpcError.message}` });

  console.log(JSON.stringify({
    event: ok ? "job.complete" : "job.failed",
    jobId: job.id,
    stage: job.stage,
    attempt: job.attempt,
    result,
  }));
  return json(200, { ok: true, ...(result as Record<string, unknown>) });
}

// ---------------------------------------------------------------- router

Deno.serve((request: Request): Promise<Response> | Response => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });
  const path = new URL(request.url).pathname;
  if (path.endsWith("/dispatch")) return handleDispatch(request);
  if (path.endsWith("/callback")) return handleCallback(request);
  return json(404, { error: "Unknown route: use /jobs/dispatch or /jobs/callback" });
});
