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
 *     shared service token, asks for a presigned B2 URL (GET | PUT | DELETE)
 *     or a LIST of keys under a prefix. GET/PUT/DELETE URLs are hit DIRECTLY
 *     against B2 by the client/worker; LIST is executed here (no useful
 *     single-shot presign for paginated listing).
 *
 * Trust boundary:
 *   - Vast / RunPod compute workers hold NO credentials (unchanged).
 *   - The orchestrator (Supabase fn) holds NO B2 credentials — only the JWT
 *     *private* key (mints view tokens) and the service token to call /presign.
 *   - This Worker holds the only B2 key (read+write+delete, needed to presign
 *     PUTs/DELETEs) plus the JWT *public* key (verify view tokens, can't mint).
 *
 * View-token claims (EdDSA, minted by the orchestrator):
 *   { "key": "videos/<id>/normalized.mp4", "exp": <unix s>, "iat": <unix s> }
 * The Worker enforces `claims.key === <objectKey from the path>`, so a token
 * leaked for one object cannot be replayed against another.
 */

import { AwsClient } from "aws4fetch";
import { importSPKI, jwtVerify, type KeyLike } from "jose";

export interface Env {
  B2_S3_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_ACCESS_KEY_ID: string; // secret — read+write app key
  B2_SECRET_ACCESS_KEY: string; // secret
  CDN_JWT_PUBLIC_KEY: string; // SPKI PEM
  PRESIGN_SERVICE_TOKEN: string; // secret — shared with the Supabase orchestrator
  CACHE_TTL_SECONDS?: string;
  CORS_ALLOW_ORIGIN?: string;
  PRESIGN_MAX_EXPIRY_SECONDS?: string;
}

// Module-scoped caches so we parse the PEM / build the signer once per isolate.
let cachedPublicKey: KeyLike | undefined;
let cachedAws: { client: AwsClient; id: string } | undefined;

async function getPublicKey(env: Env): Promise<KeyLike> {
  if (!cachedPublicKey) {
    cachedPublicKey = await importSPKI(env.CDN_JWT_PUBLIC_KEY, "EdDSA");
  }
  return cachedPublicKey;
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

function extractToken(request: Request, url: URL): string | null {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("t");
}

// Reject path traversal / absolute keys before they reach a signature or cache
// key. Allowed: nested paths of safe object-key characters.
function isValidKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("..")) return false;
  return /^[A-Za-z0-9!_.*'()/\-]+$/.test(key);
}

// Constant-time string compare so the service-token check can't be timed.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Control plane: mint a presigned B2 URL (or list keys) for the orchestrator.
 *
 * Auth: `Authorization: Bearer <PRESIGN_SERVICE_TOKEN>` (server-to-server).
 * Body:
 *   { "key": string, "op": "GET" | "PUT" | "DELETE", "expiresIn"?: number }
 *   { "op": "LIST", "prefix": string, "maxKeys"?: number, "continuationToken"?: string }
 *
 * GET/PUT/DELETE presigns are scoped to exactly `key`, so one call can't grant
 * access to arbitrary objects. Content-Type is intentionally NOT signed: only
 * `host` is, so the uploading client can set any Content-Type without breaking
 * the signature (signing it would force a byte-exact echo and yield
 * SignatureDoesNotMatch on most browser PUTs).
 *
 * LIST is executed in-Worker (paginated ListObjectsV2) — used by admin delete
 * of a match prefix. The B2 app key needs listFiles + deleteFiles for these.
 */
async function handlePresign(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return deny(405, "Method not allowed", env);

  const provided = extractToken(request, new URL(request.url));
  if (!provided || !timingSafeEqual(provided, env.PRESIGN_SERVICE_TOKEN)) {
    return deny(401, "Bad service token", env);
  }

  let body: {
    key?: string;
    op?: string;
    expiresIn?: number;
    prefix?: string;
    maxKeys?: number;
    continuationToken?: string;
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

  const key = body.key ?? "";
  if (!isValidKey(key)) return deny(400, "Invalid or missing key", env);
  if (op !== "GET" && op !== "PUT" && op !== "DELETE") {
    return deny(400, "op must be GET, PUT, DELETE, or LIST", env);
  }

  const maxExpiry = Number(env.PRESIGN_MAX_EXPIRY_SECONDS ?? "3600");
  const expiresIn = Math.min(
    Math.max(Number(body.expiresIn) || 900, 60),
    maxExpiry,
  );

  const b2Url = new URL(`${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeURI(key)}`);
  b2Url.searchParams.set("X-Amz-Expires", String(expiresIn));

  const signed = await getAws(env).sign(b2Url.toString(), {
    method: op,
    aws: { signQuery: true },
  });

  return new Response(
    JSON.stringify({
      url: signed.url,
      method: op,
      key,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(env) } },
  );
}

/** S3 ListObjectsV2 under a prefix; service-token only (via handlePresign). */
async function handleList(
  body: { prefix?: string; maxKeys?: number; continuationToken?: string },
  env: Env,
): Promise<Response> {
  const prefix = body.prefix ?? "";
  // Prefixes often end with `/` (match folder). Empty prefix = whole bucket (ops only).
  if (
    prefix.length > 1024 ||
    prefix.startsWith("/") ||
    prefix.includes("..") ||
    (prefix !== "" && !/^[A-Za-z0-9!_.*'()/\-]+$/.test(prefix))
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
    m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
  const nextMatch = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
  const nextContinuationToken = nextMatch
    ? nextMatch[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
    : null;

  return new Response(
    JSON.stringify({
      op: "LIST",
      prefix,
      keys,
      isTruncated: truncated,
      nextContinuationToken,
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(env) } },
  );
}

/** Data plane: token-gated, cached delivery of a private object. */
async function serveDelivery(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return deny(405, "Method not allowed", env);
  }

  const url = new URL(request.url);
  const objectKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!isValidKey(objectKey)) return deny(404, "Not found", env);

  // --- 1. Verify the view token -------------------------------------------
    const token = extractToken(request, url);
    if (!token) return deny(401, "Missing view token", env);

    let claims: { key?: string };
    try {
      const publicKey = await getPublicKey(env);
      const result = await jwtVerify(token, publicKey, { algorithms: ["EdDSA"] });
      claims = result.payload as { key?: string };
    } catch {
      return deny(403, "Invalid or expired token", env);
    }
    // Bind the token to this exact object so it can't be replayed elsewhere.
    if (claims.key !== objectKey) {
      return deny(403, "Token does not grant this object", env);
    }

    // --- 2. Serve from Cloudflare's edge cache or sign a read to B2 ----------
    // Canonical cache key: the clean path, WITHOUT the per-user token. All
    // viewers of the same object therefore share one cached copy, and the SigV4
    // signature never pollutes the cache key. Method is folded in so a bodyless
    // HEAD entry can't be served to a later GET.
    const cacheKey = `${url.origin}/${objectKey}#${request.method}`;
    const ttl = Number(env.CACHE_TTL_SECONDS ?? "86400");

    const b2Url = `${env.B2_S3_ENDPOINT}/${env.B2_BUCKET}/${encodeURI(objectKey)}`;

    // Sign with the signature in the QUERY string (signQuery) rather than the
    // Authorization header: a request carrying `Authorization` is treated as
    // private and bypasses Cloudflare's cache. Query-signed requests cache fine,
    // and we override the cache key so the volatile signature is ignored.
    const aws = getAws(env);
    const signed = await aws.sign(b2Url, {
      method: request.method,
      aws: { signQuery: true },
    });

    const originRequest = new Request(signed.url, { method: request.method });
    // Forward Range so the player can seek; Cloudflare satisfies byte ranges
    // from the cached full object once it's warm.
    const range = request.headers.get("Range");
    if (range) originRequest.headers.set("Range", range);

    const originResponse = await fetch(originRequest, {
      cf: {
        cacheKey,
        cacheEverything: true,
        cacheTtl: ttl,
      },
    });

    if (originResponse.status === 403 || originResponse.status === 401) {
      // B2 rejected our credentials — surface as a server error, not a 403 to
      // the client (their token was already validated above).
      return deny(502, "Upstream storage auth failed", env);
    }
    if (originResponse.status === 404) return deny(404, "Not found", env);

    // Re-wrap so we can attach CORS + a sane public Cache-Control header.
    const headers = new Headers(originResponse.headers);
    headers.set("Cache-Control", `public, max-age=${ttl}`);
    headers.set("Accept-Ranges", "bytes");
    for (const [k, v] of Object.entries(corsHeaders(env))) headers.set(k, v);
    // Strip storage-specific noise.
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
