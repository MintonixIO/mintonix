# Deployment

Push-to-deploy across Cloudflare + Supabase, split into **dev** and **prod**.

| Branch / event | Cloudflare Worker | Supabase (DB + `cdn-access`) |
|---|---|---|
| **Pull request** (touching the relevant paths) | deploys `mintonix-cdn-dev` (dev bucket) | applies migrations + deploys the function to the **DEV** project |
| **Push to `master`** | deploys `mintonix-cdn` (prod bucket) | applies migrations + deploys the function to the **PROD** project |

So opening a PR gives you a fully live **dev** stack to test against; merging to `master` promotes the same change to **prod**.

## What CI automates

| Workflow | Trigger (paths) | Does |
|---|---|---|
| [`.github/workflows/cloudflare-cdn.yml`](.github/workflows/cloudflare-cdn.yml) | `workers/cloudflare/cdn/**` | typecheck + `wrangler deploy --env dev\|prod` |
| [`.github/workflows/supabase.yml`](.github/workflows/supabase.yml) | `supabase/**` | `supabase db push` + `supabase functions deploy cdn-access` |
| [`.github/workflows/match-data.yml`](.github/workflows/match-data.yml) | `workers/github/match-data/**` + weekly cron | scrape BWF → load rows into the DB |
| [`.github/workflows/video-normalization.yml`](.github/workflows/video-normalization.yml) | `workers/vast/video-normalization/**` | build + test + push the GHCR image |

Both deploy workflows pick dev vs prod with the same expression
`github.event_name == 'pull_request' && 'dev' || 'prod'`, selecting the matching
**GitHub Environment** and (for Cloudflare) the matching `wrangler` env.

## One-time manual setup

CI deploys *code*; it does not provision infrastructure or hold the long-lived
secrets. Do each of these **once per environment** (a dev column and a prod
column). Keeping the B2 key and presign token out of CI is deliberate — it keeps
your only B2 read+write credential off GitHub.

### 1. GitHub repo → Settings → Environments: `dev` and `prod`

Each environment holds:

| Name | Kind | Used by |
|---|---|---|
| `SUPABASE_URL` | **var** | supabase.yml (project ref is derived from it) + match-data.yml |
| `SUPABASE_ACCESS_TOKEN` | secret | supabase.yml (`supabase login`) |
| `SUPABASE_DB_PASSWORD` | secret | supabase.yml (`db push`) |
| `SUPABASE_SERVICE_KEY` | secret | match-data.yml |
| `CLOUDFLARE_API_TOKEN` | secret* | cloudflare-cdn.yml (scope: *Edit Workers*) |
| `CLOUDFLARE_ACCOUNT_ID` | secret* | cloudflare-cdn.yml |

\* The two Cloudflare values are the same for both environments (one account), so
they can live as **repo** secrets instead of being duplicated per environment.
The project ref is **derived** from `SUPABASE_URL` (`<ref>.supabase.co`), so no
separate `SUPABASE_PROJECT_ID` secret is needed.

### 2. Generate a keypair + service token PER environment

```bash
cd workers/cloudflare/cdn
pnpm keygen              # Ed25519 public + private — make one pair for dev, one for prod
openssl rand -base64 32  # the PRESIGN_SERVICE_TOKEN — one per environment
```

- The **public** key goes in `wrangler.toml` under `[env.<env>.vars] CDN_JWT_PUBLIC_KEY`.
- The **private** key goes in that env's Supabase function secrets (next step).
- The **service token** goes in BOTH the Worker secret and the function secret
  for that env — they must be byte-identical.

### 3. Cloudflare Worker config + secrets (per env)

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

### 4. Supabase function secrets (per project)

```bash
supabase secrets set --project-ref <dev-ref> \
  CDN_JWT_PRIVATE_KEY="$(cat dev-private.pem)" \
  PRESIGN_SERVICE_TOKEN="<dev service token from step 2>" \
  CDN_BASE_URL="https://cdn-dev.mintonix.com" \
  CDN_PRESIGN_URL="https://cdn-dev.mintonix.com/presign" \
  DELIVERY_TOKEN_TTL_SECONDS="300"
# ...repeat with the prod ref + prod values.
```

(`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected by the platform.)

### 5. Backblaze B2 (per bucket)

- Create the **dev** and **prod** private buckets.
- Create a **read+write** application key scoped to each bucket (write is needed
  because `/presign` issues presigned PUTs).
- For browser direct-PUT uploads, add **CORS** rules on each bucket allowing
  `PUT` from your app origin (see the `cdn-access` README).

### 6. First run ordering & migration history

On a brand-new project, run the **supabase** workflow before the **match-data**
load (the migrations create the tables the loader writes to). After that the
workflows are independent.

If you wire in a project whose tables were created **outside** migrations (SQL
editor / MCP), its `schema_migrations` won't list the files and the first
`db push` will re-run them and fail on "already exists". Reconcile first:
`supabase migration repair --status applied <version>` for each. (As of this
writing both the DEV `xaxyuytvgcdbdnndhgwj` and PROD `grkaepnplgotsxdudlfn`
projects already record all four migrations, so the first `db push` is a no-op.)

## Still manual by design

- **Vast/RunPod**: CI builds + pushes the image to GHCR; deploying it to a GPU
  host is still a separate step.
- **Authorization**: `cdn-access` is an authn-only stub today — gate `key`
  against ownership before real multi-user prod traffic (see its README).
