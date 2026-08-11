# Mintonix CDN edge Worker (`workers/cloudflare/cdn`)

The **sole holder of Backblaze B2 credentials**. It serves a private B2 bucket
through **Cloudflare's CDN** and presigns B2 URLs on behalf of the orchestrator.
Two planes:

- **Data plane** — `GET /<key>?t=<jwt>`: token-gated, cached delivery of private
  objects to end users. Proxied through the Worker so it stays cached.
- **Control plane** — `POST /presign`: the Supabase orchestrator (service-token
  authed) asks for a presigned **GET** / **PUT** / **DELETE**, a **MULTIPART**
  session (CreateMultipartUpload + part/complete/abort URLs), or a **LIST** of
  keys under a prefix. Signed part/GET/PUT/DELETE URLs hit B2 directly; LIST
  and CreateMultipartUpload run in the Worker.

Why Cloudflare in front of B2: Backblaze and Cloudflare are **Bandwidth Alliance**
partners, so egress from B2 → Cloudflare is **free**. Users stream from Cloudflare's
edge cache; cache-fill from B2 costs nothing.

## Trust boundary (the design rule)

B2 credentials live in **exactly one place — this Worker**. **No Vast/RunPod
compute worker ever holds a credential** — they only receive presigned URLs,
exactly as `workers/vast/video-preprocess/normalize.py` already works.

| Component | Holds | Can it... |
|---|---|---|
| **Orchestrator** (`supabase/functions/cdn-access`) | JWT **private** key + `/presign` service token | mint view tokens ✔, touch B2 directly ✗ |
| **This Worker** (CF edge) | B2 **read+write+delete** key + JWT **public** key + service token | read/write/delete/list B2 ✔, mint view tokens ✗ |
| **Vast/ML/analysis workers** | nothing | — |

The view token is **asymmetric**, so the orchestrator mints and the edge only
verifies. The B2 key needs **list+read+write+delete** because `/presign` issues
presigned PUT/DELETE and runs LIST (presigned URLs inherit the signer's
permissions).

## Request flow

```
Delivery (data plane, cached):
  client ─ GET cdn/<key>?t=<jwt> ─▶ Worker
     1. verify JWT (public key) + exp + claims.key === path
     2. SigV4 GET to private B2 (signQuery)
     3. fetch cf.cacheKey = clean path → edge cache ◀─ free egress ─ B2

Upload (control plane, direct to B2):
  orchestrator ─ POST /presign {key, op:PUT} (Bearer service-token) ─▶ Worker
     → presigned PUT URL ─▶ client uploads straight to B2 (not cached)
```

The delivery cache key is the **path only** (token stripped), so every viewer of
an object shares one cached copy and seek/`Range` requests are served from the
edge. Both the view token and each `/presign` call are bound to one `key`, so
neither can be replayed against another object.

## One-time setup

### 1. B2 side
- Create (or reuse) the **private** delivery bucket.
- Create a B2 **application key restricted to that bucket** with
  `listFiles`, `readFiles`, `writeFiles`, and `deleteFiles`. Write is required
  for presigned PUTs; delete for presigned DELETEs (user/admin cleanup); list
  for prefix LIST used by match deletion. Still scoped to the one bucket.
- Note your S3 endpoint + region, e.g. `https://s3.us-west-004.backblazeb2.com`
  and `us-west-004`.

### 2. Install + generate the JWT keypair + service token
```bash
cd workers/cloudflare/cdn
pnpm install
pnpm keygen                 # prints a PUBLIC and a PRIVATE Ed25519 key
openssl rand -base64 32     # the shared /presign service token
```
- Put the **PUBLIC** key in `wrangler.toml` → `CDN_JWT_PUBLIC_KEY`.
- Store the **PRIVATE** key + the **service token** in the orchestrator's secrets
  (`supabase/functions/cdn-access`). The Worker never sees the private key.

### 3. Configure the Worker
- Fill the non-secret `[vars]` in `wrangler.toml` (endpoint, region, bucket,
  public key, TTL, CORS origin, max presign expiry).
- Set the secrets:
```bash
wrangler secret put B2_ACCESS_KEY_ID       # read+write keyID
wrangler secret put B2_SECRET_ACCESS_KEY   # read+write applicationKey
wrangler secret put PRESIGN_SERVICE_TOKEN  # same value the function holds
```
- For local `wrangler dev`, copy `.dev.vars.example` → `.dev.vars` with the same
  values.

### 4. Custom domain (required for real CDN caching)
Uncomment the `routes` block in `wrangler.toml` and point `cdn.mintonix.com` at
the Worker as a **custom domain** (the zone must be on Cloudflare). `workers.dev`
does not give you the full edge cache or the free-egress path.

### 5. Deploy

CI deploys automatically — a PR deploys `--env dev`, a push to `master` deploys
`--env prod` (see [`.github/workflows/cloudflare-cdn.yml`](../../../.github/workflows/cloudflare-cdn.yml)
and the repo-root [`DEPLOYMENT.md`](../../../DEPLOYMENT.md)). To deploy by hand:
```bash
pnpm deploy:dev     # Worker mintonix-cdn-dev  → dev bucket
pnpm deploy:prod    # Worker mintonix-cdn       → prod bucket
```
Note there are **two Workers / two buckets** (`[env.dev]` and `[env.prod]` in
`wrangler.toml`); secrets are scoped per Worker, so set them with
`wrangler secret put <NAME> --env dev|prod`.

## The orchestrator

The user-facing entry point is the Supabase function
`supabase/functions/cdn-access` — it authenticates the user, then mints a
delivery URL or calls this Worker's `/presign`. See that function's README.

For local Worker testing without the function, `pnpm sign` mints a view token
directly from the private key:
```bash
CDN_JWT_PRIVATE_KEY="$(cat private.pem)" \
  pnpm sign videos/abc/normalized.mp4 300
# -> eyJ... ; then GET https://cdn.mintonix.com/videos/abc/normalized.mp4?t=eyJ...
```

Exercise the control plane directly:
```bash
curl -sX POST https://cdn.mintonix.com/presign \
  -H "Authorization: Bearer $PRESIGN_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"users/u1/m1/original.mp4","op":"PUT"}'
# -> { "url": "https://s3.…?X-Amz-…", "method":"PUT", "key":"…", "expiresAt":"…" }

curl -sX POST https://cdn.mintonix.com/presign \
  -H "Authorization: Bearer $PRESIGN_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"users/u1/m1/original.mp4","op":"DELETE"}'
# -> { "url": "…", "method":"DELETE", "key":"…", "expiresAt":"…" }

# Large pipeline outputs (normalized.mp4 / original.mkv): parallel multipart
curl -sX POST https://cdn.mintonix.com/presign \
  -H "Authorization: Bearer $PRESIGN_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"key":"bwf/<match_id>/normalized.mp4","op":"MULTIPART","parts":256,"partSize":67108864}'
# -> { "op":"MULTIPART", "part_urls":[…], "complete_url":"…", "abort_url":"…",
#      "part_size":67108864, "uploadId":"…", "expiresAt":"…" }

curl -sX POST https://cdn.mintonix.com/presign \
  -H "Authorization: Bearer $PRESIGN_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"op":"LIST","prefix":"bwf/<match_id>/"}'
# -> { "op":"LIST", "prefix":"…", "keys":[…], "isTruncated":false, … }
```

## Verify edge caching after first deploy (important)

Functionality (private bucket + streaming + **free B2→Cloudflare egress**) works
regardless of cache hits. But the *acceleration/offload* benefit depends on two
things that are **only observable on the deployed custom domain** — `wrangler dev`
and typecheck cannot confirm them:

1. `cf.cacheKey` is honored on your zone (otherwise the volatile signed URL
   becomes the key → 0% hits).
2. Cloudflare populates the cache from the `Range` (`206`) request players send.

Check by requesting the same object + same Range twice and watching the header:
```bash
curl -sD- -o/dev/null -H 'Range: bytes=0-1023' \
  'https://cdn.mintonix.com/videos/x/normalized.mp4?t=<jwt>' | grep -i cf-cache-status
# want: MISS on the 1st call, HIT on the 2nd
```
If it stays `MISS`, fall back to the Cache-API + full-object recipe (store a full
`200`, let `cache.match` slice ranges) instead of `cf.cacheEverything`.

## Notes / tradeoffs

- Delivery responses use **`Cache-Control: private, max-age=…`** (short client
  max-age; edge→B2 cache is separate and still JWT-gated every request).
- JWT **must** include `exp`; Worker also caps remaining lifetime.
- `/presign` accepts **Bearer service token only** (not `?t=`).
- `LIST` requires a **non-empty prefix** (no whole-bucket list).
- **TTL**: keep view-token TTL short (minutes). The *cached object* lives much
  longer (`CACHE_TTL_SECONDS`); the token only gates the initial fetch, so a
  short TTL doesn't hurt cache hit rate.
- **Token in the query string** lands in CF logs, `Referer`, and browser history.
  The short TTL is the mitigation — keep the orchestrator's TTL to minutes.
- **Ed25519 JWT verify** runs on WebCrypto in workerd; confirm one real token
  verifies under `wrangler dev` before relying on it.
- **Invalidation**: if you overwrite an object key, purge it (`wrangler` /
  dashboard / cache API) or version the key (`.../v2/normalized.mp4`).
- Delivery is token-gated; **writes** go through `/presign` (orchestrator
  service token → presigned PUT/DELETE/MULTIPART for workers and clients).

## See also

- [DATAFLOWS.md](DATAFLOWS.md) — request paths in detail
- [DEPLOYMENT.md](DEPLOYMENT.md) — env / deploy checklist
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) — trust model
- [../../../supabase/README.md](../../../supabase/README.md) — `cdn-access` + key layout
- [../../vast/video-preprocess/README.md](../../vast/video-preprocess/README.md) — first consumer of multipart presigns
