# video-normalization (vast.ai — normalize stage)

GPU worker for pipeline stage **`normalize`**: download source (presigned or
YouTube), produce **≤1920×1080, ≤30 fps, H.264 / yuv420p, AAC**, thumbnail, and
optional BWF valid-frames cut + `frame_ranges.csv`. Callback Supabase
`jobs/callback`.

Workers hold **no** B2 or Supabase service credentials — only presigned URLs
and a single-use `callback_token`.

| | |
|---|---|
| **Stage** | `normalize` (first GPU stage; advances to `detect`) |
| **In** | original / YouTube URL; BWF: raw `annotation` → worker maps VF config |
| **Out** | `normalized.mp4`, `thumbnail.jpg`; BWF: `frame_ranges.csv`; YT: `original.*` |
| **HTTP** | `POST /normalize/sync` |
| **Dispatcher** | `supabase/functions/jobs` → `STAGES.normalize` |

Encode path is **GPU-only** (NVDEC → `scale_cuda` → `h264_nvenc`). A job on a
host without a usable GPU fails fast and the queue retries (remux-copy of
already-conformant sources needs no GPU).

Deployed on **vast.ai serverless** using the
[PyWorker](https://github.com/vast-ai/pyworker) model.

## Architecture

A PyWorker is a thin proxy the vast autoscaler runs in front of a backend
"model server"; it does not do the work itself. So this worker is three pieces:

| File | Role | Depends on |
|---|---|---|
| `normalize.py` | Stable import facade re-exporting the core API | modules below |
| `io_util.py` | Download / upload (retries + multipart) / callback | `requests` |
| `ffmpeg_ops.py` | Probe, cmd build, run_ffmpeg, thumbnail, NVDEC time-window encode | ffmpeg |
| `annotation_map.py` | thin `annotation.json` → `valid_frames_config` + `apply_valid_frames_defaults` / validate | stdlib |
| `job.py` | `normalize_job` orchestration (full normalize or BWF detect-then-encode) | above |
| `valid_frames.py` | Court NCC + scoreboard OCR → keep-ranges + compact ranges manifest (lazy) | ffmpeg, opencv, numpy, paddleocr |
| `server.py` | FastAPI backend ("model server") on `127.0.0.1:18000`, exposes `POST /normalize/sync` + `GET /health`. | `normalize.py`, fastapi, uvicorn |
| `worker.py` | The vast PyWorker proxy: routes `/normalize/sync` to the backend, reports load, gates readiness on the backend log. | `vastai` (vendor) |
| `start_server.sh` | Vendored from vast-ai/pyworker. Fills autoscaler env defaults, signs the instance TLS cert, builds the worker venv, and launches `python -m worker`. | — |

`entrypoint.sh` starts the backend (`server.py`), then `exec`s `start_server.sh`,
which launches the PyWorker. We hand off to `start_server.sh` rather than running
`python -m worker` ourselves because the SDK's `Worker` needs autoscaler env
(`WORKER_PORT`, `REPORT_ADDR`, `USE_SSL`) and a signed TLS cert that the script
provides — running the worker directly crash-loops on `KeyError: 'WORKER_PORT'`.
The script runs `worker.py` from `SERVER_DIR=/workspace/vast-pyworker` (pre-placed
in the image) in an isolated uv venv, so it never collides with the backend's
system-python deps. Tests import the modules under test (and the `normalize`
facade where convenient), so the unit +
e2e tests run with no SDK installed.

**Deploy must:** publish port 3000 (`-p 3000:3000`, so vast sets
`VAST_TCP_PORT_3000`); leave `BACKEND` and `USE_SYSTEM_PYTHON` unset.

## Request / response

The autoscaler delivers `{"input": {...}}`; the worker's `request_parser`
unwraps it, so the backend receives the inner object:

```json
POST /normalize/sync
{ "input_url": "https://…/source.mp4",                // presigned GET (parallel Range download)
  "request_id": "abc123",
  // exactly one primary output destination:
  // Production: CDN op=MULTIPART → parallel part PUTs (line-rate upload).
  "output_upload": {
    "part_urls":    ["https://…UploadPart&partNumber=1", "…"],
    "complete_url": "https://…CompleteMultipartUpload",
    "abort_url":    "https://…AbortMultipartUpload",
    "part_size":    67108864 },
  // Single PUT / file:// for local CLI; production jobs use output_upload.
  "output_upload_url": "https://…/normalized.mp4",
  "thumbnail_upload_url": "https://…/normalized.jpg", // optional, single PUT
  // optional BWF cleaned path: detect court∧scoreboard on *source*, then ONE
  // GPU encode of keep-ranges into the primary output (normalized.mp4). Detect
  // always reads that key. Compact ranges CSV (not per-frame).
  "valid_frames_config": {
    "court_corners": [[667,398],[1252,398],[1490,990],[436,992]],
    "player_names": ["SHI", "AXELSEN"],
    // scoreboard geometry optional — defaults to top-left quadrant after probe
    "scoreboard_crop": { "x": 175, "y": 55, "w": 1525, "h": 360 },
    "score_sub_crop":  { "x": 0,   "y": 0,  "w": 345,  "h": 95 },
    "row_split_y": 40 },
  "manifest_upload_url": "https://…/frame_ranges.csv",
  // optional youtube pristine archive (multipart preferred)
  "original_upload": { "part_urls": ["…"], "complete_url": "…",
                       "abort_url": "…", "part_size": 67108864 },
  // optional async report channel: the worker POSTs the result (the same
  // body as the HTTP response, plus "status": "success"|"failed") to
  // callback_url with `Authorization: Bearer <callback_token>`, from inside
  // the job thread — so it lands even though the dispatching edge function
  // disconnected long ago. Failure payloads carry "original_archived": true
  // when the pristine-source archive reached B2 before the error, so the
  // dispatcher's retry sources from B2 instead of refetching YouTube.
  "callback_url": "https://…/functions/v1/jobs/callback",
  "callback_token": "<single-use HMAC job token>" }
```
```json
200 { "request_id", "width", "height", "fps", "codec", "audio_codec",
      "pixel_fmt", "duration", "file_size", "source": {…}, "elapsed_sec",
      // present only when thumbnail_upload_url was given:
      "thumbnail": { "width", "height", "file_size", "timestamp_sec" } | null,
      "thumbnail_error"?: "…",
      // present only when valid_frames_config was given (see below):
      "valid_frames"?: { "width", "height", "fps", "duration", "file_size",
                          "source_frame_count", "valid_frame_count",
                          "num_ranges", "manifest_file_size" } }
500 { "request_id", "error" }
```

### Valid-frame extraction (BWF cleaned path)

Ported from the sibling `valid-frames` project (badminton broadcast analysis):
a frame is **valid** iff the main court camera is visible (NCC hysteresis
against a self-bootstrapped template — see `valid_frames.py`) **and** the
scoreboard is visible (OCR presence check, sampled once per second).

**Product contract:** when `valid_frames_config` is set, the cleaned cut
(court ∧ scoreboard) is the **primary** asset written to
`output_upload` / `normalized.mp4`. Detect always consumes that key —
there is no separate primary `valid.mp4` path. Compact
`frame_ranges.csv` (`old_start,old_end,new_start,new_end`) is the side
manifest. `scores.csv` / score-timeline is **not implemented** (deferred).

- **Detect-then-single-encode:** detection runs on the *source* (annotation
  coordinates are source-native). Keep-ranges are then encoded **once** with
  the same NVDEC → `scale_cuda` → `h264_nvenc` time-window primitive as
  full-timeline segment-parallel (accurate `-ss` after `-i` for frame-index
  fidelity). Long keeps split for concurrent NVDEC; no software concat-demux
  re-encode, no full-normalize → re-cut triple pass. **Audio is stripped** on
  the BWF cleaned cut (dropped frames desync the source track).
- **Required config:** `court_corners` + non-empty `player_names`. Scoreboard
  geometry (`scoreboard_crop`, `score_sub_crop`, `row_split_y`) is optional.
  **Ownership:** jobs loads `annotation.json` as a **thin** shape (corners +
  player names + crops only if stored) and does not invent geometry. The
  worker is sole defaulting authority: `apply_valid_frames_defaults` fills
  missing scoreboard geometry after probe (top-left quadrant / full-band
  sub-crop / `row_split_y = h/2`, matching annotate BWF). Tunables
  `ncc_on`/`ncc_off`/`ocr_conf_min`/`min_valid_run` default to the sibling
  project's operating point.
- **force_cfr only when VFR:** full-timeline remux is not forced merely
  because valid-frames is requested; probe marks VFR and only then force-CFR
  re-encodes. BWF VFR builds a same-resolution CFR mezzanine first (`fps=`
  only when pixfmt is already yuv420p; `scale_cuda` only when pixfmt
  conversion is needed — preflight matches the cmd). The BWF range encode
  always emits CFR via `fps=`.
- **Not best-effort** (unlike the thumbnail): extraction failure fails the job.
- **Detect decode** uses NVDEC when a GPU is present (CPU scale to detection
  size after hw decode). **OCR** runs on CPU (`paddleocr`); overlapped with
  band decode; worker count defaults from host cores (`OCR_WORKERS`, cap 8).
  Models are best-effort baked at Docker build; non-BWF jobs never import paddle.

`input_url` is downloaded (HTTP GET, or `file://` for local runs). Downloads use
parallel HTTP byte-ranges (`DL_CONNECTIONS`, default 8) when the server supports
Range and the object is at least `DL_MIN_PARALLEL_BYTES` (default 16 MiB) —
single-stream to B2 caps near ~27 MB/s on a fast host, so range parallelism is
what reaches line rate on multi-GB masters.

**Production jobs** upload the primary asset via **parallel S3 multipart**
(`output_upload` from jobs → CDN `op=MULTIPART`: CreateMultipartUpload +
presigned part/complete/abort URLs). Parts PUT concurrently with
`UL_CONNECTIONS` (default 8). The worker holds no storage credentials. Small
side assets (thumbnail, `frame_ranges.csv`) stay on single presigned PUT.
On any multipart failure the worker POSTs `abort_url`; set a B2 lifecycle rule
to auto-abort incomplete multipart uploads after hard kills. Local CLI may use
`file://` on `output_upload_url`.

If `thumbnail_upload_url` is given, the worker grabs one **random frame** of the
normalized output (uniform within the middle 90% of the timeline, so no black
intro/outro), scales it to `THUMBNAIL_WIDTH` (default 640px, aspect preserved),
and PUTs it there as **JPEG** — the smallest universally-supported format for a
single frame. Presign a `.jpg` key in the same directory as the output so the
extension matches the bytes. The thumbnail is **best-effort**: a failure is
reported in the response (`thumbnail: null` + `thumbnail_error`) but never fails
the job, since the video is already delivered by then.

## Local development

```bash
# unit + e2e tests (no GPU, no vastai needed)
python -m unittest discover -v -s . -p 'test_*.py'

# run the core directly on a local file
python normalize.py '{"input_url":"file:///abs/in.mp4","output_upload_url":"file:///abs/out.mp4"}'

# run the backend server standalone, then POST to it
python server.py
curl -s localhost:18000/normalize/sync \
  -H 'content-type: application/json' \
  -d '{"input_url":"file:///abs/in.mp4","output_upload_url":"file:///abs/out.mp4"}'
```

## Container / deploy

```bash
docker build -t video-normalization .
# GPU host: starts backend + PyWorker
docker run --rm --gpus all video-normalization
```

| Var | Default | Purpose |
|---|---|---|
| `MODEL_SERVER_PORT` | `18000` | Backend port the PyWorker proxies to |
| `MODEL_LOG` | `/var/log/portal/video-normalization.log` | Backend log the PyWorker tails for the `Application startup complete.` readiness line |

### Verified vs. not

**Verified:**
- In-image test suite (CI builds the image, runs `python -m unittest discover -s . -p 'test_*.py'`).
- The full `entrypoint.sh` → `start_server.sh` → PyWorker chain, run locally in
  the image with dummy autoscaler env + `USE_SSL=false`: the venv builds, vendor
  `vastai` installs, the PyWorker boots, **healthchecks the backend `GET /health
  → 200` on a loop**, and the startup `BenchmarkConfig` runs a real `sample.mov`
  transcode (`max_perf` reported). This exercises everything except the two
  platform-only steps below.

**Not yet verified (needs a live deploy — platform-only):**
- **Real TLS cert signing** — `start_server.sh` POSTs a CSR to
  `console.vast.ai/api/v0/sign_cert?instance_id=$CONTAINER_ID`. Needs a real
  instance. If it fails, `UNSECURED=true` is the documented fallback.
- **Autoscaler registration** — the worker reporting to `REPORT_ADDR` with the
  injected `MASTER_TOKEN` and becoming routable. Confirmed locally only with a
  dummy token (no real registration).

Both depend on vast injecting `CONTAINER_ID` / `MASTER_TOKEN` / `PUBLIC_IPADDR` /
`VAST_TCP_PORT_3000` under docker ENTRYPOINT mode. `CONTAINER_ID` was observed
present on a real instance, a strong signal the rest are too.

> The mandatory `BenchmarkConfig` runs a real transcode of the baked-in
> `sample.mov` at worker startup to measure capacity; override its source with
> `BENCHMARK_INPUT_URL` if needed. Benchmark I/O uses `file://` paths that are
> path-allowlisted in the worker (`/app/sample.mov` and `/tmp/benchmark_*.mp4`)
> so capacity measurement works with `ALLOW_FILE_URLS=0` (production default).

## Performance

This workload is **decode-bound** — one 4K60 job saturates a single GPU's NVDEC
engine on many cards. Concurrency and segment-parallel knobs:

| Env | Default | Purpose |
|---|---|---|
| `MAX_INFLIGHT` | `1` | Max concurrent jobs per worker (`2` on high-NVDEC GPUs e.g. 5080) |
| `BENCHMARK_CONCURRENCY` | = `MAX_INFLIGHT` | Startup benchmark in-flight |
| `SEGMENT_PARALLEL_THRESHOLD_SEC` | `600` | Auto keyframe-split → concurrent NVENC → concat above this duration |
| `SEGMENT_PARALLEL_N` | `4` | Segment count when parallel path engages |
| `UPLOAD_ATTEMPTS` | `5` | Single PUT / multipart part retries after encode |
| `OCR_WORKERS` | `max(2, min(8, cores//4))` | Parallel PaddleOCR threads (override to pin) |
| `DL_CONNECTIONS` / `UL_CONNECTIONS` | `8` | Parallel B2 range download / multipart upload |
| `DL_MIN_PARALLEL_BYTES` | `16 MiB` | Min object size before range-parallel download |
| `CALLBACK_URL_PREFIX` / `SUPABASE_URL` | **required in prod** | `callback_url` must match this prefix and end with `/functions/v1/jobs/callback`. **Fail-closed** if unset (no host-open path-suffix). |
| `ALLOW_FILE_URLS` | `0` | Set `1` for arbitrary `file://` (local tests/CLI). Production leave off — stock PyWorker benchmark paths (`file:///app/sample.mov` or `BENCHMARK_INPUT_URL`, and `file:///tmp/benchmark_*.mp4`) are path-allowlisted without this flag |
| `ALLOWED_HTTP_HOSTS` | (empty) | Optional comma-separated host allowlist for download/upload (single PUT and multipart part/complete/abort) |
| `ALLOW_UNSAFE_CALLBACK` | `0` | Dev-only: allow any `callback_url` |

**NVENC concurrency:** product of `MAX_INFLIGHT × SEGMENT_PARALLEL_N` concurrent
encodes can oversubscribe NVENC. Keep `MAX_INFLIGHT=1` when using segment-
parallel (default), or lower `SEGMENT_PARALLEL_N` if raising in-flight. On
5080, `MAX_INFLIGHT=2` with single-stream jobs is the measured sweet spot.

**Intentional residuals:** `scores.csv` score-timeline is not implemented.
Production large-object I/O is parallel (range GET download + multipart PUT
upload); worker-side retries cover B2 blips. BWF VFR uses a same-resolution CFR
mezzanine then detect (not fail-close; annotation geometry preserved; mezzanine
is fps-only when pixfmt is already delivery-compatible). BWF cleaned output has
no audio.

Full benchmarks (4090 vs 5080, segment-parallel ~1.9×, the “85 s floor”) are in
[`FINDINGS.md`](./FINDINGS.md).

## See also

- [FINDINGS.md](FINDINGS.md) — encode / VF notes
- [../video-det/README.md](../video-det/README.md) — next stage (`detect`)
- [../../cloudflare/cdn/README.md](../../cloudflare/cdn/README.md) — B2 `/presign`
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) — job contract / stages
- [../../../supabase/README.md](../../../supabase/README.md) — jobs / annotation layout
