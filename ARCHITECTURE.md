# Mintonix — System Architecture

Badminton video analysis platform: ingest match footage (BWF broadcasts + user
uploads), normalize it, track shuttle and players, and produce 3D positions and
match analytics.

**Web (public):** marketing + BWF catalog live; dashboard workspace is preview-only. See MARKETING_BWF_CHECKLIST.md.

**Code organization** (colocate by use, split by real boundary, abstract on
second use) for agents and humans: **[AGENTS.md](./AGENTS.md)**. This file owns
system design and the trust model; AGENTS.md owns how we lay out and edit code.

Status legend: ✅ built · 🚧 partially built · 📐 designed, not built.

```
                 ┌─────────────── INGESTION ───────────────┐
  BWF backlog ──▶│                                          │
  BWF scraper ──▶│  match-data pipeline (GitHub Actions) ✅ │──▶ matches (players derived in web)
  User upload ──▶│  cdn-access presigned PUT ✅             │──▶ B2  users/<uid>/…
                 └──────────────────┬──────────────────────┘
                                    ▼  enqueue
                 ┌─────────────── PIPELINE (job queue 📐) ──┐
                 │ 1. normalize   (vast worker ✅)          │  BWF: + valid-frame cut,
                 │ 2. detect      (vast worker 🚧)          │       score OCR timeline
                 │ 3. analyze     (worker 📐)               │  3D shuttle/player, metrics
                 └──────────────────┬──────────────────────┘
                                    ▼  assets in B2, state in Postgres
                 ┌─────────────── DELIVERY ─────────────────┐
                 │ Cloudflare CDN worker ✅ (token-gated,    │
                 │ cached, free B2 egress)                   │
                 └──────────────────┬──────────────────────┘
                                    ▼
                   Web (Next.js) 🚧 · Mobile iOS+Android (Expo) 📐
```

---

## 1. Trust model (the invariant everything obeys)

**B2 credentials live in exactly one place: the Cloudflare CDN Worker**
(`workers/cloudflare/cdn`). Everything else operates on capabilities handed to
it per-request:

| Component | Holds | Gets |
|---|---|---|
| CF CDN Worker | B2 read+write key, JWT public key, `/presign` service token | — |
| Supabase edge functions | JWT private key, `/presign` service token, `JOB_TOKEN_SECRET`, `PIPELINE_SERVICE_TOKEN`, vast API key, service-role DB key | — |
| Vast GPU workers | **nothing** | presigned GET/PUT URLs + HMAC callback token + anon key |
| Clients (web/mobile) | Supabase anon key + user session | presigned PUT (upload), tokenized CDN URL (view) |

Any new service must fit one of these rows. In particular: compute workers
never receive DB credentials or B2 keys — they get presigned URLs in, presigned
URLs out, and an HMAC-scoped callback.

## 2. Ingestion — two sources, one canonical form

Every match, regardless of origin, converges to the same canonical form: **a
row in `matches` + objects in B2 under that match's constructable prefix**
(`bwf/<match_id>/` or `users/<uid>/<match_id>/`). Schema detail: **supabase/README.md**.

### 2a. BWF broadcast footage ✅ (metadata) / 📐 (video ingest)

- **Match metadata** — the weekly GitHub Actions pipeline
  (`workers/github/match-data`) scrapes BWF World Tour results and upserts into
  `matches` (content-hash `id`, four player name columns + scores +
  `source_url`). PRs apply to dev; master/schedule applies to prod. ✅
- **Backlog** — existing footage is staged under `bwf/<match_id>/original.mp4`
  via service `/presign`, then `matches-ingest` enqueues normalize. 📐
- **Steady state** — scraper sets `source_url` on `matches` only (catalog).
  Pipeline enqueue is separate (`matches-ingest` / ops); normalize then fetches
  YouTube (yt-dlp ✅) and archives to B2. (dispatch cron ✅)

**Rule: B2 is canonical.** A YouTube URL is fetched exactly once, at
normalize time; the normalized output lands in B2 and no later stage ever
touches YouTube again.

### 2b. User uploads ✅

1. Client generates a stable `match_id`, calls `cdn-access` (`op: "upload"`)
   with the user JWT → presigned PUT for
   `users/<uid>/<match_id>/original.mp4`. Authorization is a pure prefix check
   (`users/<uid>/…`), no DB lookup.
2. Client PUTs directly to B2 (bucket CORS must allow the app origin).
3. Client confirms via `matches-ingest` (user JWT, `{ id, upload: true }`) →
   `matches` row with `owner_id`, `jobs` row, pgmq message. ✅
   (dispatch: pg_cron every minute ✅; enqueue only on confirm)

### 2c. Court annotation & player labeling ✅ (inference) / 📐 (persistence)

Before (or after) processing, the user annotates into a single B2 file
`annotation.json` under the match prefix (shape: supabase/README.md):

- **Court corners** — 4 points. Required for BWF valid-frame extraction and
  for the 3D analysis stage (homography). Optional scoreboard crops for BWF.
- **Player labels** — the client runs point-prompted segmentation **in-browser**
  (SlimSAM-class via onnxruntime-web / transformers.js): click → mask → attach
  a name. For BWF, name choices come from the match roster columns
  (`team1_player1`…); for user matches they're free-form. Labels store click
  evidence only; track resolution happens in `analyze`.

Written via `cdn-access` presigned PUTs (`users/<uid>/…` allowlist includes
`annotation.json`). No `video_assets` registry and no `annotation_presets`
table in the MVP schema — BWF geometry may later come from config/service code
that materializes `annotation.json` under `bwf/<match_id>/`.

## 3. Storage layout (B2)

Two namespaces, one shape (see supabase/README.md for full layout):

```
users/<uid>/<match_id>/            # user-owned; RLS = owner
bwf/<match_id>/                    # system-owned (BWF); readable to signed-in
  original.<ext>          raw source (upload or yt-dlp fetch)
  annotation.json         court geometry + player labels   (client / service)
  normalized.mp4          ≤1080p/30fps H.264/AAC; BWF: cleaned cut is primary (normalize)
  thumbnail.jpg                                            (normalize)
  preprocess-log.json     frame shifts + worker + timings  (normalize)
  detections.json         per-frame pose + shuttle tracks  (detect)
  analysis.json           3D positions, metrics, resolved  (analyze)
```

User-authored data is files under the match prefix via `cdn-access`
(`users/<uid>/…` prefix rule + upload basename allowlist). `bwf/…` is
unwritable by clients. Canonical shape is `annotation.json` (supabase/README.md):

```jsonc
// annotation.json — court + labels (normalize court detect + analyze)
{ "court": {
    "corners": [[x,y],[x,y],[x,y],[x,y]],          // TL → TR → BR → BL
    "net_poles": [[x,y],[x,y]],                    // left, right (net pole tops)
    "scoreboard_crop": {"x":…,"y":…,"w":…,"h":…},  // optional
    "score_sub_crop":  {"x":…,"y":…,"w":…,"h":…},
    "row_split_y": …
  },
  "labels": [ { "frame_idx": …,
                "anchor": { "x": …, "y": …, "bbox": [x,y,w,h] },
                "side": 1, "slot": 1 } ] }   // side/slot → roster columns
```

Labels are resolved to pose-track ids by **analyze** (appearance embeddings
from `detect` + geometric prior). The mapping lands in `analysis.json` — never
written back into `annotation.json` — so re-running detect can't orphan a label.

There is no asset-registry table — keys are constructable under the match
prefix. Delivery is always a `cdn-access` delivery token → CDN Worker (cached,
free egress). If an object is regenerated, version the key (`…/v2/…`) or purge
the CDN cache.

## 4. The job pipeline

### Queue ✅

A Postgres-backed queue in Supabase (**pgmq via Supabase Queues**) plus a
`jobs` state table. **Enqueue is intentional only** (upload confirm /
`matches-ingest`, ops set-stage with `enqueue=true`, stage-advance/`retry`
in `complete_job`). Catalog scrape never enqueues GPU work. A dispatcher edge
function (**pg_cron every minute** → `invoke_jobs_dispatch` → pg_net POST
`/jobs/dispatch`) pops messages, presigns URLs, and POSTs to the appropriate
vast serverless endpoint.

Why a queue *in front of* vast's own autoscaler queue: priority (user uploads
preempt backlog), retries with visibility timeout, rate/cost caps on GPU
spend, and a single place to observe pipeline state. Two queues (or a priority
column): `interactive` (user-initiated) and `bulk` (backlog/scraper).

### One job contract for every stage ✅ (live wire format)

Stages share one **flat** envelope style (not a nested generic `source`/`outputs`
map). This section is the **SSOT for wire shapes and stage basenames** (callback
bodies, B2 object names for purge/dispatch/ops). Live code mirrors it by hand:

| Concern | TypeScript | Python |
|---|---|---|
| Stage → basenames, purge set | `supabase/functions/ops/stage_outputs.ts` | `scripts/ops_stage.py` (`STAGE_*`) |
| Callback settle | `supabase/functions/jobs` (`success` → DB `complete`) | workers POST callback |

There is no runtime `contracts/` package; a contract change must update this
section **and** the mirrors (and any worker parser tests) together.

#### Dispatcher → worker (normalize example)

PyWorker may wrap as `{ input: env }`.

```jsonc
{
  "request_id": "<job_id>",
  "input_url": "<presigned GET | YouTube URL>",
  "output_upload": { "part_urls": […], "complete_url": "…", "abort_url": "…", "part_size": 67108864 },
  "thumbnail_upload_url": "<presigned PUT>",
  "preprocess_log_upload_url": "<presigned PUT preprocess-log.json>",
  "annotation": { /* court.corners[4] + court.net_poles[2] required */ },
  "callback_url": "https://<ref>.supabase.co/functions/v1/jobs/callback",
  "callback_token": "<HS256 JWT: job_id, match_id, stage, attempt; aud=jobs-callback; 12h>"
}
// Worker route: POST /preprocess/sync (video-preprocess)
// Path mode: YouTube → BWF court cut; B2/CDN → full encode
// file:// not supported; frame_shifts live only in preprocess-log.json
```

#### Worker → `jobs/callback` (Bearer `callback_token`)

Wire status is **`success` | `failed`**. The jobs function maps `success` → DB
`jobs.status = complete` (and advances/requeues); `failed` → DB `failed`.

**Success** (optional stage probe fields allowed on success):

```json
{
  "request_id": "00000000-0000-4000-8000-000000000001",
  "status": "success",
  "frame_count": 1,
  "elapsed_sec": 0.1
}
```

**Failed:**

```json
{
  "request_id": "00000000-0000-4000-8000-000000000001",
  "status": "failed",
  "error": "example failure"
}
```

| Wire (`callback` body) | Meaning | DB after settle |
|---|---|---|
| `success` | Worker → jobs/callback success | `complete` |
| `failed` | Worker → jobs/callback failure | `failed` |

#### Stage artifacts (B2 basenames)

Canonical stage → object basenames for purge, dispatch completeness probes, and
ops.

**Stage order:** `normalize` → `detect` → `analyze`

| Stage | Outputs (delete when regressing *to* this stage or earlier) | Primary (completeness probe) |
|---|---|---|
| `normalize` | `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json` | `normalized.mp4` |
| `detect` | `detections.json` | `detections.json` |
| `analyze` | `analysis.json` | `analysis.json` |

**Never purge on stage regress** (`keep_on_regress`):

- `original.mp4`, `original.mov`, `original.mkv`
- `annotation.json`

Regression *to* stage S deletes S outputs **and** every later stage's outputs.
`outputsToPurge` / `outputs_to_purge` implement that set from the map above.

- Workers hold no credentials; the callback token is the only authorization.
  Single-use is state-machine based (`processing` + attempt/stage CAS), not a
  jti store.
- Progress Realtime is optional UX; **MVP detect/normalize omit mid-job
  streaming** and report only via `jobs/callback`.
- The jobs function's `/callback` route settles via `complete_job`, then
  **advances or requeues** (normalize → detect; analyze not wired). Dispatch
  and callback live in ONE function (`jobs`) because they share what must never
  drift: the stage routing table, the token mint/verify pair, the queue
  semantics.

### Stages

| Stage | Worker | Status | In | Out |
|---|---|---|---|---|
| `normalize` | `workers/vast/video-preprocess` (`POST /preprocess/sync`) | ✅ | original / YouTube URL (worker yt-dlp ✅); always annotation.json (corners + net poles for later stages). Path: YouTube→BWF court cut, B2/CDN→full encode; `file://` not supported | normalized.mp4, thumbnail.jpg, preprocess-log.json |
| `detect` | `workers/vast/video-det` | 🚧 worker + `STAGES.detect` wired; analyze next; embedding module 📐 | normalized.mp4 (BWF cut already primary) | detections.json (pose + TrackNetV5 **top-K shuttle candidates** in **source-frame** UV [0,1] + optional exclusive ReID). `server.py` + `detect/` + `pose/` |
| `analyze` | `workers/…/analysis` | 📐 | detections.json + annotation.json | analysis.json: 3D shuttle trajectory (physics fit), player ground-plane positions (homography), metrics (TBD) |

`analyze` is CPU-dominant (geometry + curve fitting, no NN inference) — it can
run on cheap CPU serverless rather than a GPU pool, but it still speaks the
same job envelope.

**Re-ID embedding module** (in `detect`, 📐): every person track gets an
appearance embedding — crops sampled every N frames, batched through a small
re-ID or foundation model (OSNet, or DINOv2-small if cross-video profile
matching becomes a goal), reduced to a per-track centroid in
`detections.json`. Marginal GPU cost: the crops are tiny next to pose +
shuttle inference on the same device. Crops are tightened using the pose
keypoints detect already has (suppressing background/opponent pixels); the
annotation-time mask is never an input — it *names* a track, it doesn't
model identity. Three consumers: the tracker (re-linking track fragments
across camera cuts), analyze's label resolution (§3), and later player
profiles across videos. Within one match, kit color nearly separates two
players on its own — the embeddings earn their keep on fragmentation,
occlusion at the net, and cross-shot/cross-video identity.

BWF vs user is **not** a different pipeline — it's the same chain. BWF may
carry a thin `valid_frames_config` from `annotation.json` (court corners +
player names; scoreboard crops only if stored) and roster names on
`matches.team*_player*`; the worker fills missing scoreboard geometry after
probe. User jobs typically normalize without valid-frames. See supabase/README.md.

## 5. Supabase: auth, tables, RLS

### Auth

Supabase Auth is the single identity system for all three clients (web and the
Expo apps use the same `supabase-js` session). Edge functions authenticate the
user JWT (`getUser()`); object-level authorization is the
`users/<uid>/` prefix rule; row-level is RLS. The service-role key exists only
inside edge functions and the match-data loader.

### Tables

**Canonical schema: supabase/README.md** (migration
`supabase/migrations/20260712000000_init_match_pipeline.sql`).

```
matches   product object: id, owner_id (null ⇒ BWF), source_url, tournament,
          match_date, four player name columns, game scores, status rollup,
          probe fields (duration/width/height/fps)
jobs      one pipeline run per match; stage advances in place
          (normalize|detect|analyze); pgmq: jobs_interactive + jobs_bulk
```

No `videos`, `video_assets`, or players graph. B2 paths are constructable;
court geometry + labels live in `annotation.json` under the match prefix (§3 /
supabase/README.md). Clients never write the DB — user files go through `cdn-access`;
DB writes are service_role via `ingest_match` / `complete_job`.

### RLS sketch

- `matches`: `owner_id = auth.uid() OR owner_id IS NULL` for select; no client writes.
- `jobs`: select via parent match; never client-writable.

## 6. Frontends

Expo gives iOS **and** Android from one codebase — plan for **two apps, not
three**:

```
apps/
  web/        Next.js + Tailwind (exists as scaffold)
  mobile/     Expo (iOS + Android), NativeWind for Tailwind parity 📐
packages/
  shared/     generated DB types (supabase gen types), zod schemas for the
              job/asset payloads, supabase client factory, API helpers 📐
```

pnpm workspaces (+ Turborepo when builds warrant it). The zod schemas in
`packages/shared` are the single source of truth for edge-function
request/response shapes; workers' Python side validates against the same JSON
Schema exported from them.

Client data flow: subscribe to `job:<id>` Realtime channels for live progress;
fetch assets via `cdn-access` delivery tokens; upload via presigned PUT;
label players via in-browser point-prompted segmentation (§2c) — click →
mask → name, no server round-trip.

## 7. Repository layout (target)

```
mintonix/
├── ARCHITECTURE.md            ← this file
├── apps/
│   ├── web/                   Next.js + Tailwind
│   └── mobile/                Expo (iOS + Android) 📐
├── packages/
│   └── shared/                types + schemas 📐
├── supabase/
│   ├── README.md              schema + RPCs + edge functions SSOT ✅
│   ├── migrations/            match + jobs pipeline ✅
│   ├── config.toml
│   └── functions/
│       ├── cdn-access/        ✅ delivery tokens + upload presign
│       ├── matches-ingest/    ✅ front door: match + job enqueue (one RPC)
│       ├── jobs/              ✅ /dispatch (queue→vast) + /callback (settle
│       │                         / advance stage in place)
│       └── ops/               ✅ /set-stage (manual stage + optional B2 purge)
├── workers/
│   ├── README.md              worker index
│   ├── cloudflare/cdn/        ✅ B2 delivery + /presign (README + DATAFLOWS)
│   ├── github/match-data/     ✅ weekly scrape → Supabase (README + schema.md)
│   └── vast/
│       ├── video-preprocess/     ✅ README (normalize + BWF court detect)
│       ├── video-det/            🚧 README + ARCHITECTURE (detect)
│       └── analysis/             📐 3D + metrics
└── .github/workflows/
```

Pipeline RPCs (`ingest_match`, `dispatch_next_job`, `complete_job`,
`ops_set_stage`) live in the match-pipeline migrations: edge functions decide
policy, RPCs make the writes atomic (a match that needs processing never
exists without its queue message; stage advance re-queues the same job row).
Ops is service-token only (same `PIPELINE_SERVICE_TOKEN` as ingest/dispatch)
for operator stage control — see supabase/README.md.

## 8. CI/CD

### The decision rule

**A pipeline owns one artifact going to one runtime.** For each directory ask:

1. Does it produce its own artifact (Docker image, Worker script, migration
   bundle)?
2. Does it deploy to its own runtime with its own secrets and rollback story?
3. Can it break independently of its neighbors?

Three yeses → its own workflow, so a red build blocks only that unit. If two
things always ship together and can't be rolled back separately, they share
one workflow with **ordered jobs**. "Runtime" is read at the granularity of
the thing secrets point at: the Supabase *project* is one runtime, so
migrations and edge functions share `supabase.yml` (`db push` job, then
`functions deploy` with `needs:`) — a function that reads a new column must
never deploy before the migration, and migrations only roll *forward*, which
chains the functions' rollback to them.

The rule misses a fourth question — **who else breaks when this changes?**
Path filters assume directories are independent, but the seams (job envelope,
callback body, `court_annotation.json` shape) cross pipelines. Two mitigations:

- Every workflow that depends on `packages/shared` includes
  `packages/shared/**` in its `paths:` filter (the silent-skip monorepo trap).
- Python workers can't import zod schemas, so wire contracts are pinned in
  **ARCHITECTURE.md § One job contract** (envelope, callback bodies, stage
  basenames) and mirrored in `stage_outputs.ts` / `ops_stage.py` / worker
  parser tests. A contract change must update the doc and every affected
  pipeline test.

### The workflows

Path-filtered; **PR → dev environment, master → prod**. Two Supabase projects
(dev/prod), two B2 buckets, two CF Workers (`[env.dev]`/`[env.prod]` already
in `wrangler.toml`).

| Workflow | Trigger paths | PR (dev) | master (prod) | Status |
|---|---|---|---|---|
| `match-data.yml` | `workers/github/match-data/**` | scrape + apply to dev DB | apply to prod (+ weekly cron) | ✅ |
| `vast-worker.yml` | (reusable, `workflow_call`) | build + test + push SHA-tagged image to GHCR | promote the tested digest | ✅ |
| `video-preprocess.yml` | `workers/vast/video-preprocess/**` | → `vast-worker.yml` (unit/contract in image; encode + BWF NVDEC are GPU-only and run on vast — a bad host fails the job and the queue retries) | 〃 | ✅ |
| `video-det.yml` | `workers/vast/video-det/**` | → `vast-worker.yml` (CPU-safe tests; TensorRT engine build stays a documented manual step) | 〃 | ✅ |
| `cloudflare-cdn.yml` | `workers/cloudflare/cdn/**` | tests + `wrangler deploy --env dev` | `wrangler deploy --env prod` | ✅ |
| `supabase.yml` | `supabase/**`, `packages/shared/**` | `db push` → `functions deploy` to dev project | same, to prod | ✅ |

### Conventions (from `match-data.yml`, applied repo-wide)

- **Ship what was tested.** The vast workers build once per commit, tag the
  image `sha-<git sha>`, run tests against that image, and on master *retag
  the same digest* to `:latest` — never rebuild between test and deploy (base
  images and apt packages drift). This also stops PRs overwriting each other's
  `:staging` tag.
- **Secrets live in GitHub Environments** (`dev`, `prod`), scoped per
  pipeline: the CF workflow never sees a Supabase service key and vice versa.
  Workers themselves stay credential-free by design (§1).
- **Concurrency groups** per workflow (`<name>-${{ github.ref }}`),
  `cancel-in-progress` only for PRs — two merges racing `wrangler deploy` or
  `db push` is a real hazard; never cancel an applying prod run.
- **PR-deploys-to-dev caveat**: fine while the repo is private; if it ever
  goes public, switch PR jobs to dry-run only (`wrangler versions upload`,
  `supabase db diff`, match-data `--dry-run`) so fork PRs never run with
  dev secrets.

## 9. Open questions

1. **Analysis scope** — which metrics beyond 3D positions (rally segmentation,
   shot classification, player movement stats)? Drives whether `analyze` is
   one stage or several.
2. **BWF video retention** — storing full source under the match prefix vs
   only the court cut as `normalized.mp4` (storage cost vs reprocessing
   flexibility). Also confirm the rights posture for storing YouTube-sourced
   footage.
3. **Queue tech** — pgmq is the recommendation; if Supabase Queues proves
   limiting for priority/rate-caps, the fallback is a plain `jobs`-table
   dispatcher with `FOR UPDATE SKIP LOCKED`.
4. ~~**BWF catalog visibility**~~ — **decided:** the **web** BWF catalog is
   **server-private** via service role (`SUPABASE_SERVICE_ROLE_KEY`) with
   `owner_id IS NULL` on every query. Home, match list, and stats use targeted
   PostgREST queries plus `bwf_catalog_stats` (not a full table dump). Search,
   player directory, and H2H use a process-local `CatalogSnapshot` (5 min TTL,
   stale-while-revalidate; warmed in `after()` so first paint is not blocked).
   Full profiles (form/rivals) are built on demand. Catalog load does **not**
   enqueue GPU jobs. Multi-year snapshots stay in process RAM — document/scale
   limits before loading many seasons. There is no separate players table —
   identity is a **name slug** from the four roster columns (known collision
   limit). Public anon SELECT on system matches is **revoked**
   (`20260731000000_revoke_anon_bwf_catalog_read`). User-owned matches stay
   private.

Decided (2026-07): all footage is **single-camera** (shuttle 3D comes from
physics-fit trajectories; no multi-view tables anywhere). Also decided
(2026-07): **client-side labeling inference is segmentation-only; appearance
embeddings live in `detect`** — the click names an instance, detect's own
tracks build the identity (§4 re-ID embedding module), analyze joins the two.
That segmentation runs **in the browser** (SlimSAM-class point-prompted SAM,
§2c); the Roboflow-backed `rfdetr-infer` edge function is removed — no
inference endpoint, no per-call billing, only the click evidence is persisted.
