/**
 * cdn-access — the CDN orchestrator.
 *
 * Issues access to B2 objects WITHOUT ever holding B2 credentials:
 *
 *   op = "delivery"  → mints a short-lived Ed25519 view token and returns a
 *                      CDN URL. Public for `bwf/…` (no auth). User-owned
 *                      `users/<uid>/…` requires a logged-in user JWT.
 *   op = "upload"    → presigned PUT (user JWT + own namespace + basename allowlist)
 *   op = "delete"    → presigned DELETE (user JWT + own namespace)
 *
 * Secrets (set with `supabase secrets set`):
 *   CDN_JWT_PRIVATE_KEY, PRESIGN_SERVICE_TOKEN, CDN_BASE_URL, CDN_PRESIGN_URL
 *   DELIVERY_TOKEN_TTL_SECONDS  optional, default 300
 *   CORS_ALLOW_ORIGIN           production: app origin (default * for local)
 */

// npm: (not esm.sh) — CI/deploy bundle must not depend on a live CDN (522s).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

interface RequestBody {
  op?: "delivery" | "upload" | "delete";
  key?: string;
  expiresIn?: number;
}

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ALLOW_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

/** Client-writable basenames under users/<uid>/<match_id>/. */
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
  return json(200, { op: clientOp, ...(await resp.json()) });
}

async function requireUser(request: Request): Promise<
  { user: { id: string } } | Response
> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return json(401, { error: "Not authenticated" });
  return { user };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") return json(405, { error: "Use POST" });

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const key = body.key ?? "";
  if (!isValidKey(key)) return json(400, { error: "Invalid or missing key" });

  const op = body.op;
  const isBwf = key.startsWith("bwf/");
  const isUserNs = key.startsWith("users/");

  // --- Public BWF delivery (no auth) ----------------------------------------
  // Product: BWF broadcast assets are publicly viewable. Tokens are still
  // short-lived JWTs so B2 stays private and the CDN edge remains the gate.
  if (op === "delivery" && isBwf) {
    // bwf/<match_id>/<file> — at least 3 segments.
    const parts = key.split("/");
    if (parts.length < 3 || !parts[1] || !parts[2]) {
      return json(400, { error: "bwf delivery key must be bwf/<match_id>/<file>" });
    }
    return mintDeliveryUrl(key);
  }

  // --- Authenticated user namespace ----------------------------------------
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  if (isBwf) {
    // Upload/delete never allowed on system-owned BWF prefixes.
    return json(403, { error: "Forbidden: bwf/ is not writable via cdn-access" });
  }

  if (!isUserNs) {
    return json(403, {
      error: "Forbidden: key must be under users/<uid>/ or bwf/ (delivery only)",
    });
  }

  const namespace = `users/${user.id}/`;
  if (!key.startsWith(namespace)) {
    return json(403, { error: "Forbidden: key is outside your namespace" });
  }

  const parts = key.split("/");
  const underMatch = parts.length >= 4 && !!parts[2];

  switch (op) {
    case "delivery":
      return mintDeliveryUrl(key);
    case "upload": {
      const basename = key.slice(key.lastIndexOf("/") + 1);
      if (!UPLOAD_BASENAME_ALLOW.has(basename)) {
        return json(403, {
          error: `upload key basename must be one of: ${[...UPLOAD_BASENAME_ALLOW].join(", ")}`,
        });
      }
      if (!underMatch) {
        return json(400, {
          error: "upload key must be users/<uid>/<match_id>/<file>",
        });
      }
      return mintPresigned(key, "PUT", "upload");
    }
    case "delete": {
      if (!underMatch) {
        return json(400, {
          error: "delete key must be users/<uid>/<match_id>/<file>",
        });
      }
      return mintPresigned(key, "DELETE", "delete");
    }
    default:
      return json(400, {
        error: 'op must be "delivery", "upload", or "delete"',
      });
  }
});
