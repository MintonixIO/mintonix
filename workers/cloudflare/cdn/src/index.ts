/**
 * Mintonix CDN edge Worker.
 *
 * The Worker is the SOLE holder of Backblaze B2 credentials, with two planes:
 *
 *   - Data plane  (GET /<objectKey>?t=<jwt>): serves objects from the PRIVATE
 *     bucket through Cloudflare's edge cache, gated by a short-lived Ed25519
 *     view token. End-user delivery — proxied so it stays cached + free egress.
 *
 *   - Control plane (POST /presign): the Supabase orchestrator, authed by a
 *     shared service token, asks for a presigned B2 URL (GET | PUT | DELETE),
 *     a parallel multipart upload session (MULTIPART), or a LIST of keys under
 *     a prefix. GET/PUT/DELETE/part URLs are hit DIRECTLY against B2 by the
 *     client/worker; LIST and CreateMultipartUpload are executed here (need
 *     credentials / UploadId).
 *
 * Trust boundary:
 *   - Vast / RunPod compute workers hold NO credentials (unchanged).
 *   - The orchestrator (Supabase fn) holds NO B2 credentials — only the JWT
 *     *private* key (mints view tokens) and the service token to call /presign.
 *   - This Worker holds the only B2 key (list+read+write+delete) plus the JWT
 *     *public* key (verify view tokens, can't mint).
 *
 * View-token claims (EdDSA, minted by the orchestrator):
 *   { "key": "…", "exp": <unix s>, "iat": <unix s> }
 * The Worker requires `exp` and enforces `claims.key === <objectKey>`.
 */

import { AwsClient } from "aws4fetch";
import { importSPKI, jwtVerify, type KeyLike } from "jose";

export interface Env {
  B2_S3_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_ACCESS_KEY_ID: string; // secret — list+read+write+delete app key
  B2_SECRET_ACCESS_KEY: string; // secret
  CDN_JWT_PUBLIC_KEY: string; // SPKI PEM
  PRESIGN_SERVICE_TOKEN: string; // secret — shared with the Supabase orchestrator
  /** Edge→B2 cache TTL for full 200 responses (seconds). Default 86400. */
  CACHE_TTL_SECONDS?: string;
  /**
   * Client-visible Cache-Control max-age for successful delivery (seconds).
   * Always `private` — tokens are short-lived. Default 300.
   */
  CLIENT_CACHE_MAX_AGE_SECONDS?: string;
  CORS_ALLOW_ORIGIN?: string;
  PRESIGN_MAX_EXPIRY_SECONDS?: string;
  /** Hard cap on remaining view-token lifetime (seconds). Default 3600. */
  MAX_VIEW_TOKEN_SECONDS?: string;
}

// Module-scoped caches so we parse the PEM / build the signer once per isolate.
let cachedPublicKey: { pem: string; key: KeyLike } | undefined;
let cachedAws: { client: AwsClient; id: string } | undefined;

async function getPublicKey(env: Env): Promise<KeyLike> {
  const pem = env.CDN_JWT_PUBLIC_KEY;
  if (!cachedPublicKey || cachedPublicKey.pem !== pem) {
    cachedPublicKey = { pem, key: await importSPKI(pem, "EdDSA") };
  }
  return cachedPublicKey.key;
}

function getAws(env: Env): AwsClient {
  // Re-create if the key id changed (e.g. after a secret rotation + redeploy).
  if (!cachedAws || cachedAws.id !== env.B2_ACCESS_KEY_ID) {
    cachedAws = {
      id: env.B2_ACCESS_KEY_ID,
      client: new AwsClient({
        accessKeyId: env.B2_ACCESS_KEY_ID,
        secretAccessKey: env.B2_SECRET_ACCESS_KEY,
        service: "s3",
        region: env.B2_REGION,
      }),
    };
  }
  return cachedAws.client;
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.CORS_ALLOW_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Authorization",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, ETag",
  };
}

function deny(status: number, message: string, env: Env): Response {
  return new Response(message + "\n", {
    status,
    headers: { "Content-Type": "text/plain", ...corsHeaders(env) },
  });
}

function json(status: number, body: unknown, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

/** Delivery tokens: Bearer or ?t= (short-lived view JWTs). */
function extractViewToken(request: Request, url: URL): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("t");
}

/**
 * Control-plane service token: Authorization Bearer only.
 * Never accept long-lived secrets via ?t= (logs / Referer).
 */
function extractServiceToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

// Reject path traversal / absolute keys before they reach a signature or cache
// key. Allowed: nested paths of safe object-key characters.
function isValidKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("..")) return false;
  return /^[A-Za-z0-9!_.*'()/\-]+$/.test(key);
}

// Constant-time string compare so the service-token check can't be timed.
// Hash both sides first so length is not an oracle on the raw secret.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const digests = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))),
  );
  const ab = new Uint8Array(digests[0]);
  const bb = new Uint8Array(digests[1]);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** Unescape XML text entities from S3/B2 responses. */
function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function presignExpirySeconds(bodyExpiresIn: number | undefined, env: Env): number {
  // Default max must be >= jobs default (14400) so a missing wrangler var
  // does not silently clip pipeline multiparts.
  const maxExpiry = Number(env.PRESIGN_MAX_EXPIRY_SECONDS ?? "14400");
  return Math.min(Math.max(Number(bodyExpiresIn) || 900, 60), maxExpiry);
}

/**
 * Control plane: mint a presigned B2 URL (or list keys / multipart session)
 * for the orchestrator.
 *
 * Auth: `Authorization: Bearer <PRESIGN_SERVICE_TOKEN>` only.
 */
async function handlePresign(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return deny(405, "Method not allowed", env);

  const provided = extractServiceToken(request);
  if (
    !provided ||
    !(await timingSafeEqual(provided, env.PRESIGN_SERVICE_TOKEN))
  ) {
    return deny(401, "Bad service token", env);
  }

  let body: {
    key?: string;
    op?: string;
    expiresIn?: number;
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
    parts?: number;
    partSize?: number;
  };
  try {
    body = await request.json();
  } catch {
    return deny(400, "Invalid JSON body", env);
  }

  const op = (body.op ?? "GET").toUpperCase();

  if (op === "LIST") {
    return handleList(body, env);
  }
  if (op === "MULTIPART") {
    return handleMultipart(body, env);
  }

  const key = body.key ?? "";
  if (!isValidKey(key)) return deny(400, "Invalid or missing key", env);
  if (op !== "GET" && op !== "PUT" && op !== "DELETE") {
    return deny(400, "op must be GET, PUT, DELETE, MULTIPART, or LIST", env);
  }

  const expiresIn = presignExpirySeconds(body.expiresIn, env);

  const b2Url = new URL(`${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeURI(key)}`);
  b2Url.searchParams.set("X-Amz-Expires", String(expiresIn));

  const signed = await getAws(env).sign(b2Url.toString(), {
    method: op,
    aws: { signQuery: true },
  });

  return json(
    200,
    {
      url: signed.url,
      method: op,
      key,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
    env,
  );
}

/**
 * Start an S3 multipart upload and return presigned part/complete/abort URLs.
 */
async function handleMultipart(
  body: { key?: string; expiresIn?: number; parts?: number; partSize?: number },
  env: Env,
): Promise<Response> {
  const key = body.key ?? "";
  if (!isValidKey(key)) return deny(400, "Invalid or missing key", env);

  const expiresIn = presignExpirySeconds(body.expiresIn, env);
  // Product cap: 1024 × 64 MiB ≈ 64 GiB — enough for masters, avoids Worker
  // CPU/response-size blowups at S3's theoretical 10_000 max.
  const parts = Math.min(Math.max(Number(body.parts) || 256, 1), 1024);
  const partSize = Math.min(
    Math.max(Number(body.partSize) || 64 * 1024 * 1024, 5 * 1024 * 1024),
    128 * 1024 * 1024,
  );

  const objectUrl = `${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeURI(key)}`;
  const aws = getAws(env);

  const createUrl = new URL(objectUrl);
  createUrl.searchParams.set("uploads", "");
  const createSigned = await aws.sign(createUrl.toString(), {
    method: "POST",
    aws: { signQuery: true },
  });
  const createResp = await fetch(createSigned.url, { method: "POST" });
  if (!createResp.ok) {
    const t = await createResp.text();
    return deny(
      502,
      `CreateMultipartUpload failed: ${createResp.status} ${t.slice(0, 200)}`,
      env,
    );
  }
  const createXml = await createResp.text();
  const uploadIdMatch = createXml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!uploadIdMatch) {
    return deny(502, "CreateMultipartUpload: no UploadId in response", env);
  }
  const uploadId = unescapeXml(uploadIdMatch[1]);

  try {
    const part_urls: string[] = [];
    for (let n = 1; n <= parts; n++) {
      const partUrl = new URL(objectUrl);
      partUrl.searchParams.set("partNumber", String(n));
      partUrl.searchParams.set("uploadId", uploadId);
      partUrl.searchParams.set("X-Amz-Expires", String(expiresIn));
      const signed = await aws.sign(partUrl.toString(), {
        method: "PUT",
        aws: { signQuery: true },
      });
      part_urls.push(signed.url);
    }

    const completeUrl = new URL(objectUrl);
    completeUrl.searchParams.set("uploadId", uploadId);
    completeUrl.searchParams.set("X-Amz-Expires", String(expiresIn));
    const completeSigned = await aws.sign(completeUrl.toString(), {
      method: "POST",
      aws: { signQuery: true },
    });

    const abortUrl = new URL(objectUrl);
    abortUrl.searchParams.set("uploadId", uploadId);
    abortUrl.searchParams.set("X-Amz-Expires", String(expiresIn));
    const abortSigned = await aws.sign(abortUrl.toString(), {
      method: "DELETE",
      aws: { signQuery: true },
    });

    return json(
      200,
      {
        op: "MULTIPART",
        key,
        uploadId,
        part_urls,
        complete_url: completeSigned.url,
        abort_url: abortSigned.url,
        part_size: partSize,
        parts,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
      env,
    );
  } catch (e) {
    // Best-effort abort so a mid-presign failure does not leave an open MPU.
    try {
      const abortUrl = new URL(objectUrl);
      abortUrl.searchParams.set("uploadId", uploadId);
      abortUrl.searchParams.set("X-Amz-Expires", "300");
      const abortSigned = await aws.sign(abortUrl.toString(), {
        method: "DELETE",
        aws: { signQuery: true },
      });
      await fetch(abortSigned.url, { method: "DELETE" });
    } catch {
      /* ignore abort errors */
    }
    const msg = e instanceof Error ? e.message : String(e);
    return deny(502, `Multipart presign failed: ${msg.slice(0, 200)}`, env);
  }
}

/** S3 ListObjectsV2 under a non-empty prefix; service-token only. */
async function handleList(
  body: { prefix?: string; maxKeys?: number; continuationToken?: string },
  env: Env,
): Promise<Response> {
  const prefix = body.prefix ?? "";
  // Reject empty prefix — whole-bucket list is too wide for a shared secret.
  if (!prefix) {
    return deny(400, "LIST requires a non-empty prefix", env);
  }
  if (
    prefix.length > 1024 ||
    prefix.startsWith("/") ||
    prefix.includes("..") ||
    !/^[A-Za-z0-9!_.*'()/\-]+$/.test(prefix)
  ) {
    return deny(400, "Invalid prefix", env);
  }

  const maxKeys = Math.min(Math.max(Number(body.maxKeys) || 1000, 1), 1000);
  const listUrl = new URL(`${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}`);
  listUrl.searchParams.set("list-type", "2");
  listUrl.searchParams.set("prefix", prefix);
  listUrl.searchParams.set("max-keys", String(maxKeys));
  if (body.continuationToken) {
    listUrl.searchParams.set("continuation-token", body.continuationToken);
  }

  const signed = await getAws(env).sign(listUrl.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });
  const resp = await fetch(signed.url, { method: "GET" });
  if (!resp.ok) {
    return deny(502, `ListObjects failed: ${resp.status}`, env);
  }

  const xml = await resp.text();
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    unescapeXml(m[1]),
  );
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextMatch = xml.match(
    /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/,
  );
  const nextContinuationToken = nextMatch ? unescapeXml(nextMatch[1]) : null;

  return json(
    200,
    {
      op: "LIST",
      prefix,
      keys,
      isTruncated: truncated,
      nextContinuationToken,
    },
    env,
  );
}

/** Data plane: token-gated, cached delivery of a private object. */
async function serveDelivery(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return deny(405, "Method not allowed", env);
  }

  const url = new URL(request.url);
  let objectKey: string;
  try {
    objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return deny(400, "Bad path encoding", env);
  }
  if (!isValidKey(objectKey)) return deny(404, "Not found", env);

  const token = extractViewToken(request, url);
  if (!token) return deny(401, "Missing view token", env);

  let objectClaim: string;
  let exp: number;
  try {
    const publicKey = await getPublicKey(env);
    const result = await jwtVerify(token, publicKey, { algorithms: ["EdDSA"] });
    const payload = result.payload;
    if (typeof payload.key !== "string" || !payload.key) {
      return deny(403, "Invalid or expired token", env);
    }
    if (typeof payload.exp !== "number") {
      return deny(403, "Invalid or expired token", env);
    }
    const maxLife = Number(env.MAX_VIEW_TOKEN_SECONDS ?? "3600");
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp - now > maxLife) {
      return deny(403, "Invalid or expired token", env);
    }
    objectClaim = payload.key;
    exp = payload.exp;
  } catch {
    return deny(403, "Invalid or expired token", env);
  }

  if (objectClaim !== objectKey) {
    return deny(403, "Token does not grant this object", env);
  }

  // Canonical cache key: clean path without token. Method folded in so HEAD
  // cannot poison GET. Range requests skip edge cache write (see below).
  const cacheKey = `${url.origin}/${objectKey}#${request.method}`;
  const edgeTtl = Number(env.CACHE_TTL_SECONDS ?? "86400");
  const clientMaxAge = Math.min(
    Number(env.CLIENT_CACHE_MAX_AGE_SECONDS ?? "300"),
    Math.max(0, exp - Math.floor(Date.now() / 1000)),
  );

  const b2Url = `${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeURI(objectKey)}`;
  const aws = getAws(env);
  const signed = await aws.sign(b2Url, {
    method: request.method,
    aws: { signQuery: true },
  });

  const originRequest = new Request(signed.url, { method: request.method });
  const range = request.headers.get("Range");
  if (range) originRequest.headers.set("Range", range);

  // Range: do not populate edge cache with partial 206s (key ignores Range).
  // Full GET/HEAD: cache only 2xx; never sticky-cache 404/5xx.
  const originResponse = await fetch(originRequest, {
    cf: range
      ? undefined
      : {
          cacheKey,
          cacheEverything: true,
          cacheTtlByStatus: {
            "200-299": edgeTtl,
            "400-499": 0,
            "500-599": 0,
          },
        },
  });

  if (originResponse.status === 403 || originResponse.status === 401) {
    return deny(502, "Upstream storage auth failed", env);
  }
  if (originResponse.status === 404) return deny(404, "Not found", env);

  const headers = new Headers(originResponse.headers);
  // Private media: browser must revalidate with a token; never public.
  if (originResponse.status >= 200 && originResponse.status < 300) {
    headers.set(
      "Cache-Control",
      `private, max-age=${clientMaxAge}`,
    );
  } else {
    headers.set("Cache-Control", "private, no-store");
  }
  headers.set("Accept-Ranges", "bytes");
  for (const [k, v] of Object.entries(corsHeaders(env))) headers.set(k, v);
  headers.delete("x-amz-request-id");
  headers.delete("x-amz-id-2");

  return new Response(request.method === "HEAD" ? null : originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    if (url.pathname === "/presign") return handlePresign(request, env);
    return serveDelivery(request, env);
  },
};
