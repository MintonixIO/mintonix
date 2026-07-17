# `cdn-access` edge function — CDN orchestrator

Authenticates a Supabase user, then issues access to private B2 objects. It
holds **no B2 credentials**: delivery URLs are minted locally with the Ed25519
signing key; uploads are presigned by the Cloudflare Worker's `/presign` route.

See `workers/cloudflare/cdn/README.md` for the full trust boundary.

## API

`POST /functions/v1/cdn-access` with the user's `Authorization: Bearer <supabase jwt>`.

```jsonc
// Delivery — stream a normalized video through the cached CDN
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

Two checks, both required:

1. **Authn** — `getUser()` must resolve a logged-in user (else `401`).
2. **Namespace** — `key` must start with `users/<user.id>/` (else `403`).
3. **Upload basename allowlist** — `op: "upload"` only allows `original.mp4` and
   `annotation.json` under `users/<uid>/<match_id>/…`. Pipeline outputs
   (`normalized.mp4`, etc.) are service-presigned by the job dispatcher, not
   clients.
4. **Delete** — `op: "delete"` allows any basename under
   `users/<uid>/<match_id>/…` (no allowlist) so a user can remove pipeline
   outputs when deleting a match. Still namespace-scoped.

Every user object lives under `users/<uid>/<match_id>/…` (see SUPABASE.md).
Access control is a prefix check with no DB lookup. System/BWF keys under
`bwf/<match_id>/` are not writable here (admin/BWF cleanup uses the CDN
Worker `/presign` with the service token, e.g. via `scripts/manage.py delete`).

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
