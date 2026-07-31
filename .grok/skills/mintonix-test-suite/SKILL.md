---
name: mintonix-test-suite
description: >
  Run and interpret Mintonix pipeline E2E tests against the intended dual-truth
  behavior (Postgres job/match state + B2 artifacts under the match prefix).
  Two lanes share one chain: normalize → detect (analyze unwired). Workers run
  on vast.ai serverless. BWF catalog rows already exist — harness only uploads
  annotation.json and enqueues; user lane uploads original.mp4 then
  matches-ingest creates match+job. For BWF, normalized.mp4 is already the
  valid-frames cut (court∧scoreboard); for user it is the full re-encode.
  detections.json must have pose + shuttle per frame; ReID/player_mask is not
  wired from annotation.json today. Green E2E does not require analysis.json.

  Canonical stage → B2 basenames (purge, dispatch, ops; live names first, legacy
  retained for older buckets):

  {"description":"Canonical stage → B2 basenames for purge, dispatch, and ops. Live names first; legacy names retained for older buckets.","stage_order":["normalize","detect","analyze"],"outputs":{"normalize":["normalized.mp4","thumbnail.jpg","frame_ranges.csv","valid.mp4","frame_manifest.csv","scores.csv"],"detect":["detections.json"],"analyze":["analysis.json"]},"primary":{"normalize":"normalized.mp4","detect":"detections.json","analyze":"analysis.json"},"keep_on_regress":["original.mp4","original.mov","original.mkv","annotation.json"],"callback_wire_status":{"success":"Worker → jobs/callback success","failed":"Worker → jobs/callback failure","db_complete":"jobs.row status after successful settle"},"live_normalize":{"both":["normalized.mp4","thumbnail.jpg"],"bwf_extra":["frame_ranges.csv"],"youtube_archive":["original.mkv"],"legacy_or_deferred":["valid.mp4","frame_manifest.csv","scores.csv"]},"mvp":{"terminal_stage":"detect","analyze_wired":false,"bwf_normalized_is_valid_cut":true}}

  Pass criteria (MVP): primary normalized.mp4 then detections.json present;
  match ready after detect settle; job complete@detect; keep_on_regress not
  purged. Primary harness: scripts/annotate_and_ingest.py (DEV secrets). Use when
  the user runs /mintonix-test-suite, or asks to E2E test, run the test suite,
  verify the pipeline, smoke-test normalize/detect, monitor a match to ready, or
  validate stage contracts.
---

# Mintonix test suite

Run pipeline verification carefully. Prefer existing harnesses over ad-hoc curls.
Never invent stage basenames — use the contract below and the SSOT mirrors.

## Mental model (keep this accurate)

### Two lanes, one job chain

| | BWF (system) | User upload |
|--|--------------|-------------|
| Prefix | `bwf/<match_id>/` | `users/<uid>/<match_id>/` |
| `matches` row | **Already exists** (match-data scrape: roster, scores, often `source_url`) | **Created** at `matches-ingest` confirm (`owner_id` set) |
| Source video | Worker yt-dlps `source_url` (or uses staged `original.*`) | Client PUT `original.mp4` via **cdn-access** presign before confirm |
| Annotation | Service-presign PUT `annotation.json` (clients cannot write `bwf/`) | User JWT cdn-access PUT `annotation.json` |
| Pipeline start | **Enqueue only** (no catalog create/rewrite) | Confirm creates **match + job + pgmq** together |

Same stages for both: **`normalize` → `detect`** (→ `analyze` designed, **not wired**).

### Annotation (`annotation.json`)

Not a full mask file. Canonical shape (see `supabase/README.md` / harness):

- **`court.corners`** — 4 points TL → TR → BR → BL
- Optional BWF scoreboard geometry (`scoreboard_crop`, `score_sub_crop`, `row_split_y`)
- **`labels[]`** — click evidence: `frame_idx`, `anchor` `{x,y,bbox}`, `display_name` (or product side/slot)

SlimSAM masks in the annotator UI are for naming only; they are **not** stored as bitmaps. Labels feed BWF valid-frames **player names** and later **analyze** identity resolution — **not** detect ReID today.

### Enqueue and dispatch

**Enqueue is intentional only.** Catalog scrape never starts GPU work.

Who enqueues:

- `matches-ingest` (BWF enqueue / user confirm / harness)
- `manage.py` re-queue / ops
- ops **set-stage** with `enqueue=true`
- **`complete_job` stage advance** (normalize success → requeue detect on same job row)

Flow:

```
intentional enqueue → jobs row (stage=normalize, queued) + pgmq
       ↓
pg_cron ~1m → POST /jobs/dispatch → claim job → presign → vast
       ↓
worker → jobs/callback → complete_job (advance or terminal)
```

`jobs` is one live run per match; **stage advances in place**.

### Normalize

| Output | Live? | Notes |
|--------|-------|--------|
| `normalized.mp4` | ✅ primary | Both lanes |
| `thumbnail.jpg` | ✅ | Both |
| `frame_ranges.csv` | ✅ BWF | Compact old→new keep-range map |
| `original.mkv` (etc.) | ✅ first YT fetch | Archived under prefix so retries skip YouTube |
| `valid.mp4` | ❌ legacy | **Not** the live primary |
| `frame_manifest.csv` | ❌ legacy name | Superseded by `frame_ranges.csv` |
| `scores.csv` | ❌ deferred | **Not implemented** |

**Critical — what `normalized.mp4` contains:**

- **BWF:** already the **valid-frames cut only** (court visible ∧ scoreboard up via annotation → NCC/OCR keep-ranges → one GPU encode). Detect always reads this key; there is no separate live `valid.mp4` path.
- **User:** typically the **full** video re-encoded to ≤1080p/30 H.264/AAC (no valid-frames envelope).

After normalize **success** callback: job stage → **`detect`**, match stays **`processing`** (probe fields filled). Match is **not** `ready` yet.

### Detect (MVP terminal)

| | Today |
|--|--------|
| Input | `normalized.mp4` only (BWF cut already primary) |
| Output | **one** `detections.json` |
| Content | **Pose + shuttle** per frame (shuttle = top-K heatmap peaks in UV `[0,1]`) |
| ReID | Worker accepts optional `player_mask_url` PNG; **jobs does not presign it yet**. Not driven by `annotation.json` labels. `player_id` often null. |
| Analyze | Unwired — do not expect `analysis.json` |

After detect **success** callback: `jobs.status = complete`, `jobs.stage = detect`, `matches.status = ready`.

### Dual truth

Green means **both**:

1. Postgres: match status + job stage/status  
2. B2: primary basenames under the match prefix  

---

## Intended E2E behavior (MVP)

```
BWF:  catalog match exists → annotation.json → matches-ingest enqueue (upsert=false)
User: original.mp4 + annotation.json → matches-ingest creates match+job
        ↓
pgmq → jobs/dispatch → vast normalize → callback → stage=detect
        ↓
dispatch → vast detect → detections.json → callback → job complete, match ready
```

- **Workers:** `workers/vast/video-normalization`, `workers/vast/video-det` on **vast.ai serverless**.
- **Terminal stage today:** `detect`. Green E2E does **not** require `analysis.json`.
- **Detect intent:** pose + shuttle for every frame of `normalized.mp4` (schema: `workers/vast/video-det/ARCHITECTURE.md`).

## Verification contract (exact)

Loadable copy: `references/stage-contract.json` in this skill.

```json
{
  "description": "Canonical stage → B2 basenames for purge, dispatch, and ops. Live names first; legacy names retained for older buckets.",
  "stage_order": ["normalize", "detect", "analyze"],
  "outputs": {
    "normalize": [
      "normalized.mp4",
      "thumbnail.jpg",
      "frame_ranges.csv",
      "valid.mp4",
      "frame_manifest.csv",
      "scores.csv"
    ],
    "detect": ["detections.json"],
    "analyze": ["analysis.json"]
  },
  "primary": {
    "normalize": "normalized.mp4",
    "detect": "detections.json",
    "analyze": "analysis.json"
  },
  "keep_on_regress": [
    "original.mp4",
    "original.mov",
    "original.mkv",
    "annotation.json"
  ],
  "callback_wire_status": {
    "success": "Worker → jobs/callback success",
    "failed": "Worker → jobs/callback failure",
    "db_complete": "jobs.row status after successful settle"
  }
}
```

### How to use the contract when verifying

| Check | Expected |
|---|---|
| Completeness probe normalize | B2 has `normalized.mp4` |
| Completeness probe detect (MVP pass) | B2 has `detections.json` |
| Completeness probe analyze | Only if testing future analyze; **not** required for green E2E |
| BWF `normalized.mp4` meaning | Valid-frames cut (not full broadcast). Soft-check `frame_ranges.csv` + `thumbnail.jpg` |
| User `normalized.mp4` meaning | Full re-encode; no `frame_ranges.csv` expected |
| Legacy names | `valid.mp4`, `frame_manifest.csv`, `scores.csv` may exist in old buckets; **`scores.csv` not implemented** on live path |
| Regress purge | Deleting *to* stage S removes S outputs **and all later** stages from `outputs` |
| Never purge | `keep_on_regress` basenames must still exist after ops regress |
| Callback wire | Worker posts `status: "success" \| "failed"`; after **detect** success settle, DB is `jobs.status = complete` (not the wire string `success`) |
| After normalize success | Job advanced to `detect` (still live); match still `processing` |
| Match after detect settle | `matches.status == ready` |
| Job after detect settle | `jobs.status == complete` and `jobs.stage == detect` (MVP terminal) |

**SSOT mirrors** (must stay aligned with ARCHITECTURE.md § One job contract):

- `scripts/ops_stage.py` — `STAGE_ORDER`, `STAGE_OUTPUTS`, `STAGE_PRIMARY`, `KEEP_ON_REGRESS`
- `supabase/functions/ops/stage_outputs.ts` — same basenames for ops purge
- Live docs: root `ARCHITECTURE.md`, `supabase/README.md`, `workers/*/README.md`

If contract and code disagree, treat **ARCHITECTURE.md + stage_outputs / ops_stage** as code truth and report the drift; do not silently invent a third map.

## Secrets and environment

**DEV only** unless the user explicitly targets another env.

File: `~/.mintonix/dev-secrets.env` (script also accepts process env; `DEV_*` overrides).

| Key | Used for |
|---|---|
| `PIPELINE_SERVICE_TOKEN` | matches-ingest, `/jobs/dispatch`, pipeline edges |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) | service reads of matches/jobs; BWF catalog resolve |
| `PRESIGN_SERVICE_TOKEN` | CDN `/presign` for BWF `annotation.json` + B2 list/checks |
| `SUPABASE_ANON_KEY` + `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` | user-upload lane JWT |
| Optional `SUPABASE_URL`, `CDN_PRESIGN_URL` | defaults in harness point at DEV project + CDN |

Do **not** print secret values. If secrets are missing, fail fast and tell the user which keys are absent.

## Primary E2E harness

`scripts/annotate_and_ingest.py` — annotate (or load annotation), **BWF: upload annotation + enqueue only** / **user: upload + create match+job**, then **monitor Supabase + B2** until `--until` (default **`detect`** → match ready).

### Lanes

1. **BWF (system catalog)** — `bwf/<match_id>/`
   - Match row **must already exist** (match-data). Script does **not** create or rewrite catalog metadata (`upsert=false`).
   - Uploads `annotation.json` via service presign, then enqueues normalize via matches-ingest (`id` + `queue` only).
   - Resolve with `--match-id` (preferred catalog sha256) or `--url` (lookup `source_url` / YouTube id).
   - Optional `--file` = local scrub proxy for OpenCV only (resolution must match pipeline).
2. **User upload** — `users/<uid>/<match_id>/`
   - Test user JWT → cdn-access upload `original.mp4` + `annotation.json` + matches-ingest creates match/job.

`--tournament` is legacy/ignored on BWF (tournament lives on the catalog row).

### Recommended commands

```bash
# Full DEV E2E — existing BWF catalog match (OpenCV UI; scrub from source_url)
python3 scripts/annotate_and_ingest.py \
  --match-id <catalog_sha256> \
  --dispatch \
  --until detect

# Resolve catalog row by YouTube URL already on the match; reuse annotation
python3 scripts/annotate_and_ingest.py \
  --url "https://www.youtube.com/watch?v=…" \
  --annotation path/to/annotation.json \
  --dispatch \
  --until detect

# User-upload lane
python3 scripts/annotate_and_ingest.py --file path/to/match.mp4 --dispatch --until detect

# Monitor only (existing match)
python3 scripts/annotate_and_ingest.py --monitor-only --match-id <id> --until detect

# Enqueue only (no poll)
python3 scripts/annotate_and_ingest.py … --no-monitor

# Normalize-only bar (job may already be on detect; match still processing)
python3 scripts/annotate_and_ingest.py … --until normalize
```

Useful flags: `--timeout-sec` (default 7200), `--poll-sec` (default 15), `--dry-run`, `--save-annotation`, `--queue jobs_interactive|jobs_bulk`.

When the agent cannot drive OpenCV UI, require `--annotation` or `--monitor-only`, or ask the user for a match id / annotation path.

### Harness pass/fail (align agent report with this)

Hard success for `--until detect` (see `evaluate_success` in the script):

- Match row exists
- `annotation.json` under prefix
- `normalized.mp4` present
- `detections.json` present
- `matches.status == ready`
- Latest job: `status == complete` and `stage == detect`

Hard success for `--until normalize`:

- `normalized.mp4` present
- Probe fields filled when artifact present
- Job left normalize (stage detect/analyze or complete past normalize) **or** match `processing`/`ready`

Soft (reported, non-blocking in harness today): `thumbnail.jpg`; BWF `frame_ranges.csv`.

Terminal failure (stop early): match/job `failed` or `canceled`.

## Ops / reprocess

- `scripts/manage.py` — interactive ops (status, set-stage, dispatch, secrets health, annotate launcher)
- `scripts/ops_stage.py` — stage purge math + ops HTTP helpers
- Ops edge uses the same basename map; regress *to* `detect` purges detect+analyze outputs, not normalize primaries; regress *to* `normalize` purges normalize+detect+analyze outputs but **never** `keep_on_regress`

After set-stage with enqueue, optional `POST /jobs/dispatch` (or wait for pg_cron ~1m).

## Offline / unit suites (no GPU E2E)

Run these when the user wants fast contract checks or before a long E2E:

```bash
# Stage basename / purge math (Python)
python3 scripts/test_stage_outputs.py

# Ops pure TS helpers
deno test supabase/functions/ops/stage_outputs_test.ts

# Detect worker contracts (CPU-safe; from worker dir)
cd workers/vast/video-det && python3 -m unittest \
  test_contract.py test_io_util.py test_server_contract.py test_detect_pipeline.py -v

# Normalize worker tests if present under workers/vast/video-normalization
```

GPU/TensorRT full worker e2e is environment-specific; do not claim GPU product path passed from CPU unit tests alone.

## Agent workflow

1. **Clarify target** — new E2E vs monitor existing match; lane (BWF vs user); `--until normalize|detect`; DEV only unless told otherwise.
2. **BWF only:** ensure catalog match exists (`--match-id` or resolvable `--url`). Do not invent new BWF rows or rewrite tournament/roster.
3. **Confirm secrets** — file exists and required keys present (names only).
4. **Pick command** — prefer `annotate_and_ingest.py` for E2E; use unit suites for pure contract work.
5. **Run with long enough timeout** for vast cold start + normalize + detect (often many minutes; default 2h is intentional).
6. **Report dual truth** using the verification contract:
   - match id, prefix (`bwf/…` or `users/…`), lane
   - basenames present vs primary/outputs map
   - for BWF: note that `normalized.mp4` is the valid cut; soft-check `frame_ranges.csv`
   - job stage/status vs callback wire mapping
   - match status (`ready` only after **detect** settle)
   - whether `detections.json` is present (content deep-check only if user asks or a small sample is already downloaded)
7. **On failure** — distinguish: missing secrets, catalog miss (BWF), enqueue, dispatch not firing, normalize callback fail, detect callback fail, B2 missing primary, DB settle without object, timeout while still `processing`/`queued`.
8. **Do not** require analyze / `analysis.json` for MVP green. **Do not** treat ReID/`player_id` as required. **Do not** purge `keep_on_regress` when advising regress tests. **Do not** expect live `scores.csv` or primary `valid.mp4`.

## Content expectations (detect)

When the user asks whether detect “really worked,” not only that keys exist:

- `detections.json` is frame-aligned to **`normalized.mp4`** (BWF: that is already the valid-frames cut).
- **Pose + shuttle** coverage for those frames (shuttle as top-K candidates in UV `[0,1]`).
- Optional ReID / non-null `player_id` is **not** required for MVP pass (mask path unwired in jobs).
- Prefer sampling a few frames / schema keys over loading a multi-hundred-MB file entirely into the chat.
- Schema source: `workers/vast/video-det` + its ARCHITECTURE.md — not a second invented schema.

## Doc map

| Topic | Where |
|---|---|
| Pipeline + job contract SSOT | `ARCHITECTURE.md` |
| Supabase functions / schema | `supabase/README.md` |
| Worker index | `workers/README.md` |
| Normalize | `workers/vast/video-normalization/README.md` |
| Detect | `workers/vast/video-det/README.md` (+ `ARCHITECTURE.md`) |
| CDN | `workers/cloudflare/cdn/README.md` |
| Match-data (catalog only) | `workers/github/match-data/README.md` |
| Harness | `scripts/annotate_and_ingest.py` |

## Safety

- Prefer DEV project tokens and CDN.
- No force-push, no prod secret dumps, no destructive B2/DB cleanup unless the user explicitly asks.
- Long-running monitors: use appropriate timeouts; do not spin tight poll loops in the agent beyond the harness.
