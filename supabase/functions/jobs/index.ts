/**
 * jobs — the pipeline's job-lifecycle engine. One function, two routes,
 * because dispatch opens every stage and callback closes it, and they share
 * the pieces that must never drift apart: the stage routing table, the HMAC
 * job token (dispatch mints, callback verifies), and the queue semantics.
 *
 *   POST /functions/v1/jobs/dispatch    (pg_cron every minute / manual; x-pipeline-token auth)
 *     Pops queued jobs (interactive before bulk) via the dispatch_next_job
 *     RPC, presigns every input/output through the CDN Worker's /presign
 *     control plane, and POSTs the stage envelope to the vast serverless
 *     endpoint in the background. Body (all optional):
 *       { "max": 1, "vt": 10800, "max_running": 2 }
 *     -> 200 { "dispatched": [ { job_id, stage, attempt } ] }
 *
 *   POST /functions/v1/jobs/callback    (vast worker; Bearer job-token auth)
 *     The worker's only way to report. Verifies the single-use HMAC token
 *     bound to (job_id, match_id, stage, attempt), requires jobs.status =
 *     processing, then settles via complete_job. Stage advances IN PLACE;
 *     first terminal write wins — replays no-op / reject.
 *
 * Deployed with verify_jwt=false (the worker has no Supabase JWT), so EACH
 * route enforces its own credential and unmatched paths 404.
 *
 * Trust model: the vast worker receives presigned URLs + this job token and
 * nothing else. Superseded attempts / stages / non-processing status reject.
 *
 * B2 paths are constructable (not stored):
 *   owner_id IS NULL  →  bwf/<match_id>/
 *   owner_id set      →  users/<owner_id>/<match_id>/
 *
 * Stages wired: normalize → detect. analyze lands when its worker contract
 * is pinned. Normalize always loads annotation.json (corners + net poles).
 * Path mode is URL-driven on the worker: YouTube → BWF court cut; B2/CDN →
 * full encode. Both write normalized.mp4, thumbnail.jpg, preprocess-log.json.
 *
 * Secrets:
 *   PIPELINE_SERVICE_TOKEN  auth for /dispatch (shared with matches-ingest)
 *   JOB_TOKEN_SECRET        HMAC secret for the callback token
 *   CDN_PRESIGN_URL         CDN Worker control plane (e.g. https://…/presign)
 *   PRESIGN_SERVICE_TOKEN   auth for /presign (shared with cdn-access)
 *   VAST_PREPROCESS_ENDPOINT_NAME  vast serverless endpoint for preprocess
 *   VAST_NORMALIZE_ENDPOINT_NAME   deprecated alias for preprocess endpoint
 *   VAST_DETECT_ENDPOINT_NAME      vast serverless endpoint for detect
 *                                  (falls back to preprocess endpoint if unset)
 *   VAST_ENDPOINT_NAME      deprecated alias for preprocess endpoint
 *   VAST_API_KEY            vast ACCOUNT API key
 *   VAST_AUTOSCALER_URL     optional, default https://run.vast.ai
 *   VAST_TLS_CA             optional PEM: vast's self-signed worker CA
 *   PRESIGN_EXPIRY_SECONDS  optional, default 14400
 *   MULTIPART_MAX_PARTS     optional, default 256 (× part size ≈ max object)
 *   MULTIPART_PART_SIZE     optional, default 67108864 (64 MiB)
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY injected by the platform.
 */

// npm: (not esm.sh) — CI/deploy bundle must not depend on a live CDN (522s).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jwtVerify, SignJWT } from "npm:jose@5.9.6";

const MAX_ATTEMPTS = 3; // dispatches per stage before terminally failed
const TOKEN_AUD = "jobs-callback";
const ROUTE_DEADLINE_MS = 240_000; // GPU cold start budget within waitUntil

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

function isYoutubeUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "youtu.be" ||
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- presign

/** Worker multipart upload shape (matches video-preprocess multipart upload). */
export interface MultipartUploadSpec {
  part_urls: string[];
  complete_url: string;
  abort_url: string;
  part_size: number;
}

async function presignControlPlane(
  body: Record<string, unknown>,
): Promise<Response> {
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const token = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !token) throw new Error("presign control plane not configured");
  return fetch(presignUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function presign(key: string, op: "GET" | "PUT"): Promise<string> {
  const expiresIn = Number(Deno.env.get("PRESIGN_EXPIRY_SECONDS") ?? "14400");
  const resp = await presignControlPlane({ key, op, expiresIn });
  if (!resp.ok) throw new Error(`presign ${op} ${key} failed: ${resp.status}`);
  const { url } = await resp.json() as { url: string };
  return url;
}

/**
 * Create a B2 multipart upload session and return presigned part/complete/abort
 * URLs for large pipeline outputs (normalized.mp4). Small objects
 * (thumbnail, CSV, JSON) stay on single PUT via presign(..., "PUT").
 */
async function presignMultipart(key: string): Promise<MultipartUploadSpec> {
  const expiresIn = Number(Deno.env.get("PRESIGN_EXPIRY_SECONDS") ?? "14400");
  const parts = Number(Deno.env.get("MULTIPART_MAX_PARTS") ?? "256");
  const partSize = Number(
    Deno.env.get("MULTIPART_PART_SIZE") ?? String(64 * 1024 * 1024),
  );
  const resp = await presignControlPlane({
    key,
    op: "MULTIPART",
    parts,
    partSize,
    expiresIn,
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(
      `presign MULTIPART ${key} failed: ${resp.status} ${t.slice(0, 200)}`,
    );
  }
  const body = await resp.json() as {
    part_urls?: string[];
    complete_url?: string;
    abort_url?: string;
    part_size?: number;
  };
  if (!body.part_urls?.length || !body.complete_url || !body.abort_url) {
    throw new Error(`presign MULTIPART ${key}: malformed response`);
  }
  return {
    part_urls: body.part_urls,
    complete_url: body.complete_url,
    abort_url: body.abort_url,
    part_size: body.part_size ?? partSize,
  };
}

// ---------------------------------------------------------------- job token

function tokenSecret(): Uint8Array {
  const secret = Deno.env.get("JOB_TOKEN_SECRET");
  if (!secret) throw new Error("JOB_TOKEN_SECRET not configured");
  return new TextEncoder().encode(secret);
}

interface JobClaims {
  job_id: string;
  match_id: string;
  stage: string;
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
  priority: number;
  queue: string;
  match_id: string;
  owner_id: string | null;
  source_url: string | null;
  b2_prefix: string;
  tournament: string | null;
  team1_player1: string | null;
  team1_player2: string | null;
  team2_player1: string | null;
  team2_player2: string | null;
}

/** The worker's callback body: {request_id, status, error?, …stage result}. */
type CallbackBody = Record<string, unknown> & {
  request_id?: string;
  status?: string;
  error?: string;
};

interface Settlement {
  match: Record<string, unknown>;
  next: { stage: string } | null;
}

/**
 * Load raw annotation.json for every normalize job.
 * Worker validates court.corners[4] + court.net_poles[2].
 * Throws when missing — annotation is required for both BWF and user paths.
 */
async function loadAnnotation(job: DispatchedJob): Promise<unknown> {
  const url = await presign(`${job.b2_prefix}annotation.json`, "GET");
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `match ${job.match_id}: annotation.json missing or unreadable ` +
        `(HTTP ${resp.status}); cannot run preprocess`,
    );
  }
  return await resp.json();
}

/**
 * Stage routing table. normalize → detect; analyze slots in when ready.
 *
 * Worker route is /preprocess/sync (video-preprocess image).
 * Artifacts: normalized.mp4 (multipart), thumbnail.jpg, preprocess-log.json.
 */
const STAGES: Record<string, {
  route: string;
  /** Env var for this stage's vast endpoint name (see resolveVastEndpointName). */
  endpointEnv?: string;
  buildEnvelope(job: DispatchedJob, token: string): Promise<Record<string, unknown>>;
  settle(job: DispatchedJob, body: CallbackBody, ok: boolean): Settlement;
}> = {
  normalize: {
    route: "/preprocess/sync",
    endpointEnv: "VAST_PREPROCESS_ENDPOINT_NAME",

    async buildEnvelope(job, token) {
      const prefix = job.b2_prefix;
      const env: Record<string, unknown> = {
        request_id: job.job_id,
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/jobs/callback`,
        callback_token: token,
      };

      // Independent presigns in parallel to shrink dispatch latency while
      // the job is already claimed as processing.
      const outputP = presignMultipart(`${prefix}normalized.mp4`);
      const thumbP = presign(`${prefix}thumbnail.jpg`, "PUT");
      const logP = presign(`${prefix}preprocess-log.json`, "PUT");
      const annP = loadAnnotation(job);

      // User-owned: original already in B2 as original.mp4 (matches-ingest).
      // YouTube: worker yt-dlps source_url → BWF court-cut path.
      // System/backlog without YouTube URL: original.mp4 under prefix (user path).
      if (job.owner_id) {
        env.input_url = await presign(`${prefix}original.mp4`, "GET");
      } else if (isYoutubeUrl(job.source_url)) {
        env.input_url = job.source_url;
      } else {
        env.input_url = await presign(`${prefix}original.mp4`, "GET");
      }

      env.output_upload = await outputP;
      env.thumbnail_upload_url = await thumbP;
      env.preprocess_log_upload_url = await logP;
      env.annotation = await annP;
      return env;
    },

    settle(_job, body, ok) {
      // Advance to detect on success. Match stays processing until detect (or
      // later analyze) finishes; probe fields land from the preprocess result.
      const next = ok ? { stage: "detect" } : null;
      const match = ok
        ? {
          status: "processing",
          duration_sec: body.duration,
          width: body.width,
          height: body.height,
          fps: body.fps,
        }
        : {};
      return { match, next };
    },
  },

  detect: {
    route: "/detect/sync",
    // Separate GPU image/endpoint from preprocess; falls back to the preprocess
    // endpoint name in invokeVast if unset (single-endpoint local wiring).
    endpointEnv: "VAST_DETECT_ENDPOINT_NAME",

    async buildEnvelope(job, token) {
      const prefix = job.b2_prefix;
      // Always normalized.mp4 (BWF court cut or full user encode).
      // player_id in detections.json stays null (ReID not in product path).
      // annotation + preprocess-log let detect emit Engine segments[]
      // (islands + scoreboard OCR) without B2 credentials on the GPU.
      const [input_url, output_upload_url, annotation_url, preprocess_log_url] =
        await Promise.all([
          presign(`${prefix}normalized.mp4`, "GET"),
          presign(`${prefix}detections.json`, "PUT"),
          presign(`${prefix}annotation.json`, "GET"),
          presign(`${prefix}preprocess-log.json`, "GET"),
        ]);
      return {
        request_id: job.job_id,
        callback_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/jobs/callback`,
        callback_token: token,
        input_url,
        output_upload_url,
        annotation_url,
        preprocess_log_url,
      };
    },

    settle(_job, _body, ok) {
      // analyze not wired yet — detect is terminal for MVP.
      const next = null;
      const match = ok ? { status: "ready" } : {};
      return { match, next };
    },
  },
};

// ---------------------------------------------------------------- vast

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
 * Resolve the vast serverless endpoint name for a stage.
 *
 * Prefer the stage-specific env (e.g. VAST_DETECT_ENDPOINT_NAME), then
 * VAST_PREPROCESS_ENDPOINT_NAME, then deprecated
 * VAST_NORMALIZE_ENDPOINT_NAME / VAST_ENDPOINT_NAME.
 */
function resolveVastEndpointName(endpointEnv?: string): {
  name: string | undefined;
  usedEnv: string;
} {
  if (endpointEnv) {
    const staged = Deno.env.get(endpointEnv);
    if (staged) return { name: staged, usedEnv: endpointEnv };
  }

  const preprocess = Deno.env.get("VAST_PREPROCESS_ENDPOINT_NAME");
  if (preprocess) {
    return { name: preprocess, usedEnv: "VAST_PREPROCESS_ENDPOINT_NAME" };
  }

  const normalize = Deno.env.get("VAST_NORMALIZE_ENDPOINT_NAME");
  if (normalize) {
    console.warn(
      "VAST_NORMALIZE_ENDPOINT_NAME is deprecated; set VAST_PREPROCESS_ENDPOINT_NAME",
    );
    return { name: normalize, usedEnv: "VAST_NORMALIZE_ENDPOINT_NAME" };
  }

  const legacy = Deno.env.get("VAST_ENDPOINT_NAME");
  if (legacy) {
    console.warn(
      "VAST_ENDPOINT_NAME is deprecated; set VAST_PREPROCESS_ENDPOINT_NAME " +
        "(and VAST_DETECT_ENDPOINT_NAME for detect)",
    );
    return { name: legacy, usedEnv: "VAST_ENDPOINT_NAME" };
  }

  return {
    name: undefined,
    usedEnv: endpointEnv ?? "VAST_PREPROCESS_ENDPOINT_NAME",
  };
}

async function invokeVast(
  route: string,
  envelope: Record<string, unknown>,
  jobId: string,
  endpointEnv?: string,
): Promise<void> {
  // Stage-specific name first; detect may fall back to the preprocess endpoint
  // so a single-endpoint local deploy still works.
  const { name: endpoint, usedEnv } = resolveVastEndpointName(endpointEnv);
  const accountKey = Deno.env.get("VAST_API_KEY");
  if (!endpoint || !accountKey) {
    throw new Error(
      `${usedEnv} / VAST_API_KEY not configured`,
    );
  }
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
        cost: 10000,
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
    throw new Error(`no vast worker became ready within ${ROUTE_DEADLINE_MS / 1000}s`);
  }

  console.log(JSON.stringify({ event: "dispatch.routed", jobId, worker: auth.url }));
  const workerResp = await fetch(`${auth.url}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ auth_data: auth, session_id: null, payload: { input: envelope } }),
    ...(getVastClient() ? { client: getVastClient() } : {}),
  } as RequestInit);
  const workerBody = (await workerResp.text()).slice(0, 500);
  console.log(JSON.stringify({
    event: "dispatch.worker_responded",
    jobId,
    status: workerResp.status,
    body: workerBody,
  }));
  // 4xx/5xx means the job never started — treat as invoke failure so we requeue.
  if (!workerResp.ok) {
    throw new Error(`vast worker ${route} failed: ${workerResp.status} ${workerBody}`);
  }
}

async function failJob(
  service: ReturnType<typeof serviceClient>,
  job: DispatchedJob,
  error: string,
  retry: boolean,
): Promise<void> {
  // CAS on attempt+stage so a late invoke failure from attempt N cannot
  // clobber attempt N+1 after VT reclaim re-dispatched the same job_id.
  const { data, error: rpcError } = await service.rpc("complete_job", {
    p_job_id: job.job_id,
    p_status: "failed",
    p_error: error,
    p_retry: retry,
    p_expected_attempt: job.attempt,
    p_expected_stage: job.stage,
  });
  if (rpcError) {
    console.error(JSON.stringify({
      event: "complete_job.fail_path_error",
      jobId: job.job_id,
      attempt: job.attempt,
      error: rpcError.message,
    }));
    return;
  }
  const settled = data as Record<string, unknown> | null;
  if (settled?.rejected) {
    console.log(JSON.stringify({
      event: "complete_job.fail_path_stale",
      jobId: job.job_id,
      attempt: job.attempt,
      result: settled,
    }));
  }
}

// ---------------------------------------------------------------- /dispatch

async function handleDispatch(request: Request): Promise<Response> {
  const serviceToken = Deno.env.get("PIPELINE_SERVICE_TOKEN");
  if (!serviceToken) return json(500, { error: "PIPELINE_SERVICE_TOKEN not configured" });
  const provided = request.headers.get("x-pipeline-token") ?? "";
  if (!provided || !(await timingSafeEqual(provided, serviceToken))) {
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

    // attempt already incremented by the RPC; terminal-fail past the budget.
    if (job.attempt > MAX_ATTEMPTS) {
      await failJob(service, job, `attempt ${job.attempt} exceeds max ${MAX_ATTEMPTS}`, false);
      dispatched.push({ job_id: job.job_id, stage: job.stage, error: "max attempts exceeded" });
      continue;
    }

    const spec = STAGES[job.stage];
    try {
      if (!spec) {
        // Unwired stages (e.g. analyze): terminal fail — retry cannot help.
        await failJob(
          service,
          job,
          `no dispatcher for stage '${job.stage}' (not implemented)`,
          false,
        );
        dispatched.push({
          job_id: job.job_id,
          stage: job.stage,
          error: "stage not implemented",
        });
        continue;
      }
      const token = await mintJobToken({
        job_id: job.job_id,
        match_id: job.match_id,
        stage: job.stage,
        attempt: job.attempt,
      });
      const envelope = await spec.buildEnvelope(job, token);
      const invocation = invokeVast(
        spec.route,
        envelope,
        job.job_id,
        spec.endpointEnv,
      ).catch(async (e) => {
        console.error(JSON.stringify({
          event: "dispatch.invoke_failed",
          jobId: job.job_id,
          error: String(e),
        }));
        // Re-queue (or terminal-fail) so the job does not sit processing forever.
        await failJob(service, job, `invoke: ${e}`, job.attempt < MAX_ATTEMPTS);
      });
      // Fail closed if waitUntil is unavailable: await invoke so the job
      // cannot be left processing with no background work scheduled.
      // deno-lint-ignore no-explicit-any
      const edgeRt = (globalThis as any).EdgeRuntime;
      if (edgeRt?.waitUntil) {
        edgeRt.waitUntil(invocation);
      } else {
        await invocation;
      }
      dispatched.push({ job_id: job.job_id, stage: job.stage, attempt: job.attempt });
    } catch (e) {
      await failJob(service, job, `dispatch: ${e}`, job.attempt < MAX_ATTEMPTS);
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
    if (
      typeof payload.job_id !== "string" ||
      typeof payload.match_id !== "string" ||
      typeof payload.stage !== "string" ||
      typeof payload.attempt !== "number"
    ) {
      return json(401, { error: "Job token missing required claims" });
    }
    claims = {
      job_id: payload.job_id,
      match_id: payload.match_id,
      stage: payload.stage,
      attempt: payload.attempt,
    };
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
    priority: number;
    queue: string | null;
    match_id: string;
    matches: {
      id: string;
      owner_id: string | null;
      source_url: string | null;
      tournament: string | null;
      team1_player1: string | null;
      team1_player2: string | null;
      team2_player1: string | null;
      team2_player2: string | null;
    };
  }
  const service = serviceClient();
  const { data, error } = await service
    .from("jobs")
    .select(
      "id, stage, status, attempt, priority, queue, match_id, matches ( id, owner_id, source_url, tournament, team1_player1, team1_player2, team2_player1, team2_player2 )",
    )
    .eq("id", claims.job_id)
    .single();
  if (error || !data) return json(404, { error: `job ${claims.job_id} not found` });
  const job = data as unknown as JobRow;

  // One-shot gates: status, attempt, stage, match_id.
  if (job.status === "complete" || job.status === "failed" || job.status === "canceled") {
    return json(200, { ok: true, already_terminal: true });
  }
  if (job.status !== "processing") {
    return json(409, {
      error: `job not processing (status=${job.status}); callback rejected`,
    });
  }
  if (typeof claims.attempt !== "number" || claims.attempt !== job.attempt) {
    return json(409, {
      error: `stale callback: token attempt ${claims.attempt}, job attempt ${job.attempt}`,
    });
  }
  if (!claims.stage || claims.stage !== job.stage) {
    return json(409, {
      error: `stale callback: token stage ${claims.stage ?? "(missing)"}, job stage ${job.stage}`,
    });
  }
  if (!claims.match_id || claims.match_id !== job.match_id) {
    return json(400, { error: "match_id does not match job token" });
  }

  const m = job.matches;
  const ownerId = m.owner_id;
  // Always construct prefix from committed match ownership (never from the client).
  const b2Prefix = ownerId
    ? `users/${ownerId}/${m.id}/`
    : `bwf/${m.id}/`;

  const jobView: DispatchedJob = {
    job_id: job.id,
    stage: job.stage,
    attempt: job.attempt,
    priority: job.priority,
    queue: job.queue ?? "jobs_bulk",
    match_id: job.match_id,
    owner_id: ownerId,
    source_url: m.source_url,
    b2_prefix: b2Prefix,
    tournament: m.tournament,
    team1_player1: m.team1_player1,
    team1_player2: m.team1_player2,
    team2_player1: m.team2_player1,
    team2_player2: m.team2_player2,
  };

  const spec = STAGES[job.stage];
  if (!spec) return json(500, { error: `no settlement for stage '${job.stage}'` });
  const ok = body.status === "success";
  const { match: matchPatch, next } = spec.settle(jobView, body, ok);

  const { data: result, error: rpcError } = await service.rpc("complete_job", {
    p_job_id: job.id,
    p_status: ok ? "complete" : "failed",
    p_error: ok ? null : String(body.error ?? "unknown worker error"),
    p_match: matchPatch,
    p_retry: !ok && job.attempt < MAX_ATTEMPTS,
    p_next_stage: next?.stage ?? null,
    p_expected_attempt: job.attempt,
    p_expected_stage: job.stage,
  });
  if (rpcError) return json(500, { error: `complete_job: ${rpcError.message}` });

  const settled = result as Record<string, unknown> | null;
  if (settled?.rejected) {
    return json(409, { error: "complete_job rejected", ...settled });
  }

  console.log(JSON.stringify({
    event: ok ? "job.complete" : "job.failed",
    jobId: job.id,
    matchId: job.match_id,
    stage: job.stage,
    attempt: job.attempt,
    result,
  }));
  return json(200, { ok: true, ...(settled as Record<string, unknown>) });
}

// ---------------------------------------------------------------- router

Deno.serve((request: Request): Promise<Response> | Response => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });
  const path = new URL(request.url).pathname;
  if (path.endsWith("/dispatch")) return handleDispatch(request);
  if (path.endsWith("/callback")) return handleCallback(request);
  return json(404, { error: "Unknown route: use /jobs/dispatch or /jobs/callback" });
});
