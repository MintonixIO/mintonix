# Combine preprocess + detect into one worker

Date: 2026-09-02
Status: draft (awaiting review)
Branch: `refra/combine-workers`

## Problem

Normalize (`workers/vast/video-preprocess`) and detect (`workers/vast/video-det`) are two images, two vast endpoints, and two job hops. Happy path today:

```
dispatch normalize → GPU encode → callback → pgmq
dispatch detect    → download mp4 → decode again → pose/shuttle → callback → ready
```

Costs that are not GPU inference: a second cold start, a second pg_cron/dispatch wait, a B2 round-trip of `normalized.mp4`, and a second OpenCV decode. Detect already overlaps decode with TensorRT (`OVERLAP_DECODE`), so the second hop is the expensive part.

## Goal

One GPU worker, still named **video-preprocess**, runs encode and detect in a **single vast job**. After the cheap BWF court pass (or immediately for user uploads), one delivery decode feeds NVENC and pose/shuttle. One callback makes the match `ready`.

Detect-only retry stays so a late detect crash does not force another YouTube download.

`analyze` stays unwired and separate.

## Non-goals

- Wiring `analyze`
- ReID / non-null `player_id`
- New B2 keys, match IDs, or stage names
- Dropping `normalized.mp4` (web + detect retry still need it)
- Running pose/shuttle on the BWF NCC pass (wrong fps, wrong size, includes cutaways)
- A shared `packages/` worker SDK, BaseWorker, job factory, or stage plugin system

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Worker name / folder / image | Keep `video-preprocess` | Existing endpoint, env, CI, logs |
| Detect tree | Move into preprocess, then delete `workers/vast/video-det` | One deploy unit |
| Happy-path route | `POST /preprocess/sync` (fused) | Same dispatcher route as today |
| Retry route | `POST /detect/sync` | Ops `set-stage detect` without re-fetching YouTube |
| Job stages | Keep `normalize` → `detect` → `analyze` | Ops purge, harness, artifacts stay |
| Fused settle | Normalize success **completes at detect**, no requeue | One callback, match `ready` |
| Artifacts | Unchanged basenames | `contracts/stage_artifacts.json` stays |
| Trust model | Unchanged | Presigned URLs + callback token only |
| Code style | Linear job functions, no ABC/factory | AGENTS.md: colocate, abstract on second use |

## Architecture

```
enqueue stage=normalize
        │
        ▼
jobs/dispatch  POST /preprocess/sync   (one vast endpoint)
        │
        ▼
video-preprocess
  download source
  BWF: VFR→CFR if needed, then subsampled NCC → keep ranges + frame_shifts
  delivery pass (user: full; BWF: keep ranges only)
        ├─ NVENC → normalized.mp4
        └─ same BGR frames → pose + shuttle → detections.json
  thumbnail.jpg, preprocess-log.json
  upload all four artifacts
  one callback success
        │
        ▼
complete_job: stage=detect, status=complete, match ready
```

Ops retry:

```
ops_set_stage(detect) → dispatch POST /detect/sync
  GET normalized.mp4 + annotation.json + preprocess-log.json
  VideoDetector.run(path) as today
  PUT detections.json
  callback → complete at detect
```

One vast endpoint name: `VAST_PREPROCESS_ENDPOINT_NAME`. `VAST_DETECT_ENDPOINT_NAME` may point at the same endpoint (already falls back to preprocess if unset). Do not keep a second image.

## File layout

Everything lives under `workers/vast/video-preprocess/`. Move detect modules in; do not invent a third tree.

```
workers/vast/video-preprocess/
  server.py            # /health, /preprocess/sync, /detect/sync, /benchmark/ping
  worker.py            # vast PyWorker (both GPU routes + ping benchmark)
  entrypoint.sh        # detect's bind-fast pattern; log name video-preprocess
  Dockerfile           # TRT runtime + ffmpeg/Deno/yt-dlp + baked models
  requirements.txt     # union; numpy<2 (TRT ABI)

  job.py               # fused happy path only
  detect_job.py        # detect-only retry only
  normalize.py         # probe, NVENC, thumbnail, dual-output helper
  io_util.py           # download, youtube, multipart PUT, single PUT; requests only
  callback.py          # allowlist + POST
  worker_info.py
  trt_io.py

  bwf/                 # court NCC (unchanged job)
  detect/              # VideoDetector, Engine writer, shuttle, OCR
  pose/                # YOLO pose TRT
  models/              # MANIFEST.json; B2 keys stay models/video-det/… (do not rename storage)
  testdata/
  tools/               # debug.py, fetch_models.sh, check_trt_runtime.py, eval scripts
  test_*.py            # preprocess + moved detect tests, plus fused settle/tee tests
```

Delete `workers/vast/video-det/` once the move compiles and CI points at preprocess.

### What each file is for

| File | Does | Does not |
|---|---|---|
| `server.py` | Parse envelope, 422/503, start one job thread, hold connection | Business logic |
| `job.py` | `run_preprocess_job(body)` linear: download → NCC → delivery → upload | Detect-only retry |
| `detect_job.py` | `run_detect_job(body)` linear: download mp4 → `VideoDetector.run` → upload json | Encode, YouTube, NCC |
| `normalize.py` | ffmpeg encode + optional raw BGR iterator using the **same** scale/fps filters | Pose/shuttle |
| `detect/` | Existing detector. Add `VideoDetector.run_frames(bgr_iter)` next to `run(path)` | I/O, callbacks |
| `io_util.py` | One module; merge preprocess (multipart, yt-dlp) + detect (stream PUT). `requests` only; no `file://` in production | |

Two job files because there are two HTTP envelopes. That is a real boundary, not a layer.

### Do not add

- `BaseWorker`, `Pipeline`, `Stage`, `JobRunner`, `FrameSource` protocol
- `workers/vast/common/` or `packages/shared`
- A strategy object for tee vs encode-then-detect (an `if` in `job.py` is enough)
- Extra wrappers around `VideoDetector` or `normalize.encode_*`
- Renaming loggers/image/env to `video-pipeline`

If a helper is used once, it stays in the caller. `run_frames` is extracted only because fused `job.py` and `run(path)` both need the same chunk → pose → shuttle loop.

## Delivery pass (decode-once)

BWF court NCC stays a **first pass** (subsampled ~5 fps, small frames). It does not run TRT.

Second pass is the delivery timeline (≤1080p, ≤30 fps, same filters as today's NVENC):

**User path (`encode_full`):** one ffmpeg process, two outputs from one decode:

- NVENC → local `normalized.mp4` (audio kept)
- raw `bgr24` pipe → Python yields frames

**BWF path (`encode_ranges`):** today each keep-range is an NVENC seek + concat. Extend each segment encode the same way (NVENC file + BGR yield), concat mp4 as now, concatenate frame results in range order. Do not pose on discarded cutaways.

`VideoDetector.run_frames` consumes those BGR frames with the existing chunk size / shuttle peek. Frame index 0 is the first delivery frame — the same index as `normalized.mp4`.

Correctness invariant: **the tee uses the same fps/scale/select as NVENC**. Test this with golden ffmpeg argv / filter strings (CPU). If a run's yielded frame count ≠ encoded frame count, `job.py` logs and **falls back in the same process**: encode with current `encode_full` / `encode_ranges`, then `VideoDetector.run(local_mp4)`. No second class, no B2 round-trip.

Uploads are sequential after work finishes (no extra upload thread). If the fallback path encodes first, it may upload `normalized.mp4` + thumbnail before detect; log and detections go last. One callback after all uploads.

`preprocess-log.json` stays the normalize SSOT (`frame_shifts`, probes, annotation). Additive optional `timings` keys for detect are fine. Do not add a second log file.

## HTTP

Fused jobs are long. Use detect's pattern for **both** GPU routes:

- Envelope OK, models loaded, thread running → **202** `{ request_id }` and **hold the ASGI connection** until the job + callback finish (PyWorker load).
- Bad envelope → **422** (sync, no thread)
- Models not loaded → **503** (sync, no thread)
- `local_source` / `local_output_dir` + `callback_url` → **422** (unchanged)

`GET /health` → 200 only when TRT engines are loaded (`models_loaded: true`). Startup loads engines the way video-det does today (`ALLOW_MISSING_MODELS=1` for CI). The fused image always bakes models; there is no encode-only production image.

`POST /benchmark/ping` → **200**. PyWorker treats only 200 as a successful benchmark. Do **not** use a real encode+detect (or today's sample.mp4 preprocess) as the autoscaler ping — that marked detect workers errored when the route returned 202.

`worker.py`: one Worker, two `HandlerConfig`s (`/preprocess/sync`, `/detect/sync`), both `allow_parallel_requests=False`, ping benchmark, `on_load` includes `VideoDetector loaded`. Keep the detached AppRunner so dispatcher disconnect does not cancel the job.

Copy detect's bind-fast `entrypoint.sh` (do not block on `sign_cert` before port 3000). `USE_SSL=false` in production as today for detect.

Merge `callback.py` with detect's stricter allowlist: prefix **and** path suffix `/functions/v1/jobs/callback`. Fail closed.

## Envelopes

### Fused `/preprocess/sync`

Current preprocess body **plus** `detections_upload_url` (presigned PUT for `detections.json`).

```jsonc
{
  "request_id": "<job_id>",
  "input_url": "<YouTube | presigned GET original>",
  "output_upload": { "part_urls": [], "complete_url": "", "abort_url": "", "part_size": 67108864 },
  "thumbnail_upload_url": "<PUT thumbnail.jpg>",
  "preprocess_log_upload_url": "<PUT preprocess-log.json>",
  "detections_upload_url": "<PUT detections.json>",
  "annotation": { "court": { "corners": [[],[],[],[]], "net_poles": [[],[]] } },
  "callback_url": "https://<ref>.supabase.co/functions/v1/jobs/callback",
  "callback_token": "<HS256 JWT stage=normalize>"
}
```

Annotation stays inline (dispatcher already GETs it for NCC). Fused path does not need `annotation_url` / `preprocess_log_url`.

Local debug: `local_source` + `local_output_dir` still allowed **without** callback. Writes the four artifacts to that directory (including `detections.json`).

Until the dispatcher cutover, a production body **without** `detections_upload_url` is encode-only (today’s preprocess). After cutover, a production body with `callback_url` and no `detections_upload_url` is **422**.

### Retry `/detect/sync`

Unchanged from today's video-det envelope (`input_url`, `output_upload_url`, `annotation_url`, `preprocess_log_url`, callback). Token `stage=detect`.

### Callback

Unchanged wire: `{ request_id, status: "success"|"failed", ... }`. Fused success may include probe fields (`duration`, `width`, `height`, `fps`) plus `frame_count` / `elapsed_sec`. Failures still fail the job if the callback POST fails.

## Job settlement

Today normalize success always sets `p_next_stage = detect` and requeues. That must stop for the fused path.

Append-only migration: add optional `p_complete_stage text default null` to `complete_job` (drop/recreate the function, same pattern as `p_warming`).

Rules:

- `p_next_stage` and `p_complete_stage` together → raise (ambiguous)
- `p_status = complete` and `p_complete_stage` set → `jobs.stage = p_complete_stage`, `status = complete`, **no** pgmq send; apply `p_match` (ready + probes)
- Existing `p_next_stage` requeue path unchanged (unused by fused normalize; still available)
- Detect-only success: `p_status = complete`, `p_next_stage` null, `p_complete_stage` null (stage already `detect`)

`jobs` TypeScript:

```ts
interface Settlement {
  match: Record<string, unknown>;
  next: { stage: string } | null;
  complete_stage?: string;
}
```

`STAGES.normalize.settle` on success: `{ match: { status: "ready", probes… }, next: null, complete_stage: "detect" }`.

`STAGES.normalize.buildEnvelope` adds `detections_upload_url` (presign PUT `detections.json`).

`STAGES.detect` stays for ops retry. Both stages invoke the **same** vast endpoint (`VAST_PREPROCESS_ENDPOINT_NAME`; detect env remains an alias).

Callback token still binds `stage` to the jobs row. Fused callback is `stage=normalize` even though artifacts include detections — CAS stays on the row's current stage. Do not mint a detect token for the fused job.

## Errors and ops

| Failure | Result |
|---|---|
| Missing annotation / envelope | 422, job not started |
| Engines missing at runtime | 503 |
| Download / NCC / NVENC fail | callback `failed`; retry is the fused job (including YouTube) |
| Tee/detect fail after mp4 uploaded | callback `failed`; B2 keeps normalize artifacts; ops `set-stage detect` |
| Detect-only retry fail | callback `failed` on `detect` |
| `ops_set_stage(normalize)` | Re-run fused job (purge still deletes normalize + later) |
| `ops_set_stage(detect)` | `/detect/sync` against B2 |

Vast VT stays 10800s. One session should fit better than two sequential jobs. Image is fatter (TRT + ffmpeg + models); cold start happens once per match.

## Tests

CPU unit tests stay next to the code. GPU e2e stays `scripts/annotate_and_ingest.py --until detect` on DEV.

Keep existing preprocess and detect tests after the move. Add:

- Fused envelope: `detections_upload_url` required when not local-debug
- `complete_job` jump: success from normalize → stage `detect`, status `complete`, no new queue message
- Detect-only envelope still 422 without its fields
- Dual-output ffmpeg argv shares fps/scale with NVENC (string equality)
- `VideoDetector.run_frames` chunking matches `run(path)` on a tiny synthetic clip (no TRT: mock/skip engine in CI via `ALLOW_MISSING_MODELS`)
- Callback allowlist still fail-closed

`contracts/stage_artifacts.json` **does not change**.

CI: extend `.github/workflows/video-preprocess.yml` with video-det's model bake + TRT import checks. Delete `.github/workflows/video-det.yml` in the same change that deletes `workers/vast/video-det`.

Harness: `--until detect` still requires match `ready`, job `complete` at `detect`, both primaries in B2. `--until normalize` still keys off `normalized.mp4` (may appear before detections if encode uploads first).

## Docs to update (same change)

- `ARCHITECTURE.md` — one worker; fused dispatch; detect route = retry
- `workers/README.md` — drop the video-det row
- `workers/vast/video-preprocess/README.md` — fused job + retry route
- `workers/vast/video-det/` — delete; move Engine schema to `workers/vast/video-preprocess/detect/ARCHITECTURE.md` (SSOT for `detections.json`)
- `supabase/README.md` — settle jump; env: one endpoint
- `README.md` issue trackers
- `.grok/skills/mintonix-test-suite/SKILL.md` — one hop, same artifacts

Do not rewrite AGENTS.md folder policy; this is still “one entry per runtime, linear accept → process → upload → callback.”

## Build order

One sequence, not a framework rollout:

1. Move `detect/`, `pose/`, `models/`, `trt_io.py`, detect tests/tools into `video-preprocess`. Merge Dockerfiles (TRT base + ffmpeg/Deno). Union `requirements.txt`. One image builds; both routes respond; **jobs still two hops** so CI can go green without settlement changes.
2. Merge `io_util.py` / `callback.py` / `server.py` / `worker.py` / `entrypoint.sh`. Delete `workers/vast/video-det`. Point CI and docs at preprocess.
3. `complete_job` + `STAGES.normalize` fused envelope and settle jump. `job.py` runs encode then `VideoDetector.run(local_mp4)` in one process (no B2 between). Dispatcher stops requeueing detect on normalize success.
4. Dual-output in `normalize.py` + `run_frames`. Fallback to step-3 local file if frame counts diverge.
5. DEV E2E `annotate_and_ingest.py --until detect`. Confirm a single vast invoke per match on the happy path; confirm `ops_set_stage detect` still works.

Step 3 is already the product win (one cold start, no re-download). Step 4 is the remaining decode-once overlap. Do not skip step 3 waiting on a perfect tee.

Cutover (so in-flight jobs do not 422):

1. Ship the merged image while `/preprocess/sync` still accepts encode-only bodies (no `detections_upload_url`).
2. Point the detect vast endpoint at that same image; `/detect/sync` serves in-flight `stage=detect` jobs.
3. Deploy `complete_job` + jobs function (fused envelope + settle jump).
4. New matches take one hop. Queued detect jobs drain on `/detect/sync`.

## Open questions

None. Naming, retry, and layout are fixed by this spec.
