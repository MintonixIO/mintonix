# Deployment

Cloudflare (CDN Worker) and Supabase (DB + `cdn-access`) are deployed **manually** —
there is no CI for them. This is deliberate: this branch is meant to merge into
`master` and be wired into the larger app without any deploy automation firing.

The two remaining workflows are unrelated to the CDN/Supabase deploy and are
narrowly path-scoped, so a merge that doesn't touch their paths won't trigger them:

| Workflow | Trigger (paths) | Does |
|---|---|---|
| [`.github/workflows/match-data.yml`](.github/workflows/match-data.yml) | `workers/github/match-data/**` + weekly cron | scrape BWF → load rows into the DB |
| [`.github/workflows/video-preprocess.yml`](.github/workflows/video-preprocess.yml) | `workers/vast/video-preprocess/**` | build + test + push the GHCR image |

## Manual deploy

### Cloudflare Worker

```bash
cd workers/cloudflare/cdn
wrangler deploy --env dev     # mintonix-cdn-dev (dev bucket)
wrangler deploy --env prod    # mintonix-cdn    (prod bucket)
```

### Supabase (migrations + functions)

```bash
supabase db push --project-ref <ref>
supabase functions deploy cdn-access        --project-ref <ref>
supabase functions deploy normalize-video   --project-ref <ref>
supabase functions deploy normalize-callback --project-ref <ref> --no-verify-jwt
# DEV ref: xaxyuytvgcdbdnndhgwj   PROD ref: grkaepnplgotsxdudlfn
```

Or deploy functions via the Supabase MCP `deploy_edge_function`.

## One-time setup (per environment)

Keeping the B2 key and presign token off GitHub is deliberate — it keeps your
only B2 read+write credential local. Do each of these **once per environment**
(a dev set and a prod set).

### 1. Generate a keypair + service token PER environment

```bash
cd workers/cloudflare/cdn
pnpm keygen              # Ed25519 public + private — one pair for dev, one for prod
openssl rand -base64 32  # the PRESIGN_SERVICE_TOKEN — one per environment
```

- The **public** key goes in `wrangler.toml` under `[env.<env>.vars] CDN_JWT_PUBLIC_KEY`.
- The **private** key goes in that env's Supabase function secrets (step 3).
- The **service token** goes in BOTH the Worker secret and the function secret
  for that env — they must be byte-identical.

### 2. Cloudflare Worker config + secrets (per env)

Fill the committed `[env.dev.vars]` / `[env.prod.vars]` blocks in
[`wrangler.toml`](workers/cloudflare/cdn/wrangler.toml) (endpoint, region,
bucket, public key), then set the secrets — they're scoped per Worker name:

```bash
cd workers/cloudflare/cdn
wrangler secret put B2_ACCESS_KEY_ID       --env dev    # repeat with --env prod
wrangler secret put B2_SECRET_ACCESS_KEY   --env dev    # repeat with --env prod
wrangler secret put PRESIGN_SERVICE_TOKEN  --env dev    # repeat with --env prod
```

Prod also needs the custom domain (`routes` block in `wrangler.toml`, e.g.
`cdn.mintonix.com`) for edge caching + free B2 egress. Dev runs fine on
`*.workers.dev`.

### 3. Supabase function secrets (per project)

```bash
supabase secrets set --project-ref <dev-ref> \
  CDN_JWT_PRIVATE_KEY="$(cat dev-private.pem)" \
  PRESIGN_SERVICE_TOKEN="<dev service token from step 1>" \
  CDN_BASE_URL="https://cdn-dev.mintonix.com" \
  CDN_PRESIGN_URL="https://cdn-dev.mintonix.com/presign" \
  DELIVERY_TOKEN_TTL_SECONDS="300"
# ...repeat with the prod ref + prod values.
```

The compute pathway (`jobs` dispatch/callback) additionally needs
`JOB_TOKEN_SECRET`, `VAST_NORMALIZE_ENDPOINT_NAME`,
`VAST_DETECT_ENDPOINT_NAME`, `VAST_API_KEY` — see
`supabase/functions/jobs/index.ts` and `supabase/README.md`.

(`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected by the platform.)

### 4. Backblaze B2 (per bucket)

- Create the **dev** and **prod** private buckets.
- Create a **read+write** application key scoped to each bucket (write is needed
  because `/presign` issues presigned PUTs).
- For browser direct-PUT uploads, add **CORS** rules on each bucket allowing
  `PUT` from your app origin (see the `cdn-access` README).

### 5. Migration history

If you wire in a project whose tables were created **outside** migrations (SQL
editor / MCP), its `schema_migrations` won't list the files and the first
`db push` will re-run them and fail on "already exists". Reconcile first:
`supabase migration repair --status applied <version>` for each. (As of this
writing both the DEV `xaxyuytvgcdbdnndhgwj` and PROD `grkaepnplgotsxdudlfn`
projects already record all four migrations, so the first `db push` is a no-op.)

## Still manual by design

- **Vast/RunPod**: CI builds + pushes the image to GHCR; deploying it to a GPU
  host is still a separate step.
