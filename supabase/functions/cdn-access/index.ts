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
 *
 * Secrets this function holds (set with `supabase secrets set`):
 *   CDN_JWT_PRIVATE_KEY     Ed25519 PKCS8 PEM — mints view tokens (NOT a B2 cred)
 *   PRESIGN_SERVICE_TOKEN   shared secret to call the Worker's /presign
 *   CDN_BASE_URL            e.g. https://cdn.mintonix.com  (delivery origin)
 *   CDN_PRESIGN_URL         e.g. https://cdn.mintonix.com/presign
 *   DELIVERY_TOKEN_TTL_SECONDS  optional, default 300
 * SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
 *
 * AUTHORIZATION: authn-only stub. We confirm the caller is a logged-in user but
 * do NOT yet check that *this* user may touch *this* key.
 * TODO(authz): gate `key` against an ownership table or a users/<uid>/ prefix
 * before this serves real multi-user data. See README "Authorization".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "https://esm.sh/jose@5.9.6";

interface RequestBody {
  op?: "delivery" | "upload";
  key?: string;
  expiresIn?: number;
}

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

async function mintUploadUrl(key: string): Promise<Response> {
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
    body: JSON.stringify({ key, op: "PUT" }),
  });

  if (!resp.ok) {
    return json(502, { error: "presign failed", status: resp.status });
  }
  // { url, method: "PUT", key, expiresAt } from the Worker.
  return json(200, { op: "upload", ...(await resp.json()) });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  // --- Authenticate the caller (authn-only stub) ----------------------------
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

  // TODO(authz): enforce that `user.id` may access `key` (ownership table or a
  // users/<user.id>/ prefix) before going to production. The WRITE path is the
  // urgent one: authn-only means any logged-in user can presign a PUT to ANY
  // key and overwrite/squat another user's object. Gate `upload` first.

  switch (body.op) {
    case "delivery":
      return mintDeliveryUrl(key);
    case "upload":
      return mintUploadUrl(key);
    default:
      return json(400, { error: 'op must be "delivery" or "upload"' });
  }
});
