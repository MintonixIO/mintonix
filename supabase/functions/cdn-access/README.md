# `cdn-access` edge function — CDN orchestrator

Authenticates a Supabase user, then issues access to private B2 objects. It
holds **no B2 credentials**: delivery URLs are minted locally with the Ed25519
signing key; uploads are presigned by the Cloudflare Worker's `/presign` route.

See `workers/cloudflare/cdn/README.md` for the full trust boundary.

## API

`POST /functions/v1/cdn-access` with the user's `Authorization: Bearer <supabase jwt>`.

```jsonc
// Delivery — stream a normalized video through the cached CDN
{ "op": "delivery", "key": "videos/abc/normalized.mp4" }
// → { "op":"delivery", "url":"https://cdn.mintonix.com/videos/abc/normalized.mp4?t=…",
//     "expiresAt":"…" }

// Upload — get a presigned PUT (client uploads DIRECT to B2)
{ "op": "upload", "key": "users/<uid>/raw/clip.mov" }
// → { "op":"upload", "url":"https://s3.…/…?X-Amz-…", "method":"PUT", "key":"…", "expiresAt":"…" }
```

The client then `PUT`s the file to that `url`. Content-Type is **not** signed,
so the client may set any `Content-Type` (or none) — it won't break the
signature.

## Browser uploads need B2 bucket CORS ⚠️

The upload `url` points at `s3.…backblazeb2.com`, and the browser PUTs **directly
to B2** (not through the Worker). That cross-origin PUT fails unless the **B2
bucket has CORS rules** allowing `PUT` from your app origin. Set this on the
bucket (B2 UI or `b2 bucket update --cors-rules`), e.g. allow operations
`s3_put`, origin `https://app.mintonix.com`, headers `*`. Server-side uploads
(no browser) don't need this. Delivery GETs go through the Worker, so they're
unaffected.

## Authorization status

⚠️ **Authn-only stub.** The function verifies the caller is logged in but does
**not** yet check that this user may touch this `key` (see the `TODO(authz)` in
`index.ts`). **The write path is the urgent one** — any logged-in user can
presign a PUT to *any* key and overwrite another user's object. Before real
multi-user data, gate `key` (ownership table or a `users/<user.id>/` prefix),
starting with `upload`.

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
