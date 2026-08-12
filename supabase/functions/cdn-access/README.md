# `cdn-access` edge function — CDN orchestrator

Issues access to B2 objects without holding B2 credentials: delivery URLs are
minted locally with the Ed25519 signing key; uploads/deletes are presigned by
the Cloudflare Worker's `/presign` route.

See `workers/cloudflare/cdn/README.md` for the full trust boundary.

## API

`POST /functions/v1/cdn-access`

```jsonc
// Public BWF delivery — no auth required
{ "op": "delivery", "key": "bwf/<match_id>/normalized.mp4" }
// → short-lived CDN URL (?t= JWT). Anyone may mint view tokens for bwf/.

// User delivery / upload / delete — Authorization: Bearer <supabase jwt>
{ "op": "delivery", "key": "users/<uid>/<match_id>/normalized.mp4" }
// → { "op":"delivery", "url":"https://cdn.mintonix.com/users/…/normalized.mp4?t=…",
//     "expiresAt":"…" }

// Upload — get a presigned PUT (client uploads DIRECT to B2)
{ "op": "upload", "key": "users/<uid>/<match_id>/original.mp4" }
// → { "op":"upload", "url":"https://s3.…/…?X-Amz-…", "method":"PUT", "key":"…", "expiresAt":"…" }

// Delete — get a presigned DELETE (client DELETEs DIRECT on B2)
{ "op": "delete", "key": "users/<uid>/<match_id>/original.mp4" }
// → { "op":"delete", "url":"https://s3.…/…?X-Amz-…", "method":"DELETE", "key":"…", "expiresAt":"…" }
```

The client then `PUT`s or `DELETE`s against that `url`. Content-Type is **not**
signed on upload, so the client may set any `Content-Type` (or none) — it won't
break the signature.

## Browser uploads need B2 bucket CORS ⚠️

The upload `url` points at `s3.…backblazeb2.com`, and the browser PUTs **directly
to B2** (not through the Worker). That cross-origin PUT fails unless the **B2
bucket has CORS rules** allowing `PUT` from your app origin. Set this on the
bucket (B2 UI or `b2 bucket update --cors-rules`), e.g. allow operations
`s3_put`, origin `https://app.mintonix.com`, headers `*`. Server-side uploads
(no browser) don't need this. Delivery GETs go through the Worker, so they're
unaffected.

## Authorization

| op | `bwf/…` | `users/<uid>/…` |
|----|---------|-----------------|
| **delivery** | **Public** (no JWT) | Logged-in user + own namespace |
| **upload** | Forbidden | User JWT + own namespace + basename allowlist (`original.mp4`, `annotation.json`) |
| **delete** | Forbidden | User JWT + own namespace (any basename under match) |

BWF media is publicly viewable via short-lived CDN tokens; B2 remains private.
User objects stay namespace-scoped. Admin/BWF cleanup uses CDN `/presign` with
the service token (e.g. `scripts/manage.py`).

Compute-worker outputs (`normalized.mp4`, `thumbnail.jpg`) are **not** minted
here — the service-authed job dispatcher writes them into the owner's prefix.

**Sharing (future):** to serve another user's object via a public/shared link,
look `key` up in a `shares` table on the `delivery` path and mint a token even
when the prefix isn't the caller's. The key never leaves the owner's namespace;
sharing is purely a read-side grant. See `TODO(sharing)` in `index.ts`.

## Secrets

```bash
supabase secrets set \
  CDN_JWT_PRIVATE_KEY="$(cat private.pem)"  `# from workers/cloudflare/cdn: pnpm keygen` \
  PRESIGN_SERVICE_TOKEN="<same value as the Worker secret>" \
  CDN_BASE_URL="https://cdn.mintonix.com" \
  CDN_PRESIGN_URL="https://cdn.mintonix.com/presign" \
  DELIVERY_TOKEN_TTL_SECONDS="300"
# SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
```

The matching values on the Worker side:
- `CDN_JWT_PUBLIC_KEY` (var) = the public half of `CDN_JWT_PRIVATE_KEY`.
- `PRESIGN_SERVICE_TOKEN` (secret) = identical to the one above.

## Deploy

CI deploys this function **and** applies the DB migrations automatically: a PR
targets the DEV project, a push to `master` targets PROD (see
[`.github/workflows/supabase.yml`](../../../.github/workflows/supabase.yml) and
the repo-root [`DEPLOYMENT.md`](../../../DEPLOYMENT.md)).

By hand:
```bash
supabase functions deploy cdn-access --project-ref <project-ref>   # DEV ref: xaxyuytvgcdbdnndhgwj
```
Or via the Supabase MCP `deploy_edge_function`.

Generate a service token once (shared with the Worker):
```bash
openssl rand -base64 32
```
