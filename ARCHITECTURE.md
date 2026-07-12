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

Every video, regardless of origin, converges to the same canonical form: **a
row in `videos` + objects in B2 under that video's prefix**. Downstream stages
never care where a video came from.

### 2a. BWF broadcast footage ✅ (metadata) / 📐 (video ingest)

- **Match metadata** — the weekly GitHub Actions pipeline
  (`workers/github/match-data`) scrapes BWF World Tour results from Wikipedia,
  matches each match to a BWF YouTube video, and upserts into
  `matches`/`players`/`match_players`/`nations`. PRs dry-run against dev;
  master/schedule applies to prod. ✅
- **Backlog** — existing footage on the network server is ingested by a one-off
  script that walks the archive, calls `/presign` (service token) for a PUT per
  file into `matches/<match_id>/original.mp4`, and enqueues a `normalize` job.
  It reuses the exact upload path users take — no special ingest lane. 📐
- **Steady state** — the weekly scraper stores the YouTube URL on `matches`.
  Ingestion of the actual video is a `normalize` job whose `input_url` IS the
  YouTube URL: the worker fetches it itself (yt-dlp ✅) and archives the
  pristine download to B2 via a presigned `original_upload_url`. The scraper
  runs on a GitHub runner and never moves video bytes — it only discovers URLs
  and enqueues. (enqueue/dispatch 📐)

**Rule: B2 is canonical.** A YouTube URL is fetched exactly once, at
normalize time; the normalized output lands in B2 and no later stage ever
touches YouTube again. This isolates the pipeline from takedowns, rate limits,
and re-fetch nondeterminism.

### 2b. User uploads ✅

1. Client calls `cdn-access` (`op: "upload"`) with the user JWT → gets a
   presigned PUT for `users/<uid>/videos/<videoId>/original.<ext>`.
   Authorization is a pure prefix check (`users/<uid>/…`), no DB lookup.
2. Client PUTs directly to B2 (bucket CORS must allow the app origin).
3. Client confirms the upload → a `videos` row is created and a `normalize`
   job is enqueued. 📐 (today the enqueue step is manual)

### 2c. Court annotation & player labeling ✅ (inference) / 📐 (persistence)

Before (or after) processing, the user annotates:

- **Court corners** — 4 points, stored per video. Required for BWF valid-frame
  extraction and for the 3D analysis stage (homography).
- **Player identities** — the client runs point-prompted segmentation
  **in-browser** (a distilled SAM — SlimSAM-class — via onnxruntime-web /
  transformers.js, WebGPU with wasm fallback): the frame is encoded once, each
  click prompts the mask decoder, the click is resolved to an instance, and
  the user attaches a name. For BWF videos the name choices come from
  `match_players`; for user videos they're free-form labels. Segmentation is
  *all* the inference the labeling flow needs: its only job is resolving the
  click to an instance and recording the evidence — so it runs client-side,
  with no inference endpoint and no third-party API (the Roboflow-backed
  `rfdetr-infer` edge function that previously did this is removed). Player
  identity itself (appearance embeddings) is built server-side by `detect`
  from its own tracks (§4 Stages) — one frame's mask can't model identity,
  and it never feeds the embeddings.

Both persist as JSON files in the video's B2 prefix (`court_annotation.json`,
`player_labels.json` — shapes in §3), written by the client via `cdn-access`
presigned PUTs and registered in `video_assets`. For BWF broadcasts, scoreboard
crop geometry repeats per tournament/broadcast layout — the DB keeps
**annotation presets keyed by tournament** (`annotation_presets`), and ingest
materializes the matching preset into the video's `court_annotation.json`.

## 3. Storage layout (B2)

Two namespaces, one shape:

```
users/<uid>/videos/<videoId>/          # user-owned; RLS = owner
matches/<matchId>/                     # system-owned (BWF); RLS = public read
  original.<ext>          raw source (upload or yt-dlp fetch)
  court_annotation.json   court geometry                   (client PUT / preset)
  player_labels.json      click-to-label evidence          (client PUT)
  normalized.mp4          ≤1080p/30fps H.264/AAC           (normalize)
  thumbnail.jpg                                            (normalize)
  valid.mp4               valid-frames-only cut            (normalize, BWF)
  frame_manifest.csv      old→new frame index map          (normalize, BWF)
  scores.csv              OCR score timeline               (normalize, BWF)
  detections.json         per-frame pose + shuttle tracks  (detect)
  analysis.json           3D positions, metrics, resolved  (analyze)
                          label→track mapping
```

User-authored data (court annotation, player labels) is **also just files** in
the video's prefix, written by the client through the same `cdn-access`
presigned-PUT path as the upload itself — the `users/<uid>/` prefix rule *is*
the write authorization, and `matches/…` is unwritable by clients, so BWF
annotations can only come from presets via service code. Shapes:

```jsonc
// court_annotation.json — consumed by normalize (valid frames) + analyze (homography)
{ "corners": [[x,y],[x,y],[x,y],[x,y]],          // TL → TR → BR → BL
  "scoreboard_crop": {"x":…,"y":…,"w":…,"h":…},  // BWF only
  "score_sub_crop":  {"x":…,"y":…,"w":…,"h":…},  // BWF only
  "row_split_y": …,                               // BWF only
  "source": "user" | "preset", "preset_id": …, "updated_at": "…" }

// player_labels.json — pure click evidence; track resolution happens in analyze
{ "labels": [ { "frame_idx": …,                   // normalized timeline
                "anchor": { "x": …, "y": …, "bbox": [x,y,w,h] },  // click + mask-derived box
                "player_id": … /* BWF */ | "display_name": "…" /* user videos */,
                "labeled_by": "<uid>", "created_at": "…" } ] }
```

Labels are resolved to pose-track ids by the **analyze** stage: the crop
under the click anchor is embedded and nearest-neighbor-matched against the
per-track appearance embeddings `detect` produces, with anchor ∩ track-bbox
at `frame_idx` as the geometric prior and tiebreak. The label thus attaches
to an appearance identity rather than one track id, so it survives track
fragmentation across broadcast cuts. The mapping lands in `analysis.json` —
never written back into `player_labels.json` — so re-running detect can't
orphan a label.

Every derived object is registered in `video_assets` with its `kind`, key and
sha256, so "what exists for this video" is a DB query, not a bucket listing.
Delivery of any of these to a client is always a `cdn-access` delivery token →
CDN Worker (cached, free egress). If an object is ever regenerated, version
the key (`…/v2/…`) or purge the CDN cache.

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
- Progress streams **directly** worker → Supabase Realtime (anon key,
  `job:<job_id>` channel), bypassing the edge functions — the pattern
  `video-det` already implements.
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
| `detect` | `workers/vast/video-det` | 🚧 worker built; dispatcher/table + embedding module not | normalized (or valid) mp4 | detections.json (YOLO26x-pose TensorRT + TrackNetV5 shuttle track + per-track appearance embeddings), Realtime progress |
| `analyze` | `workers/…/analysis` | 📐 | detections.json + court_annotations + player_labels | analysis.json: 3D shuttle trajectory (physics fit), player ground-plane positions (homography), metrics (TBD) |

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

BWF vs user is **not** a different pipeline — it's the same chain where BWF
jobs carry `valid_frames_config` (from the tournament preset + `match_players`
names) and user jobs don't.

## 5. Supabase: auth, tables, RLS

### Auth

Supabase Auth is the single identity system for all three clients (web and the
Expo apps use the same `supabase-js` session). Edge functions authenticate the
user JWT (`getUser()`); object-level authorization is the
`users/<uid>/` prefix rule; row-level is RLS. The service-role key exists only
inside edge functions and the match-data loader.

### Tables

Full DDL: `supabase/migrations/20260709000000_init_video_pipeline.sql`.

```
-- ✅ existing (match-data migrations; private, service-role only)
nations, players, matches, match_players (+ match_full view)

-- 📐 pipeline (this migration)
videos             canonical video entity: owner_id (null ⇒ system/BWF),
                   source_kind (upload|youtube|backlog), b2_prefix (unique),
                   coarse status rollup, probe metadata
video_assets       (video_id, kind) → b2_key + sha256 + meta; the registry of
                   everything in B2, including the client-authored
                   court_annotation / player_labels files (§3)
jobs               one row per stage run (normalize|detect|analyze): status,
                   priority, attempt, params; ≤1 active per (video, stage).
                   Queueing itself is pgmq: jobs_interactive + jobs_bulk
annotation_presets per-tournament BWF broadcast geometry (court + scoreboard);
                   stays a table because it's cross-video system data the
                   dispatcher joins by tournament
matches.footage_id → videos.id  (matches.video_id was taken — it's the YouTube id)
```

Court annotations and player labels are **not tables** — they're per-video
JSON files in B2 (§3). Clients never write the DB at all: user-authored data
goes through `cdn-access` presigned PUTs, and every DB write happens in edge
functions as service_role. The tradeoff: no SQL over label contents (e.g.
"every video where player X is labeled") — for BWF that query already exists
via `match_players`, and for user videos labels are free-form and per-video,
so nothing needed today depends on it.

### RLS sketch

- `videos` & children: `owner_id = auth.uid() OR owner_id IS NULL` for select;
  all writes via edge functions (service role) — clients have no DB write
  path at all (user-authored data is B2 files behind the prefix rule).
- `matches`/`players`/…: public read (already private-schema’d per the
  existing migrations — expose via the read-model view).
- `jobs`: select own (`video → owner`); never client-writable.

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
│   ├── migrations/            schema (match-data ✅, pipeline 📐)
│   ├── config.toml
│   └── functions/
│       ├── cdn-access/        ✅ delivery tokens + upload presign
│       ├── videos-ingest/     ✅ front door: insert + enqueue (one RPC txn)
│       └── jobs/              ✅ /dispatch (queue→vast) + /callback (settle
│                                 + enqueue next stage) — one function, they
│                                 share the stage routing table + job token
├── workers/
│   ├── cloudflare/cdn/        ✅ B2 delivery + /presign control plane
│   ├── github/match-data/     ✅ weekly scrape → Supabase
│   └── vast/
│       ├── video-normalization/  ✅ + valid-frames extraction
│       ├── video-det/            🚧 pose + shuttle tracking
│       └── analysis/             📐 3D + metrics
└── .github/workflows/
```

Migration note: the `normalize-video`/`normalize-callback` drafts were the
template for `videos-ingest`/`jobs` and have been deleted. The pipeline RPCs
(`ingest_video`, `dispatch_next_job`, `complete_job`) live in the pipeline
migration: edge functions decide policy, RPCs make the writes atomic (a video
never exists without its queue message; a completed job never misses its
next-stage message).

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
| `match-data.yml` | `workers/github/match-data/**` | scrape + `--dry-run` diff vs dev DB | apply to prod (+ weekly cron) | ✅ |
| `vast-worker.yml` | (reusable, `workflow_call`) | build + test + push SHA-tagged image to GHCR | promote the tested digest | ✅ |
| `video-normalization.yml` | `workers/vast/video-normalization/**` | → `vast-worker.yml` (contract/unit + remux e2e; transcode is GPU-only and self-skips on the GPU-less runner — a bad host fails the job and the queue retries) | 〃 | ✅ |
| `video-det.yml` | `workers/vast/video-det/**` | → `vast-worker.yml` (CPU-safe tests; TensorRT engine build stays a documented manual step) | 〃 | ✅ |
| `cloudflare-cdn.yml` | `workers/cloudflare/cdn/**` | tests + `wrangler deploy --env dev` | `wrangler deploy --env prod` | ✅ |
| `supabase.yml` | `supabase/**`, `packages/shared/**` | `db push` → `functions deploy` to dev project | same, to prod | ✅ |
| `web.yml` | `apps/web/**`, `packages/shared/**` | lint/typecheck/build (deploy previews via Vercel git integration) | Vercel prod | ✅ |
| `mobile.yml` | `apps/mobile/**`, `packages/shared/**` | typecheck; EAS Update preview channel | EAS Update on master; **EAS Build on tags/dispatch only** (store builds are slow, cost credits, gate on review) | 📐 (no `apps/mobile` yet) |

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
  `supabase db diff`) as match-data already does, so fork PRs never run with
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
