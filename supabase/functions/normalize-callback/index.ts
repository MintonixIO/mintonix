/**
 * normalize-callback — the compute-job result receiver.
 *
 * The vast worker POSTs its result here when a normalization finishes. The
 * worker holds NO long-lived credential: it authenticates with the one-time
 * job token that normalize-video handed it in the job envelope (capability
 * passing, exactly like the presigned URLs). We verify that token's HMAC
 * signature — proof it's a genuine callback for a job we dispatched — then
 * record the result.
 *
 * The result payload carries sha256(output) as an INTEGRITY field (content
 * addressing / dedup / later verification against B2). Authorization comes from
 * the token, not the hash — a hash alone proves possession, not authority.
 *
 * Deployed with verify_jwt=false: there is no Supabase user here, the caller is
 * the worker authing via the job token, which we verify ourselves.
 *
 * Secrets:
 *   JOB_TOKEN_SECRET   HMAC secret shared with normalize-video
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY injected by the platform (for the
 * DB write, once a table exists — see TODO(persist)).
 */

import { jwtVerify } from "https://esm.sh/jose@5.9.6";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface JobClaims {
  jobId: string;
  uid: string;
  videoId: string;
  normalizedKey: string;
  thumbnailKey: string;
}

// The worker's success payload (from server.py's 200 response), plus the
// sha256 the callback adds.
interface CallbackBody {
  request_id?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  duration?: number;
  file_size?: number;
  sha256?: string;
  error?: string;
  [k: string]: unknown;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  // --- 1. Verify the one-time job token -------------------------------------
  const secret = Deno.env.get("JOB_TOKEN_SECRET");
  if (!secret) return json(500, { error: "callback not configured" });

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json(401, { error: "Missing job token" });

  let claims: JobClaims;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { audience: "normalize-callback", algorithms: ["HS256"] },
    );
    claims = payload as unknown as JobClaims;
  } catch {
    return json(403, { error: "Invalid or expired job token" });
  }

  // --- 2. Parse + sanity-check the result -----------------------------------
  let body: CallbackBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // The token binds the callback to a specific job; a mismatched request_id
  // means the payload doesn't belong to the token presented.
  if (body.request_id && body.request_id !== claims.jobId) {
    return json(400, { error: "request_id does not match job token" });
  }

  const failed = typeof body.error === "string";

  // TODO(persist): write to a `video_jobs` / `videos` row keyed by
  // claims.videoId (owner claims.uid): status ready|failed, the sha256, and the
  // probe metadata (width/height/fps/duration/file_size). Use the injected
  // SUPABASE_SERVICE_ROLE_KEY. Until the table exists, we log + ack so the
  // worker gets a clean 200 and the auth/binding path is exercisable now.
  console.log(JSON.stringify({
    event: failed ? "normalize.failed" : "normalize.done",
    jobId: claims.jobId,
    uid: claims.uid,
    videoId: claims.videoId,
    normalizedKey: claims.normalizedKey,
    sha256: body.sha256 ?? null,
    meta: failed ? undefined : {
      width: body.width, height: body.height, fps: body.fps,
      duration: body.duration, file_size: body.file_size, codec: body.codec,
    },
    error: failed ? body.error : undefined,
  }));

  return json(200, { ok: true, jobId: claims.jobId, recorded: !failed });
});
