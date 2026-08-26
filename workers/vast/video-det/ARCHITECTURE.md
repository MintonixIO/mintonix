# Video Detection Worker — Architecture

## Overview

A vast.ai serverless GPU worker for the pipeline **detect** stage. It downloads
a normalized match video via a presigned URL, runs pose + shuttle, uploads
`detections.json` to B2, and reports completion to the Supabase `jobs/callback`
route.

Workers hold **no** B2 or Supabase service credentials — only presigned URLs
and a single-use `callback_token` (HMAC JWT).

MVP: **no Realtime progress streaming**. Re-add later if the UI needs it.

---

## Pipeline role

```
normalize  →  detect (this worker)  →  analyze (not wired yet)
                  ↓
            detections.json
```

| | |
|---|---|
| **In** | `normalized.mp4` (presigned GET) |
| **Out** | `detections.json` (presigned PUT) |
| **Route** | `POST /detect/sync` |
| **Dispatcher** | `supabase/functions/jobs` → `STAGES.detect` |
| **HTTP** | **202** `{ "request_id" }` once the job thread is running (connection held until GPU + callback). **422** bad envelope, **503** models not loaded (sync, no thread). **200** `POST /benchmark/ping` for PyWorker (SDK counts only 200). Callback is the settle path. |

Always feeds `normalized.mp4`. For BWF, preprocess already writes the cleaned
court cut to that key. `player_id` in poses is always `null`
(identity / ReID is not in the product path).

---

## Actors

| Actor | Role |
|---|---|
| **jobs edge function** | Presigns URLs, mints callback token, routes to vast, settles callback |
| **Backblaze B2** | Input video + output JSON (via CDN `/presign`) |
| **vast.ai Worker** | GPU container: PyWorker + FastAPI model server |
| **Supabase `jobs` / `matches`** | Stage state; advance normalize → detect |

---

## Data flow

```
jobs/dispatch
  │  buildEnvelope(detect): request_id, input_url, output_upload_url,
  │                         callback_url, callback_token
  │  POST vast worker /detect/sync  { auth_data, payload: { input: envelope } }
  ▼
vast PyWorker (worker.py)  ──proxy──►  server.py
  │  HTTP 202 {request_id} as soon as the job thread is running;
  │  ASGI connection held until GPU + callback finish (PyWorker load).
  │
  ├─ GET input_url          download video (HTTP stream or file://)
  ├─ GET annotation_url     optional; scoreboard crop for OCR
  ├─ GET preprocess_log_url optional; frame_shifts → segments[]
  ├─ VideoDetector          OpenCV decode; pose then shuttle (one GPU)
  ├─ stream detections.json  (meta + segments + rallies + frames)
  └─ POST callback_url      Bearer callback_token
       { request_id, status: "success"|"failed", frame_count?, error? }
            │
            ▼
       jobs/callback → complete_job (detect terminal → match ready until analyze)
```

---

## Worker input (inner envelope)

```jsonc
{
  "request_id": "uuid",                 // job_id
  "input_url": "https://…",             // presigned GET or file://
  "output_upload_url": "https://…",     // presigned PUT or file://
  "annotation_url": "https://…",        // optional presigned GET
  "preprocess_log_url": "https://…",    // optional presigned GET
  "callback_url": "https://…/functions/v1/jobs/callback",
  "callback_token": "<jwt>"
}
```

### Callback (worker → jobs)

```jsonc
// success
{ "request_id": "uuid", "status": "success", "frame_count": 1234, "elapsed_sec": 88.1 }
// failure
{ "request_id": "uuid", "status": "failed", "error": "…" }
```

Auth: `Authorization: Bearer <callback_token>` (not a body field).

`POST /detect/sync` status codes:

| Status | When | Body |
|--------|------|------|
| **202** | Envelope valid, models loaded, job thread running | `{ "request_id" }` (connection held until `run_and_report` returns) |
| **422** | Missing URLs or callback URL not allowed | `{ "request_id", "error" }` (sync, no thread) |
| **503** | Detector not loaded | `{ "request_id", "error" }` (sync, no thread) |

A job that later fails still ends the stream as **202** — settlement is the callback (`success` / `failed`), not the HTTP status the dispatcher already left.

---

## Output schema (`detections.json`)

Engine contract: one JSON so 3D reconstruction can form **rallies** from
scoreboard-scored court islands. Engine fails loud if required fields are
missing. Frame indices are always on the **`normalized.mp4` timeline**
(0-based) — the same indices pose/shuttle already use.

### Top level

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `job_id` | string \| null | no | Echo of detect `request_id` |
| `fps` | number | **yes** | Delivery fps of the video actually decoded |
| `width` | int | **yes** | Frame width (pixels) |
| `height` | int | **yes** | Frame height (pixels) |
| `segments` | array | **yes** | Non-empty; one OCR unit per preprocess island |
| `rallies` | array | **yes** | Same-score islands with at most one island between them |
| `frames` | array | **yes** | Non-empty; per-frame pose + shuttle |

```jsonc
{
  "job_id": "uuid",
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "segments": [
    { "start_frame": 0, "end_frame": 180, "score": { "t1": 5, "t2": 3 }, "score_conf": 0.92 },
    { "start_frame": 181, "end_frame": 240, "score": { "t1": 5, "t2": 3 }, "score_conf": 0.88 },
    { "start_frame": 241, "end_frame": 400, "score": { "t1": 5, "t2": 4 }, "score_conf": 0.91 }
  ],
  "rallies": [
    { "start_frame": 0, "end_frame": 240, "score": { "t1": 5, "t2": 3 }, "score_conf": 0.92 },
    { "start_frame": 241, "end_frame": 400, "score": { "t1": 5, "t2": 4 }, "score_conf": 0.91 }
  ],
  "frames": [
    {
      "frame": 0,
      "poses": [
        {
          "keypoints": [[x, y, conf], /* 17 COCO */],
          "bbox": [x1, y1, x2, y2],   // normalized [0,1]
          "conf": 0.91,
          "player_id": null           // always null in product path
        }
      ],
      "shuttle": [
        { "x": 0.42, "y": 0.31, "conf": 0.88 },
        { "x": 0.10, "y": 0.55, "conf": 0.12 }
      ]
    }
  ]
}
```

### `segments[]` (OCR unit)

One entry per **preprocess court-visible island** (`preprocess-log.json`
`frame_shifts[]` → `new_start` / `new_end`). Detect OCRs the BWF scoreboard
(top-left crop from `annotation.json`) once per island.

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `start_frame` | int ≥ 0 | **yes** | Inclusive, normalized timeline |
| `end_frame` | int ≥ 0 | **yes** | Inclusive; `end_frame >= start_frame` |
| `score` | object | **yes** | Scoreboard points while this island was shown |
| `score.t1` | int ≥ 0 | **yes** | Row/team 1 (top of scoreboard) |
| `score.t2` | int ≥ 0 | **yes** | Row/team 2 (bottom of scoreboard) |
| `score_conf` | number ∈ [0,1] | no | OCR confidence (also accepted as `score.conf`) |

User-upload / missing `frame_shifts`: one fallback segment covering the full
decoded video. Missing crop or unreadable digits: `t1`/`t2` = 0 with low
`score_conf` — never invent high-confidence scores.

### `rallies[]` (physics run)

Same fields as a segment. Detect groups islands with the **same** `(t1, t2)`
when their index distance is **at most 2** (adjacent, or one island
between). The rally span is min(start)…max(end) of the group so a single
mid-rally cutaway stays one physics run. Same score farther away is a new
rally. Engine should consume ``rallies[]`` — do not merge every equal
score across the match. Detect does **not** emit video bytes or
`preprocess-log.json`.

### `frames[]` (geometry)

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `frame` | int | **yes** | Unique index in normalized video |
| `poses` | array | **yes** | 0–N persons (may be empty) |
| `poses[].keypoints` | 17×`[x,y,conf]` | **yes** if pose present | COCO-17, **normalized [0,1]** |
| `poses[].bbox` | `[x1,y1,x2,y2]` | no | Normalized |
| `poses[].conf` | number | no | Detection confidence |
| `poses[].player_id` | int \| null | no | Often null |
| `shuttle` | array | **yes** | Top-K candidates, may be `[]` |
| `shuttle[].x/y/conf` | number | **yes** each | Normalized UV + conf |

Shuttle is **top-K heatmap peaks** (default K=8, min_conf=0.05) for high
recall — not a single tracked point. Precision is Engine/analyze's job.

---

## Layers

| | Job boundary | Pose engine |
|---|---|---|
| **Code** | `server.py`, `io_util.py`, `detect/`, `worker.py` | `pose/` package |
| **Owns** | Envelope, B2 I/O, callback, shuttle schedule, JSON | YOLO26x-pose TRT, letterbox, CUDA-graph batch infer |
| **Coords in API** | Normalized `[0,1]` in `detections.json` | Original pixels inside engine; adapter normalizes |

```
server.py → DetectConfig.from_env() → detect.VideoDetector
              single-thread OpenCV VideoCapture:
              read up to chunk_size frames (+ one peek for shuttle next):
              **serial on one GPU** (shared CUDA context + lock):
              ├─ pose.PoseEngine.run_batch (pad last incomplete engine batch)
              │    detect/pose.py to_pose_result normalizes pixels → [0,1]
              └─ detect/shuttle.py TrackNetV5 **stride-1 sliding windows**
                   for global frame i: triplet (i-1, i, i+1), **center** heatmap
                   prev/next from peek + previous chunk last frame
                   list edges pad by repeating edge; micro-batch ≤48 triplets
                   TensorRT only (`SHUTTLE_ENGINE`) — no `.pt` fallback
```

**One product path:** OpenCV frame index is the sole authority for pose and
shuttle. No producer thread, no second VideoCapture pass, no multi-ffmpeg
product feed. Zero-frame videos fail the job.

**Serial pose → shuttle (intentional):** both models share one GPU. The
image sets `PARALLEL_DETECT=0`. If enabled, a process-wide GPU lock still
prevents concurrent TRT execute. CUDA context is detached after load so
`/detect/sync` (job thread) can push it.

Engine tensor shape and **binding dtype** (FLOAT or HALF) are the authority
after load. Host buffers are sized from `engine.get_tensor_dtype`.

---

## Runtime layout (vast.ai)

Matches the proven **normalize** pattern:

| Piece | Role |
|---|---|
| `entrypoint.sh` | Start `server.py`, TLS, `exec python -m worker` (do not block on TRT) |
| `/opt/worker-env` | Prebuilt venv (no uv/pip at boot) |
| `worker.py` | PyWorker: load reporting, proxy to model server |
| `server.py` | FastAPI `/detect/sync` (202) + `/health` + `/benchmark/ping` (200) |
| `io_util.py` | stream download / upload / callback (`file://` + HTTP) |
| `detect/` | VideoDetector, shuttle, types, Engine output |
| `trt_io.py` | Shared CUDA context + TRT binding dtype helpers |
| `pose/` | PoseEngine + TRT runner + export helpers |
| `tools/` | visualize + non-product `ffmpeg_pose_bench/` |
| `/app/sample.mp4` | Local benchmark input (`BENCHMARK_INPUT_URL`) |

| Constraint | Value |
|---|---|
| Model server port | `18000` (`MODEL_SERVER_PORT`) |
| PyWorker port | `3000` (`WORKER_PORT`, autoscaler-facing) |
| Parallelism | One job per GPU (`allow_parallel_requests=False`) |
| Handler cancel | Forced off — dispatcher disconnect must not kill load accounting |
| Benchmark | `POST /benchmark/ping` → HTTP 200 (not `/detect/sync` 202) |

---

## File structure

```
workers/vast/video-det/
├── server.py           # FastAPI job boundary (lifespan startup)
├── worker.py           # PyWorker config
├── io_util.py          # file:// + HTTP transport (stream GET/PUT)
├── trt_io.py           # CUDA context push/pop + FLOAT/HALF bindings
├── entrypoint.sh          # preprocess-style: baked venv + health gate
├── detect/             # VideoDetector, shuttle, types, Engine output
│   ├── segments.py     # islands from frame_shifts → segments[] + rallies[]
│   ├── scoreboard.py   # annotation crop + lightweight digit OCR
│   ├── output.py       # write detections.json (meta + segments + rallies + frames)
│   └── tracknet.py     # TrackNetV5 topology (export tools only; not product)
├── pose/               # PoseEngine + TRT runner + export
├── tools/
│   ├── visualize_detections.py
│   └── ffmpeg_pose_bench/   # non-product multi-ffmpeg research
├── sample.mp4          # generated in Docker image
├── Dockerfile
├── requirements.txt
├── test_*.py           # contract / unit suite (CPU-safe)
└── ARCHITECTURE.md
```

---

## Security

| Concern | Mechanism |
|---|---|
| B2 credentials | Never on worker; presigned URLs only |
| Worker identity | `callback_token` JWT (aud=`jobs-callback`), bound to job/stage/attempt |
| Callback URL | Must match `CALLBACK_URL_PREFIX` or `SUPABASE_URL` + path `/functions/v1/jobs/callback` (fail-closed if prefix unset; `ALLOW_UNSAFE_CALLBACK=1` for local only) |
| Service role key | Never passed to the worker |
| Replay | Callback marks job terminal / CAS on attempt+stage |

---

## Ops notes

- TensorRT engines are GPU-arch + TRT-version specific; build via
  `pose/export_trt.py` / `tools/export_tracknet_trt.py` on a host matching the
  product image (TRT 10 / CUDA 12.4 — NGC `tensorrt:24.04-py3` builder,
  CUDA runtime final stage) and target GPU arch.
- **Model cache (baked into image):** CI mints CDN delivery URLs via Supabase
  `ops/model-urls` using GitHub Environment naming
  (`vars.SUPABASE_PROJECT_REF` + `secrets.SUPABASE_SERVICE_KEY`; edge
  `PIPELINE_SERVICE_TOKEN` is the same value as the service key), downloads
  through Cloudflare (free B2→CF egress), writes `models/`
  (`tools/fetch_models.sh` + `models/MANIFEST.json`), then `Dockerfile` copies
  to `/app/models/`. Runtime workers and GHA hold **no** B2 keys. See
  `models/README.md`.
- Default paths under `/app/models/` (engines only — no `.pt`):
  - `yolo26x-pose.engine` (`POSE_ENGINE`)
  - `tracknetv5_fp16_b48.engine` (`SHUTTLE_ENGINE`)
- Detect env (see `detect/config.py` + Dockerfile): `POSE_ENGINE`,
  `SHUTTLE_ENGINE`, `POSE_CONF`, batching / overlap flags.
  `PARALLEL_DETECT` defaults to **0** (one GPU). Startup **fails** if
  engines are missing or fail to load unless `ALLOW_MISSING_MODELS=1`
  (CI unit tests). `/health` returns **503** when models are not loaded.
- `ALLOW_FILE_URLS=1` required for `file://` benchmark I/O (set in Dockerfile for
  `sample.mp4`). **Reads** allowlisted under `/app`, `/tmp`, or
  `tempfile.gettempdir()`. **Writes** allowlisted under `/tmp` /
  `tempfile.gettempdir()` only (not `/app`). Production jobs use https
  presigned URLs. Downloads capped by `MAX_DOWNLOAD_BYTES`. HTTP clients use
  `follow_redirects=False`; **3xx is a hard error**.
- CI smoke: fetch models via CDN delivery → bake → assert files present →
  `import server, worker, detect` + `test_*.py` with CUDA stub and
  `ALLOW_MISSING_MODELS=1` (tests that exercise missing-model 503).
- Env for jobs function: `VAST_DETECT_ENDPOINT_NAME` (optional fallback to
  `VAST_PREPROCESS_ENDPOINT_NAME`, then legacy `VAST_NORMALIZE_ENDPOINT_NAME` /
  `VAST_ENDPOINT_NAME`).
- Upload streams from disk (no full-file `read_bytes` into RAM). Exception
  text for callbacks/API is redacted (presigned query strings stripped).

### CUDA stacks

- Pose: TensorRT engine (pycuda I/O; no PyTorch)
- Shuttle: TrackNetV5 TRT engine only (`SHUTTLE_ENGINE` required; no `.pt`)

### Payload sizing (analyze consumers)

`detections.json` is streamed to disk then PUT once. Rough upper bound per
frame with default K=8 shuttle peaks and up to 4 poses × 17 kpts:

| | |
|---|---|
| ~bytes / frame | ~2–4 KiB JSON (varies with pose count) |
| 30 min @ 30 fps | ~54k frames → ~100–200 MiB JSON |
| Peak worker RAM | video file + one chunk of BGR (~48×1080p) + one peek frame + TrackNet micro-batch (≤48 triplets) + output file |

Analyze should stream-parse the frames array rather than loading whole files
when matches grow long.
