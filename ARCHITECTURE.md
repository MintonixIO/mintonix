# Mintonix — System Architecture

Badminton video analysis platform: ingest match footage (BWF broadcasts + user
uploads), normalize it, track shuttle and players, and produce 3D positions and
match analytics.

Status legend: ✅ built · 🚧 partially built · 📐 designed, not built.

```
                 ┌─────────────── INGESTION ───────────────┐
  BWF backlog ──▶│                                          │
  BWF scraper ──▶│  match-data pipeline (GitHub Actions) ✅ │──▶ matches / players tables
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
(`bwf/<match_id>/` or `users/<uid>/<match_id>/`). Schema detail: **SUPABASE.md**.

### 2a. BWF broadcast footage ✅ (metadata) / 📐 (video ingest)

- **Match metadata** — the weekly GitHub Actions pipeline
  (`workers/github/match-data`) scrapes BWF World Tour results and upserts into
  `matches` (content-hash `id`, four player name columns + scores +
  `source_url`). PRs apply to dev; master/schedule applies to prod. ✅
- **Backlog** — existing footage is staged under `bwf/<match_id>/original.mp4`
  via service `/presign`, then `matches-ingest` enqueues normalize. 📐
- **Steady state** — scraper sets `source_url` on `matches` and calls
  `matches-ingest`; normalize fetches YouTube (yt-dlp ✅) and archives to B2.
  (enqueue ✅ / dispatch manual 📐)

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
   (dispatch itself is still manual 📐)

### 2c. Court annotation & player labeling ✅ (inference) / 📐 (persistence)

Before (or after) processing, the user annotates into a single B2 file
`annotation.json` under the match prefix (shape: SUPABASE.md):

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

Two namespaces, one shape (see SUPABASE.md for full layout):

```
users/<uid>/<match_id>/            # user-owned; RLS = owner
bwf/<match_id>/                    # system-owned (BWF); readable to signed-in
  original.<ext>          raw source (upload or yt-dlp fetch)
  annotation.json         court geometry + player labels   (client / service)
  normalized.mp4          ≤1080p/30fps H.264/AAC           (normalize)
  thumbnail.jpg                                            (normalize)
  valid.mp4               valid-frames-only cut            (normalize, BWF)
  frame_manifest.csv      old→new frame index map          (normalize, BWF)
  scores.csv              OCR score timeline               (normalize, BWF)
  detections.json         per-frame pose + shuttle tracks  (detect)
  analysis.json           3D positions, metrics, resolved  (analyze)
```

User-authored data is files under the match prefix via `cdn-access`
(`users/<uid>/…` prefix rule + upload basename allowlist). `bwf/…` is
unwritable by clients. Canonical shape is `annotation.json` (SUPABASE.md):

```jsonc
// annotation.json — court + labels (normalize valid-frames + analyze)
{ "court": {
    "corners": [[x,y],[x,y],[x,y],[x,y]],          // TL → TR → BR → BL
    "scoreboard_crop": {"x":…,"y":…,"w":…,"h":…},  // BWF optional
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

### Queue 📐

A Postgres-backed queue in Supabase (**pgmq via Supabase Queues**) plus a
`jobs` state table. Producers (upload confirm, backlog script, scraper,
stage-completion callbacks) just `pgmq.send()`; a dispatcher edge function
(cron-driven, and/or DB webhook on insert) pops messages, presigns URLs, and
POSTs to the appropriate vast serverless endpoint.

Why a queue *in front of* vast's own autoscaler queue: priority (user uploads
preempt backlog), retries with visibility timeout, rate/cost caps on GPU
spend, and a single place to observe pipeline state. Two queues (or a priority
column): `interactive` (user-initiated) and `bulk` (backlog/scraper).

### One job contract for every stage 📐 (generalizes what normalize ✅ does)

All stages speak the same envelope — this is the existing `normalize-video`
pattern promoted to a standard:

```jsonc
// dispatcher → worker
{ "input": {
    "job_id": "…",
    "source":       { "kind": "b2", "url": "<presigned GET>" }   // or
                 // { "kind": "youtube", "url": "https://youtu.be/…" },
    "outputs":      { "<asset kind>": "<presigned PUT or multipart set>", … },
    "params":       { /* stage-specific: valid_frames_config, court corners… */ },
    "callback_url": "https://<ref>.supabase.co/functions/v1/jobs/callback",
    "callback_token": "<HMAC(job_id, attempt…), aud=jobs-callback>",
    "realtime_channel": "job:<job_id>"   // stages that stream progress
} }
// worker → callback (Bearer callback_token)
{ "job_id": "…", "status": "complete" | "failed",
  "assets": { "<kind>": { "sha256": "…", "meta": { … } } }, "error?": "…" }
```

- Workers hold no credentials; the callback token is the only authorization
  and is bound to one job (single-use: the callback marks the job terminal on
  first valid call).
- Progress Realtime (worker → `job:<job_id>`) is optional UX; **MVP detect
  omits mid-job streaming** and reports only via `jobs/callback` (same as
  normalize). Re-add progress later if the client needs a progress bar.
- The jobs function's `/callback` route records assets, then **enqueues the
  next stage** (normalize → detect → analyze), making the pipeline a chain of
  queue messages rather than a long-lived orchestrator. Dispatch and callback
  live in ONE function (`jobs`) because they share what must never drift: the
  stage routing table, the token mint/verify pair, the queue semantics.
  Workers POST the callback from inside their own job thread — the
  dispatching edge function disconnects long before a real job finishes.

### Stages

| Stage | Worker | Status | In | Out |
|---|---|---|---|---|
| `normalize` | `workers/vast/video-normalization` | ✅ (needs score-timeline output) | original / YouTube URL (worker yt-dlps ✅) | normalized.mp4, thumbnail.jpg; youtube: + original.mkv archive; BWF: + valid.mp4, frame_manifest.csv, scores.csv |
| `detect` | `workers/vast/video-det` | 🚧 worker + `STAGES.detect` wired; analyze next; embedding module 📐 | normalized.mp4 | detections.json (pose + TrackNetV5 **top-K shuttle candidates** per frame for high recall + optional exclusive ReID). `server.py` + `detect/` + `pose/` |
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
carry richer `valid_frames_config` built from `annotation.json` (court +
scoreboard geometry) and roster names on `matches.team*_player*`; user jobs
typically normalize without valid-frames. See SUPABASE.md.

## 5. Supabase: auth, tables, RLS

### Auth

Supabase Auth is the single identity system for all three clients (web and the
Expo apps use the same `supabase-js` session). Edge functions authenticate the
user JWT (`getUser()`); object-level authorization is the
`users/<uid>/` prefix rule; row-level is RLS. The service-role key exists only
inside edge functions and the match-data loader.

### Tables

**Canonical schema: SUPABASE.md** (migration
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
SUPABASE.md). Clients never write the DB — user files go through `cdn-access`;
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
│   ├── migrations/            match + jobs pipeline (SUPABASE.md) ✅
│   ├── config.toml
│   └── functions/
│       ├── cdn-access/        ✅ delivery tokens + upload presign
│       ├── matches-ingest/    ✅ front door: match + job enqueue (one RPC)
│       ├── jobs/              ✅ /dispatch (queue→vast) + /callback (settle
│       │                         / advance stage in place)
│       └── ops/               ✅ /set-stage (manual stage + optional B2 purge)
├── workers/
│   ├── cloudflare/cdn/        ✅ B2 delivery + /presign control plane
│   ├── github/match-data/     ✅ weekly scrape → Supabase
│   └── vast/
│       ├── video-normalization/  ✅ + valid-frames extraction
│       ├── video-det/            🚧 detect stage (server/detect/pose); STAGES.detect wired
│       └── analysis/             📐 3D + metrics
└── .github/workflows/
```

Pipeline RPCs (`ingest_match`, `dispatch_next_job`, `complete_job`,
`ops_set_stage`) live in the match-pipeline migrations: edge functions decide
policy, RPCs make the writes atomic (a match that needs processing never
exists without its queue message; stage advance re-queues the same job row).
Ops is service-token only (same `PIPELINE_SERVICE_TOKEN` as ingest/dispatch)
for operator stage control — see SUPABASE.md.

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
- Python workers can't import zod schemas, so contracts are pinned by
  **fixture files** (`packages/shared/fixtures/*.json`): canonical envelopes /
  callbacks, validated against zod on the TS side and against each worker's
  parser in its own tests. A contract change turns every affected pipeline red.

### The workflows

Path-filtered; **PR → dev environment, master → prod**. Two Supabase projects
(dev/prod), two B2 buckets, two CF Workers (`[env.dev]`/`[env.prod]` already
in `wrangler.toml`).

| Workflow | Trigger paths | PR (dev) | master (prod) | Status |
|---|---|---|---|---|
| `match-data.yml` | `workers/github/match-data/**` | scrape + apply to dev DB | apply to prod (+ weekly cron) | ✅ |
| `vast-worker.yml` | (reusable, `workflow_call`) | build + test + push SHA-tagged image to GHCR | promote the tested digest | ✅ |
| `video-normalization.yml` | `workers/vast/video-normalization/**` | → `vast-worker.yml` (contract/unit + remux e2e; transcode is GPU-only and self-skips on the GPU-less runner — a bad host fails the job and the queue retries) | 〃 | ✅ |
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
2. **BWF video retention** — storing full normalized broadcasts in B2 vs only
   `valid.mp4` cuts (storage cost vs reprocessing flexibility). Also confirm
   the rights posture for storing YouTube-sourced footage.
3. **Queue tech** — pgmq is the recommendation; if Supabase Queues proves
   limiting for priority/rate-caps, the fallback is a plain `jobs`-table
   dispatcher with `FOR UPDATE SKIP LOCKED`.
4. **BWF artifact visibility** — the RLS in the pipeline migration lets any
   signed-in user read system-owned (BWF) videos/assets, while the raw
   match-data tables stay private. Tighten to owner-only if BWF content should
   stay service-only until launch.

Decided (2026-07): all footage is **single-camera** (shuttle 3D comes from
physics-fit trajectories; no multi-view tables anywhere). Also decided
(2026-07): **client-side labeling inference is segmentation-only; appearance
embeddings live in `detect`** — the click names an instance, detect's own
tracks build the identity (§4 re-ID embedding module), analyze joins the two.
That segmentation runs **in the browser** (SlimSAM-class point-prompted SAM,
§2c); the Roboflow-backed `rfdetr-infer` edge function is removed — no
inference endpoint, no per-call billing, only the click evidence is persisted.
