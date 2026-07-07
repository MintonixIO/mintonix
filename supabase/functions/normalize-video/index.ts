/**
 * normalize-video — the compute-job dispatcher.
 *
 * The website calls this (user-authed) to normalize one of the caller's videos.
 * It mints everything the credential-free vast worker needs, then invokes it:
 *
 *   1. Verify the Supabase user (getUser).
 *   2. Build the object keys under the caller's OWN namespace
 *      users/<uid>/videos/<videoId>/…  (the uid comes from the verified token,
 *      never the body, so a user can only ever normalize their own video).
 *   3. Presign, via the Worker's /presign control plane (service-token auth):
 *        input_url            GET  original.<ext>
 *        output_upload_url    PUT  normalized.mp4
 *        thumbnail_upload_url PUT  thumbnail.jpg
 *   4. Mint a short-lived HMAC job token (the callback capability — same
 *      capability-passing pattern as the presigned URLs: the worker just echoes
 *      it back, it holds no long-lived secret).
 *   5. POST the {input:{…}} envelope to the Vast serverless endpoint.
 *
 * The worker downloads/uploads via the presigned URLs only, then (once server.py
 * gains the callback) POSTs its result to normalize-callback with the job token.
 *
 * Secrets:
 *   PRESIGN_SERVICE_TOKEN   shared secret to call the Worker's /presign
 *   CDN_PRESIGN_URL         e.g. https://cdn.mintonix.com/presign
 *   JOB_TOKEN_SECRET        HMAC secret shared with normalize-callback
 *   CALLBACK_URL            normalize-callback function URL (put in the envelope)
 *   VAST_ENDPOINT_URL       Vast serverless endpoint to POST the job to
 *   VAST_API_KEY            Vast API key
 *   PRESIGN_EXPIRY_SECONDS  optional, default 3600 (must cover queue + encode)
 * SUPABASE_URL / SUPABASE_ANON_KEY injected by the platform.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SignJWT } from "https://esm.sh/jose@5.9.6";

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

interface RequestBody {
  videoId?: string;
  ext?: string;
}

// videoId is a server-minted UUID; ext is a short file extension. Keep both
// strict so they can't smuggle path separators or traversal into the key.
const VIDEO_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const EXT_RE = /^[A-Za-z0-9]{1,10}$/;

// Presign one object via the Worker's control plane.
async function presign(
  presignUrl: string,
  serviceToken: string,
  key: string,
  op: "GET" | "PUT",
  expiresIn: number,
): Promise<string> {
  const resp = await fetch(presignUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({ key, op, expiresIn }),
  });
  if (!resp.ok) {
    throw new Error(`presign ${op} ${key} failed: ${resp.status}`);
  }
  const { url } = await resp.json() as { url: string };
  return url;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  // --- 1. Authenticate the caller -------------------------------------------
  const authHeader = request.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json(401, { error: "Not authenticated" });

  // --- 2. Validate input + build keys in the caller's namespace -------------
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const videoId = body.videoId ?? "";
  const ext = (body.ext ?? "").toLowerCase();
  if (!VIDEO_ID_RE.test(videoId)) return json(400, { error: "Invalid or missing videoId" });
  if (!EXT_RE.test(ext)) return json(400, { error: "Invalid or missing ext" });

  // The uid comes from the verified token — the caller cannot target another
  // user's video, so no separate namespace check is needed.
  const prefix = `users/${user.id}/videos/${videoId}/`;
  const originalKey = `${prefix}original.${ext}`;
  const normalizedKey = `${prefix}normalized.mp4`;
  const thumbnailKey = `${prefix}thumbnail.jpg`;

  // --- 3. Presign the three URLs the worker needs ---------------------------
  const presignUrl = Deno.env.get("CDN_PRESIGN_URL");
  const serviceToken = Deno.env.get("PRESIGN_SERVICE_TOKEN");
  if (!presignUrl || !serviceToken) {
    return json(500, { error: "presign control plane not configured" });
  }
  // Long enough to cover autoscaler queue time (max_queue_time=900s) plus a
  // multi-minute encode; clamped by the Worker's PRESIGN_MAX_EXPIRY_SECONDS.
  const expiresIn = Number(Deno.env.get("PRESIGN_EXPIRY_SECONDS") ?? "3600");

  let inputUrl: string, outputUploadUrl: string, thumbnailUploadUrl: string;
  try {
    [inputUrl, outputUploadUrl, thumbnailUploadUrl] = await Promise.all([
      presign(presignUrl, serviceToken, originalKey, "GET", expiresIn),
      presign(presignUrl, serviceToken, normalizedKey, "PUT", expiresIn),
      presign(presignUrl, serviceToken, thumbnailKey, "PUT", expiresIn),
    ]);
  } catch (e) {
    return json(502, { error: "presign failed", detail: String(e) });
  }

  // --- 4. Mint the one-time job (callback) token ----------------------------
  const jobId = crypto.randomUUID();
  const jobSecret = Deno.env.get("JOB_TOKEN_SECRET");
  const callbackUrl = Deno.env.get("CALLBACK_URL");
  if (!jobSecret || !callbackUrl) {
    return json(500, { error: "callback not configured" });
  }
  const callbackToken = await new SignJWT({
    jobId,
    uid: user.id,
    videoId,
    normalizedKey,
    thumbnailKey,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("normalize-callback")
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(new TextEncoder().encode(jobSecret));

  // --- 5. Invoke the vast worker --------------------------------------------
  // The autoscaler unwraps {"input": {...}} and hands the inner object to
  // server.py. callback_url/callback_token are extra fields the current worker
  // ignores; server.py will use them once the callback lands (see task #7).
  const envelope = {
    input: {
      request_id: jobId,
      input_url: inputUrl,
      output_upload_url: outputUploadUrl,
      thumbnail_upload_url: thumbnailUploadUrl,
      callback_url: callbackUrl,
      callback_token: callbackToken,
    },
  };

  const vastEndpoint = Deno.env.get("VAST_ENDPOINT_URL");
  const vastApiKey = Deno.env.get("VAST_API_KEY");
  if (!vastEndpoint || !vastApiKey) {
    return json(500, { error: "vast endpoint not configured" });
  }

  // NOTE: exact Vast serverless invocation shape to be confirmed against the
  // deployed endpoint (route protocol + how the key is passed). Placeholder:
  // POST the envelope with the API key as a bearer token. This runs SYNC today
  // (holds the connection until the encode finishes) — fine to prove the
  // pathway with a short clip; the callback path makes it async later.
  let vastResp: Response;
  try {
    vastResp = await fetch(vastEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vastApiKey}`,
      },
      body: JSON.stringify(envelope),
    });
  } catch (e) {
    return json(502, { error: "vast invocation failed", detail: String(e) });
  }

  const resultText = await vastResp.text();
  let result: unknown;
  try {
    result = JSON.parse(resultText);
  } catch {
    result = resultText;
  }

  return json(vastResp.ok ? 200 : 502, {
    jobId,
    videoId,
    keys: { original: originalKey, normalized: normalizedKey, thumbnail: thumbnailKey },
    vastStatus: vastResp.status,
    result,
  });
});
