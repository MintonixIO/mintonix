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
  purged. Also verify GitHub Actions for the current branch/PR (migrate,
  functions, contracts, worker images, CDN, match-data) with gh. Can check
  environment readiness for DEV or PROD (local secrets, project secrets by
  name, Supabase/CDN reachability, vast endpoint names). Primary harness:
  scripts/annotate_and_ingest.py (DEV secrets). Use when the user runs
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

- **Workers:** `workers/vast/video-preprocess`, `workers/vast/video-det` on **vast.ai serverless**.
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

## Secrets and environment profiles

Default runtime E2E is **DEV**. Use **PROD** only when the user explicitly asks
for prod readiness or prod E2E. Profiles match `scripts/manage.py`:

| Env | Local secrets file | Project ref | Default Supabase URL | Default CDN presign |
|-----|--------------------|-------------|----------------------|---------------------|
| **dev** | `~/.mintonix/dev-secrets.env` | `xaxyuytvgcdbdnndhgwj` | `https://xaxyuytvgcdbdnndhgwj.supabase.co` | `https://mintonix-cdn-dev.peterouyang14.workers.dev/presign` |
| **prod** | `~/.mintonix/prod-secrets.env` | `grkaepnplgotsxdudlfn` | `https://grkaepnplgotsxdudlfn.supabase.co` | `https://mintonix-cdn.peterouyang14.workers.dev/presign` |

Process env can fill gaps; `DEV_*` / profile-style overrides apply per tool.
`annotate_and_ingest.py` is DEV-oriented (`~/.mintonix/dev-secrets.env`, `DEV_*`).
For prod readiness, prefer `manage.py` profiles + the checklist below — do not
silently run GPU E2E against prod.

### Local secret keys (names only — never print values)

| Key | Required for | Used for |
|---|---|---|
| `PIPELINE_SERVICE_TOKEN` | enqueue / dispatch / ops | matches-ingest, `/jobs/dispatch`, pipeline edges |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) | all service REST | matches/jobs reads; BWF catalog resolve |
| `PRESIGN_SERVICE_TOKEN` | B2 / annotation / dual-truth list | CDN `/presign` |
| `SUPABASE_ANON_KEY` + `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` | user-upload lane only | JWT ingest |
| `SUPABASE_URL`, `CDN_PRESIGN_URL` | optional override | blank → profile defaults |
| `VAST_API_KEY` | optional local vast list | readiness probe of endpoint names (not on worker) |
| `SUPABASE_DB_PASSWORD` | optional | `supabase migration list` / DB CLI only |

Do **not** print secret values. If required keys are missing, fail fast and list **key names** only.

## Environment readiness (DEV or PROD)

When the user asks if an environment is **ready**, or before a long E2E, run this
checklist for the chosen env (`dev` default). Full map: `references/env-ready.json`.

**Verdicts:** `ready` | `ready_with_warnings` | `not_ready`  
Report a per-check table (pass / fail / skip / warn). Do not claim ready if any
**blocking** check fails.

### Blocking checks (must pass for `ready`)

1. **Local secrets file** — `~/.mintonix/{dev|prod}-secrets.env` exists; required keys present (names only):
   - `PIPELINE_SERVICE_TOKEN`
   - `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`
   - `PRESIGN_SERVICE_TOKEN`
2. **Supabase REST** — `GET {SUPABASE_URL}/rest/v1/matches?select=id&limit=1` with service role → **200**.
3. **Edge functions reachable** — `POST {SUPABASE_URL}/functions/v1/jobs/dispatch` with wrong/missing pipeline token → **401** (proves function is deployed and auth works). Do **not** dispatch real jobs as part of readiness unless the user asks.
4. **CDN presign** — `POST {CDN_PRESIGN_URL}` with `Authorization: Bearer $PRESIGN_SERVICE_TOKEN` and a harmless body (e.g. LIST under a throwaway prefix or GET presign for a non-critical key). Expect **2xx** or a structured **4xx** from the worker (not Cloudflare 1010 / HTML block). Use a non-empty `User-Agent` (Python urllib default is blocked).
5. **Project edge secrets (names only)** — `supabase secrets list --project-ref <ref>` must include digests for:
   - `PIPELINE_SERVICE_TOKEN`, `JOB_TOKEN_SECRET`, `PRESIGN_SERVICE_TOKEN`, `CDN_PRESIGN_URL`
   - `VAST_API_KEY`
   - `VAST_NORMALIZE_ENDPOINT_NAME` (or legacy `VAST_ENDPOINT_NAME` with a **warn**)
   - `VAST_DETECT_ENDPOINT_NAME` (warn if missing — detect falls back to normalize endpoint)
6. **Migrations aligned** — `supabase migration list --linked` (with DB password if needed): no remote-only versions missing from local `supabase/migrations/` for the branch you intend to maintain. Remote-ahead without local files → **not_ready** for “maintain this branch”; remote up-to-date with local → pass.

### Warning-only checks (do not alone force `not_ready`)

| Check | How | Notes |
|---|---|---|
| User-upload lane keys | Anon + test email/password in local secrets | Skip if only testing BWF |
| `VAST_TLS_CA` on project | secrets list | Needed if vast workers use custom CA |
| Vast endpoint names resolve | With local `VAST_API_KEY`, `GET https://console.vast.ai/api/v0/endptjobs/` — endpoint_name matches project secret values if known | Digests alone cannot show the name string unless you set secrets yourself or read from local file |
| Expected DEV endpoint names | Prefer `Normalization-DEV` / `Detection-DEV` when checking DEV vast account | PROD may use different names — report actual names, do not invent PROD names if absent |
| Ready workers 0/0 | vast console | Cold start OK; not a failure |
| Edge functions list | `supabase functions list --project-ref` or dashboard | `jobs`, `matches-ingest`, `ops`, `cdn-access` should exist |
| Recent CI deploy | `gh run list` for workflows targeting this env | Master success for prod; PR/dev success for dev — informational |
| Catalog non-empty | `matches` with `owner_id is null` count ≥ 1 | Needed for BWF E2E only |

### Optional deep readiness (explicit user ask only)

- Manual `jobs/dispatch` with valid token and empty queue → `{ dispatched: [] }` or similar.
- Full `annotate_and_ingest.py` E2E on **DEV only** by default.
- **Never** run destructive purge or mass re-queue on PROD as a “readiness” step.

### Example readiness commands (agent)

```bash
ENV=dev   # or prod
REF=xaxyuytvgcdbdnndhgwj   # prod: grkaepnplgotsxdudlfn
SECRETS=~/.mintonix/${ENV}-secrets.env

# 1) Keys present? (names only)
python3 - <<'PY'
from pathlib import Path
import os, sys
env = os.environ.get("ENV", "dev")
path = Path.home() / ".mintonix" / f"{env}-secrets.env"
required = ["PIPELINE_SERVICE_TOKEN", "PRESIGN_SERVICE_TOKEN"]
# service role has aliases
if not path.is_file():
    print("FAIL local_secrets_file missing", path); sys.exit(1)
vals = {}
for line in path.read_text().splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); vals[k.strip()]=v.strip().strip('"').strip("'")
missing=[]
for k in required:
    if not vals.get(k): missing.append(k)
if not (vals.get("SUPABASE_SERVICE_ROLE_KEY") or vals.get("SUPABASE_SERVICE_KEY")):
    missing.append("SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY")
print("OK keys" if not missing else "FAIL missing " + ",".join(missing))
# never print values
PY

# 2) Project secret names
supabase secrets list --project-ref "$REF"

# 3) REST smoke (load service key in shell without echoing)
# curl -sS -o /dev/null -w "%{http_code}" \
#   -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
#   "$URL/rest/v1/matches?select=id&limit=1"

# 4) Vast endpoint names (if VAST_API_KEY in local secrets)
# python3 … list endpoint_name only
```

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

**PROD extra rules:** confirm user wanted prod; no secret dumps; no GPU E2E unless explicitly requested; prefer readiness-only probes.

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

# Preprocess worker tests if present under workers/vast/video-preprocess
cd workers/vast/video-preprocess && python3 -m unittest discover -v -s . -p 'test_*.py'
```

GPU/TensorRT full worker e2e is environment-specific; do not claim GPU product path passed from CPU unit tests alone.

## GitHub Actions / CI (required when testing a branch or PR)

When the user runs the test suite on a **branch/PR**, or asks about CI / Actions /
workflows, **also verify GitHub checks**. Prefer `gh` (authenticated CLI). Do not
paste tokens or secret values. Workflow map: `references/ci-workflows.json`.

### Workflows that matter for this pipeline

| Workflow file | Display name | Jobs (typical check names) | What green means |
|---|---|---|---|
| `supabase.yml` | Supabase — migrations + edge functions | `migrate`, `unit`, `functions` | DEV (PR) / PROD (master): `db push` + edge function deploy; unit = stage_outputs goldens |
| `contracts.yml` | Contracts | `stage-artifacts` | `contracts/stage_artifacts.json` + callback fixtures match Python/TS maps |
| `video-preprocess.yml` | Video Preprocess Worker | `image / build-test-push`, `image / promote` | Docker image builds, unit tests in image, GHCR push/promote |
| `video-det.yml` | Video Detection Worker | `image / build-test-push`, `image / promote` | Same for detect GPU image |
| `cloudflare-cdn.yml` | Cloudflare CDN Worker | `deploy` | Typecheck + deploy CDN worker (dev env on PR) |
| `match-data.yml` | Match data — scrape & load to Supabase | `scrape-and-load` | Catalog scrape/load path (creates BWF rows; **does not** enqueue GPU) |
| `vast-worker.yml` | Vast worker image (reusable) | called by video-* only | Not a top-level PR check |

Path filters apply: only workflows whose `paths:` match the PR diff will run.
Missing checks for untouched areas is normal — do not invent failures for
untriggered workflows.

### Commands

```bash
# Discover repo + open PR for current branch
gh repo view --json nameWithOwner -q .nameWithOwner
gh pr view --json number,url,headRefName,statusCheckRollup

# Check rollup for a PR (tab-separated: name, status, duration, url)
gh pr checks <N> --repo <owner/repo>

# Recent runs on this branch
gh run list --repo <owner/repo> --branch <branch> --limit 12

# Failed logs
gh run view <run_id> --repo <owner/repo> --log-failed

# Re-run only failed jobs (e.g. flake)
gh run rerun <run_id> --repo <owner/repo> --failed
```

### Pass / fail interpretation

| Outcome | Agent action |
|---|---|
| All **triggered** checks **pass** | Report CI green for this PR/push |
| `migrate` fail | Remote migration history vs `supabase/migrations/` drift — do not claim functions deployed |
| `functions` skipped | Usually blocked by failed `migrate` or `unit` (`needs:`) |
| `stage-artifacts` fail | Contract drift or missing `contracts/*` — re-align with `ops_stage.py` / `stage_outputs.ts` |
| `functions` fail on `setup-cli` **rate limit** | Infra flake; re-run failed jobs; not an app regression |
| Worker image fail | Read failed job log; distinguish unit test vs Docker/GHCR |
| `scrape-and-load` fail | Catalog pipeline issue — separate from normalize/detect GPU E2E |
| Check **pending** | Poll with backoff (e.g. 30s); use a background monitor for long image builds (~4–10m) |

### CI vs dual-truth E2E

CI green ≠ match ready. Treat as **layers**:

1. **Contracts + unit** — basename/callback maps consistent  
2. **Migrate + functions** — schema + edge deploy on DEV (PR)  
3. **Worker images** — buildable/testable containers published  
4. **CDN deploy** — presign path deployable  
5. **Match-data** — catalog loader healthy (BWF rows only)  
6. **Runtime E2E** — `annotate_and_ingest.py` dual-truth (this skill’s primary harness)

When reporting “test suite” results on a PR: include **both** CI rollup and
runtime E2E if both were in scope. If only CI was requested, still note that
runtime GPU path was not exercised.

### CI agent checklist

1. Resolve current branch and PR number (`gh pr view` / `gh pr list --head`).
2. `gh pr checks` — list every check with status.
3. For failures: `gh run view … --log-failed`; classify flake vs real drift.
4. Optional: re-run failed only after rate-limit / cancel races; do not loop forever.
5. Confirm path-filtered expectations (e.g. only docs change → fewer workflows).
6. Do **not** commit/push unless the user asks. Do **not** merge the PR unless asked.

## Agent workflow

1. **Clarify target** — new E2E vs monitor existing match vs **env readiness only**; lane (BWF vs user); `--until normalize|detect`; **env = dev|prod** (default **dev**); CI/workflows (default **yes** on a branch/PR).
2. **Environment readiness** — when asked “is DEV/PROD ready?” or before E2E: run **Environment readiness** for that env; stop with `not_ready` + next actions if blocking checks fail. Default env is DEV; prod only if user said prod.
3. **CI first (when applicable)** — `gh pr checks` / `gh run list`; settle or monitor; re-run flakes if appropriate.
4. **BWF only:** ensure catalog match exists (`--match-id` or resolvable `--url`). Do not invent new BWF rows or rewrite tournament/roster.
5. **Confirm secrets** — covered by readiness; re-check names only before long runs.
6. **Pick command** — prefer `annotate_and_ingest.py` for DEV E2E; unit suites for contracts; `gh` for workflows; readiness probes for env health.
7. **Run E2E with long enough timeout** for vast cold start + normalize + detect (default 2h intentional). **PROD E2E only if user explicitly requested.**
8. **Report dual truth** using the verification contract:
   - match id, prefix (`bwf/…` or `users/…`), lane
   - basenames present vs primary/outputs map
   - for BWF: note that `normalized.mp4` is the valid cut; soft-check `frame_ranges.csv`
   - job stage/status vs callback wire mapping
   - match status (`ready` only after **detect** settle)
   - whether `detections.json` is present (content deep-check only if user asks or a small sample is already downloaded)
   - **CI rollup** when branch/PR in scope
   - **env readiness verdict** when that was in scope
9. **On failure** — distinguish: env not ready (secrets, REST, CDN, project secrets, migration drift), CI, catalog miss, enqueue, dispatch, normalize/detect callback, B2 missing primary, DB settle without object, timeout.
10. **Do not** require analyze / `analysis.json` for MVP green. **Do not** treat ReID/`player_id` as required. **Do not** purge `keep_on_regress` when advising regress tests. **Do not** expect live `scores.csv` or primary `valid.mp4`.

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
| Normalize / preprocess | `workers/vast/video-preprocess/README.md` |
| Detect | `workers/vast/video-det/README.md` (+ `ARCHITECTURE.md`) |
| CDN | `workers/cloudflare/cdn/README.md` |
| Match-data (catalog only) | `workers/github/match-data/README.md` |
| Harness | `scripts/annotate_and_ingest.py` |
| CI workflows | `.github/workflows/*.yml` + skill `references/ci-workflows.json` |
| Env readiness | skill `references/env-ready.json` + `scripts/manage.py` `PROFILES` |
| Repo contracts golden | `contracts/stage_artifacts.json` |

## Safety

- Prefer DEV project tokens and CDN.
- No force-push, no prod secret dumps, no destructive B2/DB cleanup unless the user explicitly asks.
- Long-running monitors: use appropriate timeouts; do not spin tight poll loops in the agent beyond the harness.
- Environment readiness may list secret **names** and HTTP status codes only — never values or full JWTs.
