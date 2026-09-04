---
name: mintonix-test-suite
description: >
  Run and interpret Mintonix pipeline E2E tests against dual-truth behavior
  (Postgres job/match state + B2 artifacts under the match prefix). Two lanes
  share one fused GPU hop: encode+detect in video-preprocess (analyze unwired).
  `/detect/sync` is ops retry. Annotation always requires court.corners[4] +
  court.net_poles[2].
  Fused outputs: normalized.mp4, thumbnail.jpg, preprocess-log.json,
  detections.json (frame_shifts live only in the log — not frame_ranges.csv).
  BWF normalized.mp4 is the court valid-frames cut; user is full re-encode.
  Green E2E does not require analysis.json or ReID. Primary harness:
  scripts/annotate_and_ingest.py (DEV). Use when the user runs
  /mintonix-test-suite, or asks to E2E test, run the test suite, verify the
  pipeline, smoke-test normalize/detect, monitor a match to ready, validate
  stage contracts, check CI, monitor Actions, watch PR checks, or check if
  DEV/PROD is ready / environment readiness / env health.
---

# Mintonix test suite

Run pipeline verification carefully. Prefer existing harnesses over ad-hoc curls.
Never invent stage basenames — use the contract below and the SSOT mirrors.

## Mental model (keep this accurate)

### Two lanes, one job chain

| | BWF (system) | User upload |
|--|--------------|-------------|
| Prefix | `bwf/<match_id>/` | `users/<uid>/<match_id>/` |
| `matches` row | **Already exists** (match-data scrape) | **Created** at `matches-ingest` confirm |
| Source video | Worker yt-dlps `source_url` each attempt (or staged `original.mp4` if non-YouTube) | Client PUT `original.mp4` via **cdn-access** before confirm |
| Annotation | Service-presign PUT `annotation.json` (clients cannot write `bwf/`) | User JWT cdn-access PUT `annotation.json` |
| Pipeline start | **Enqueue only** (no catalog create/rewrite) | Confirm creates **match + job + pgmq** together |

Same stages for both: **fused `normalize`+`detect`** in one vast job
(→ `analyze` designed, **not wired**). Stage names stay `normalize` / `detect`.

### Annotation (`annotation.json`) — hard gate for every normalize job

Canonical shape (worker + harness + docs):

```json
{
  "court": {
    "corners": [[x,y],[x,y],[x,y],[x,y]],
    "net_poles": [[x,y],[x,y]]
  },
  "labels": [
    {
      "frame_idx": 0,
      "anchor": {"x": 0, "y": 0, "bbox": [0, 0, 0, 0]},
      "display_name": "Name",
      "labeled_by": "…"
    }
  ]
}
```

| Field | Required? | Notes |
|---|---|---|
| **`court.corners`** | **Yes** — exactly 4 points TL→TR→BR→BL | Drives BWF court NCC keep-ranges |
| **`court.net_poles`** | **Yes** — exactly 2 points left→right tops | Pipeline contract for later stages; echoed into `preprocess-log.json`. Missing → normalize **fails** |
| Scoreboard crops | Optional for normalize | Detect OCRs `scoreboard_crop` / `score_sub_crop` into `detections.json` `segments[]` |
| **`labels[]`** | Soft | Analyze identity later; **not** detect ReID today |

SlimSAM masks in the annotator UI are for naming only; they are **not** stored as bitmaps.

**Harness:** OpenCV UI always collects corners then net poles. `--annotation` load rejects missing/malformed poles. Fixture with poles: `workers/vast/video-preprocess/testdata/annotation.json`.

### Enqueue and dispatch

**Enqueue is intentional only.** Catalog scrape never starts GPU work.

Who enqueues: `matches-ingest`, `manage.py` re-queue / ops, ops set-stage with `enqueue=true`. Fused normalize success uses **`complete_job` `p_complete_stage=detect`** (no pgmq). Ops retry enqueues `stage=detect` → `/detect/sync`.

```
intentional enqueue → jobs row (stage=normalize, queued) + pgmq
       ↓
pg_cron ~1m → POST /jobs/dispatch → claim job → presign → vast
       ↓
worker → jobs/callback → complete_job (fused: complete at detect; retry: in place)
```

`jobs` is one live run per match; **stage advances in place**.

### Normalize (video-preprocess)

| Output | Live? | Notes |
|--------|-------|--------|
| `normalized.mp4` | ✅ **primary** | Both lanes |
| `thumbnail.jpg` | ✅ | Both (harness soft-check) |
| `preprocess-log.json` | ✅ | Both — **SSOT for `frame_shifts`**, timings, worker, validated annotation, probes |
| `original.mkv` archive | ❌ **not written** by current worker | YT path re-downloads `source_url` on retry. `original.*` only in `keep_on_regress` if already under prefix |
| `frame_ranges.csv` | ❌ **removed** | Replaced by `frame_shifts` in preprocess-log |
| `valid.mp4` / `frame_manifest.csv` / `scores.csv` | ❌ legacy/deferred | Do not expect on green path |

**What `normalized.mp4` contains:**

- **BWF** (YouTube `input_url`): **valid-frames cut only** (court-visible keep-ranges via NCC on corners → range encode). Detect reads this key.
- **User** (B2/CDN `original.mp4`): **full** re-encode ≤1080p/30 H.264; **audio kept** when present (AAC).

Path mode is derived from `input_url` (YouTube → BWF; else → user). Annotation is **always required** for both.

After fused `/preprocess/sync` **success** callback: job **`stage=detect`, `status=complete`**, match **`ready`** (probe fields filled). `/detect/sync` is ops retry only.

### Detect (MVP terminal; fused into preprocess)

| | Today |
|--|--------|
| Happy path | Same `/preprocess/sync` job writes `detections.json` after `normalized.mp4` |
| Retry input | `normalized.mp4` + `annotation.json` + `preprocess-log.json` (`STAGES.detect`) |
| Output | **one** `detections.json` |
| Content | **Engine envelope:** `fps`/`width`/`height`, `segments[]` (islands + scoreboard OCR), `rallies[]` (same-score islands, at most one island between), `frames[]` (pose + shuttle) |
| ReID | Optional `player_mask_url` on worker; **jobs does not presign it**. Not driven by `annotation.json` labels. |
| Analyze / Engine | Unwired — do not expect `analysis.json` / `3d_reconstruction.json` |

After fused **or** detect-retry **success**: `jobs.status=complete`, `jobs.stage=detect`, `matches.status=ready`.

### Dual truth

Green means **both**:

1. Postgres: match status + job stage/status  
2. B2: primary basenames under the match prefix  

---

## Intended E2E behavior (MVP)

```
BWF:  catalog match exists → annotation.json (corners+net_poles) → matches-ingest enqueue
User: original.mp4 + annotation.json → matches-ingest creates match+job
        ↓
pgmq → jobs/dispatch → vast /preprocess/sync (encode+detect) → callback
        ↓
complete_job p_complete_stage=detect → job complete, match ready
```

- **Workers:** `workers/vast/video-preprocess` on **vast.ai serverless** (one endpoint).
- **Terminal stage today:** `detect`. Green E2E does **not** require `analysis.json`.
- Ops retry: `ops_set_stage detect` → `/detect/sync`.

## Verification contract (exact)

Loadable copy: `references/stage-contract.json` in this skill. Repo golden: `contracts/stage_artifacts.json`.

```json
{
  "stage_order": ["normalize", "detect", "analyze"],
  "outputs": {
    "normalize": ["normalized.mp4", "thumbnail.jpg", "preprocess-log.json"],
    "detect": ["detections.json"],
    "analyze": ["analysis.json"]
  },
  "primary": {
    "normalize": "normalized.mp4",
    "detect": "detections.json",
    "analyze": "analysis.json"
  },
  "keep_on_regress": [
    "original.mp4", "original.mov", "original.mkv", "annotation.json"
  ]
}
```

### How to use the contract when verifying

| Check | Expected |
|---|---|
| Completeness probe normalize | B2 has `normalized.mp4` only (primary) |
| Completeness probe detect (MVP pass) | B2 has `detections.json` |
| Soft after normalize (both lanes) | `thumbnail.jpg`, `preprocess-log.json` (worker always writes on success; harness non-blocking) |
| BWF `normalized.mp4` meaning | Valid-frames cut. Soft-check preprocess-log: `path=="bwf"`, non-empty `frame_shifts` |
| User `normalized.mp4` meaning | Full re-encode; preprocess-log `frame_shifts: []` |
| Frame mapping SSOT | **`preprocess-log.json` → `frame_shifts`** — not callback, not `frame_ranges.csv` |
| Do **not** require | Live `frame_ranges.csv`, `valid.mp4`, `scores.csv`, YT `original.mkv` archive |
| Regress purge | Deleting *to* stage S removes S outputs **and all later** stages |
| Never purge | `keep_on_regress` basenames |
| Callback wire | Worker posts `status: "success" \| "failed"`; after detect settle DB is `jobs.status=complete` |
| After fused preprocess success | Job `complete` at `detect`; match `ready` |
| Match after detect settle | `matches.status == ready` |
| Job after detect settle | `jobs.status == complete` and `jobs.stage == detect` |

**SSOT mirrors** (must stay aligned with ARCHITECTURE.md § One job contract):

- `scripts/ops_stage.py` — `STAGE_ORDER`, `STAGE_OUTPUTS`, `STAGE_PRIMARY`, `KEEP_ON_REGRESS`
- `supabase/functions/ops/stage_outputs.ts`
- `contracts/stage_artifacts.json`
- Live docs: root `ARCHITECTURE.md`, `supabase/README.md`, `workers/vast/video-preprocess/README.md`

If contract and code disagree, treat **ARCHITECTURE.md + stage_outputs / ops_stage** as code truth and report the drift; do not invent a third map.

### Failure modes to distinguish

| Mode | Signal |
|---|---|
| Missing / bad `net_poles` or `corners` | Normalize fail: `annotation unusable (need court.corners[4] and court.net_poles[2])` |
| No NVENC / no GPU | Normalize hard fail before encode |
| `local_source` / `local_output_dir` + `callback_url` | HTTP **422** (debug-only fields) |
| Callback settle failed after B2 upload | Artifacts present, job still `processing` |
| Wire vs DB vocabulary | Wire `success`/`failed` ≠ DB `complete`/`failed` |
| YT BWF retry | Re-yt-dlp `source_url` — missing `original.mkv` is **not** a failure |

## Secrets and environment profiles

Default runtime E2E is **DEV**. Use **PROD** only when the user explicitly asks.
Profiles match `scripts/manage.py`:

| Env | Local secrets file | Project ref | Default Supabase URL | Default CDN presign |
|-----|--------------------|-------------|----------------------|---------------------|
| **dev** | `~/.mintonix/dev-secrets.env` | `xaxyuytvgcdbdnndhgwj` | `https://xaxyuytvgcdbdnndhgwj.supabase.co` | `https://mintonix-cdn-dev.peterouyang14.workers.dev/presign` |
| **prod** | `~/.mintonix/prod-secrets.env` | `grkaepnplgotsxdudlfn` | `https://grkaepnplgotsxdudlfn.supabase.co` | `https://mintonix-cdn.peterouyang14.workers.dev/presign` |

`annotate_and_ingest.py` is DEV-oriented. Do not silently run GPU E2E against prod.

### Local secret keys (names only — never print values)

| Key | Required for |
|---|---|
| `PIPELINE_SERVICE_TOKEN` | enqueue / dispatch / ops |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) | service REST |
| `PRESIGN_SERVICE_TOKEN` | B2 / annotation / dual-truth list |
| `SUPABASE_ANON_KEY` + `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` | user-upload lane only |
| `SUPABASE_URL`, `CDN_PRESIGN_URL` | optional override |
| `VAST_API_KEY` | optional local vast list |

## Environment readiness (DEV or PROD)

When the user asks if an environment is **ready**, or before a long E2E, run the checklist for the chosen env (`dev` default). Full map: `references/env-ready.json`.

**Verdicts:** `ready` | `ready_with_warnings` | `not_ready`  
Report a per-check table (pass / fail / skip / warn). Do not claim ready if any **blocking** check fails.

### Blocking checks

1. **Local secrets file** — required key **names** present (see table above).
2. **Supabase REST** — `GET …/rest/v1/matches?select=id&limit=1` with service role → **200**.
3. **Edge functions** — `POST …/jobs/dispatch` with wrong token → **401**.
4. **CDN presign** — 2xx or structured 4xx (not Cloudflare HTML block); non-empty `User-Agent`.
5. **Project edge secrets** — digests for `PIPELINE_SERVICE_TOKEN`, `JOB_TOKEN_SECRET`, `PRESIGN_SERVICE_TOKEN`, `CDN_PRESIGN_URL`, `VAST_API_KEY`, `VAST_PREPROCESS_ENDPOINT_NAME`. **Fail closed** (`not_ready`) if `VAST_PREPROCESS_ENDPOINT_NAME` is missing even when a legacy `VAST_DETECT_*` / `VAST_NORMALIZE_*` / `VAST_ENDPOINT_NAME` secret exists.
6. **Migrations aligned** — `supabase migration list --linked` consistent with local migrations for the branch.

### Warning-only

User-upload keys; `VAST_TLS_CA`; vast endpoint name resolve; cold-start 0 workers; functions list; recent CI; catalog non-empty for BWF.

### Optional deep readiness (explicit user ask only)

- Full `annotate_and_ingest.py` E2E on **DEV only** by default.
- **Never** destructive purge or mass re-queue on PROD as “readiness”.

### Readiness report format

```
Environment: DEV|PROD  ref=<project_ref>
Verdict: ready | ready_with_warnings | not_ready

| Check | Result | Detail |
| ... | pass/fail/warn/skip | one line, no secrets |

Blocking failures: …
Warnings: …
Next actions: …
```

## Primary E2E harness

`scripts/annotate_and_ingest.py` — annotate (or load annotation), **BWF: upload annotation + enqueue only** / **user: upload + create match+job**, then **monitor Supabase + B2** until `--until` (default **`detect`** → match ready).

### Lanes

1. **BWF (system catalog)** — `bwf/<match_id>/`
   - Match row **must already exist**. Script does **not** create/rewrite catalog (`upsert=false`).
   - Uploads `annotation.json` (must include **net_poles**), then enqueues normalize.
   - Resolve with `--match-id` (preferred) or `--url`. Optional `--file` = local scrub proxy (resolution must match pipeline).
2. **User upload** — `users/<uid>/<match_id>/`
   - Test user JWT → upload `original.mp4` + `annotation.json` + create match/job.
   - Annotation still requires corners + net poles.

### Recommended commands

```bash
# Full DEV E2E — existing BWF catalog match (OpenCV UI: corners → net poles → players)
python3 scripts/annotate_and_ingest.py \
  --match-id <catalog_sha256> \
  --dispatch \
  --until detect

# Reuse annotation that includes net_poles (required)
python3 scripts/annotate_and_ingest.py \
  --url "https://www.youtube.com/watch?v=…" \
  --annotation path/to/annotation.json \
  --dispatch \
  --until detect

# Normalize-only bar after preprocess changes
python3 scripts/annotate_and_ingest.py \
  --match-id <catalog_sha> \
  --annotation workers/vast/video-preprocess/testdata/annotation.json \
  --until normalize \
  --dispatch

# User-upload lane
python3 scripts/annotate_and_ingest.py --file path/to/match.mp4 --dispatch --until detect

# Monitor only
python3 scripts/annotate_and_ingest.py --monitor-only --match-id <id> --until detect
```

Useful flags: `--timeout-sec` (default 7200), `--poll-sec` (default 15), `--dry-run`, `--save-annotation`, `--queue jobs_interactive|jobs_bulk`, `--no-monitor`.

When the agent cannot drive OpenCV UI, require `--annotation` (with net poles) or `--monitor-only`.

### Harness pass/fail (align agent report with this)

Hard success for `--until detect` (`evaluate_success`):

- Match row exists
- `annotation.json` under prefix
- `normalized.mp4` present
- `detections.json` present
- `matches.status == ready`
- Latest job: `status == complete` and `stage == detect`

Hard success for `--until normalize`:

- `normalized.mp4` present
- Probe fields filled when artifact present (`duration_sec`, `width`, `height`, `fps`)
- Job left normalize (stage detect/analyze or complete past normalize) **or** match `processing`/`ready`

Soft (reported, non-blocking): `thumbnail.jpg`, `preprocess-log.json` (both lanes).

Terminal failure (stop early): match/job `failed` or `canceled`.

## Ops / reprocess

- `scripts/manage.py` — interactive ops
- `scripts/ops_stage.py` — stage purge math + ops HTTP helpers
- Regress *to* `detect` purges detect+analyze outputs; regress *to* `normalize` purges normalize+detect+analyze but **never** `keep_on_regress`

After set-stage with enqueue, optional `POST /jobs/dispatch` (or wait for pg_cron ~1m).

## Offline / unit suites (no GPU E2E)

```bash
python3 scripts/test_stage_outputs.py
deno test supabase/functions/ops/stage_outputs_test.ts

cd workers/vast/video-preprocess && python3 -m unittest discover -v -s . -p 'test_*.py'
```

Do not claim GPU product path passed from CPU unit tests alone.

## GitHub Actions / CI (required when testing a branch or PR)

When the user runs the test suite on a **branch/PR**, or asks about CI / Actions, **also verify GitHub checks**. Prefer `gh`. Workflow map: `references/ci-workflows.json`.

| Workflow file | What green means |
|---|---|
| `supabase.yml` | migrations + edge functions + stage_outputs unit |
| `contracts.yml` | `contracts/stage_artifacts.json` + callback fixtures match maps |
| `video-preprocess.yml` | fused preprocess+detect Docker image + unit tests |
| `cloudflare-cdn.yml` | CDN worker deploy |
| `match-data.yml` | catalog scrape/load (**does not** enqueue GPU) |

Path filters apply — missing checks for untouched areas is normal.

### Commands

```bash
gh pr checks <N> --repo <owner/repo>
gh run list --repo <owner/repo> --branch <branch> --limit 12
gh run view <run_id> --repo <owner/repo> --log-failed
gh run rerun <run_id> --repo <owner/repo> --failed
```

### CI vs dual-truth E2E

CI green ≠ match ready. Layers:

1. Contracts + unit  
2. Migrate + functions  
3. Worker images  
4. CDN deploy  
5. Match-data (catalog only)  
6. **Runtime E2E** — `annotate_and_ingest.py` dual-truth  

When reporting “test suite” on a PR: include **both** CI rollup and runtime E2E if both were in scope.

## Agent workflow

1. **Clarify target** — new E2E vs monitor vs **env readiness only**; lane; `--until normalize|detect`; env **dev|prod** (default **dev**); CI on branch/PR.
2. **Environment readiness** — stop with `not_ready` if blocking checks fail.
3. **CI first (when applicable)** — `gh pr checks` / `gh run list`.
4. **BWF only:** ensure catalog match exists. Do not invent BWF rows.
5. **Annotation** — must include **`court.corners[4]` + `court.net_poles[2]`** before enqueue. Reject stale annotations without poles.
6. **Pick command** — `annotate_and_ingest.py` for DEV E2E; unit suites for contracts; `gh` for workflows.
7. **Run E2E** with long timeout (default 2h). **PROD E2E only if user asked.**
8. **Report dual truth**:
   - match id, prefix, lane
   - basenames vs primary/outputs map (`preprocess-log.json` not `frame_ranges.csv`)
   - BWF: `normalized.mp4` is valid cut; soft-check preprocess-log `frame_shifts`
   - job stage/status vs callback wire mapping
   - match `ready` only after **detect** settle
   - CI rollup / env readiness when in scope
9. **On failure** — distinguish: env not ready, CI, catalog miss, enqueue, dispatch, **annotation gate**, NVENC, normalize/detect callback, B2 missing primary, settle skew, timeout.
10. **Do not** require analyze / `analysis.json` / ReID / live `scores.csv` / primary `valid.mp4` / YT `original.mkv` archive. **Do not** purge `keep_on_regress`.

## Content expectations (detect)

When the user asks whether detect “really worked,” not only that keys exist:

- `detections.json` is frame-aligned to **`normalized.mp4`** (BWF: already the valid-frames cut).
- Required keys: `fps`, `width`, `height`, non-empty `segments[]`, non-empty `rallies[]`, non-empty `frames[]`.
- `segments[]` 1:1 with preprocess islands (`frame_shifts[].new_*`); user / empty shifts → one full-video segment.
- `rallies[]` groups same-score islands with at most one island between them.
- Each segment has `score.t1` / `score.t2` (low `score_conf` is OK; do not require perfect OCR).
- **Pose + shuttle** coverage (shuttle top-K UV `[0,1]`).
- Optional ReID / non-null `player_id` is **not** required for MVP.
- Prefer sampling a few frames / schema keys over loading huge files.
- Schema: `workers/vast/video-preprocess/detect/ARCHITECTURE.md`.

## Doc map

| Topic | Where |
|---|---|
| Pipeline + job contract SSOT | `ARCHITECTURE.md` |
| Supabase functions / schema | `supabase/README.md` |
| Worker index | `workers/README.md` |
| Normalize / preprocess | `workers/vast/video-preprocess/README.md` |
| Detect | `workers/vast/video-preprocess/detect/ARCHITECTURE.md` |
| CDN | `workers/cloudflare/cdn/README.md` |
| Match-data (catalog only) | `workers/github/match-data/README.md` |
| Harness | `scripts/annotate_and_ingest.py` |
| CI workflows | `.github/workflows/*.yml` + skill `references/ci-workflows.json` |
| Env readiness | skill `references/env-ready.json` + `scripts/manage.py` `PROFILES` |
| Repo contracts golden | `contracts/stage_artifacts.json` |

## Safety

- Prefer DEV project tokens and CDN.
- No force-push, no prod secret dumps, no destructive B2/DB cleanup unless the user explicitly asks.
- Long-running monitors: use appropriate timeouts; do not spin tight poll loops beyond the harness.
- Environment readiness may list secret **names** and HTTP status codes only — never values or full JWTs.

## Common mistakes (agents)

| Mistake | Reality |
|---|---|
| Soften / skip `net_poles` | Normalize hard-fails without them |
| Expect `frame_ranges.csv` | Mapping is `preprocess-log.json` → `frame_shifts` |
| Expect YT `original.mkv` after normalize | Worker does not archive original today |
| Treat soft extras as hard PASS gates | Completeness probe is primary only |
| Require ReID / `analysis.json` for green E2E | Terminal stage is detect |
| Use `file://` or local paths with production callback | Not supported; local + callback → 422 |
