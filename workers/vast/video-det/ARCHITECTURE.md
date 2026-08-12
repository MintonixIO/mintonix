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
  │
  ├─ GET input_url          download video (HTTP stream or file://)
  ├─ VideoDetector          single-thread OpenCV: pose then shuttle
  ├─ stream detections.json  (chunked write, then streaming PUT)
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

---

## Output schema (`detections.json`)

One JSON for pose + shuttle (frame-aligned). Analyze consumes this single asset.

```jsonc
{
  "job_id": "uuid",
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

Shuttle is **top-K heatmap peaks** (default K=8, min_conf=0.05) for high
recall — not a single tracked point. Precision is analyze's job.

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
              main thread, **serial on one GPU**:
              ├─ pose.PoseEngine.run_batch (pad last incomplete engine batch)
              │    detect/pose.py to_pose_result normalizes pixels → [0,1]
              └─ detect/shuttle.py TrackNetV5 **stride-1 sliding windows**
                   for global frame i: triplet (i-1, i, i+1), **center** heatmap
                   prev/next from peek + previous chunk last frame
                   list edges pad by repeating edge; micro-batch ≤16 triplets
                   PyTorch path (not TRT) — known gap vs pose
```

**One product path:** OpenCV frame index is the sole authority for pose and
shuttle. No producer thread, no second VideoCapture pass, no multi-ffmpeg
product feed. Zero-frame videos fail the job.

**Serial pose → shuttle (intentional):** both models share one GPU.

Engine tensor shape is the authority for batch/imgsz after load.
Shuttle requires CUDA at construction (GPU worker) and remains **PyTorch**
(TrackNetV5 `.pt`); full TensorRT export is a known deferred project.

---

## Runtime layout (vast.ai)

Matches the proven **normalize** pattern:

| Piece | Role |
|---|---|
| `entrypoint.sh` | Start `server.py`, then `start_server.sh` |
| `start_server.sh` | vast bootstrap: TLS, venv, `python -m worker` |
| `worker.py` | PyWorker: load reporting, proxy to model server |
| `server.py` | FastAPI `/detect/sync` + `/health` (lifespan model load) |
| `io_util.py` | stream download / upload / callback (`file://` + HTTP) |
| `detect/` | VideoDetector, shuttle, types |
| `pose/` | PoseEngine + TRT runner + export helpers |
| `tools/` | visualize + non-product `ffmpeg_pose_bench/` |
| `/app/sample.mp4` | Local benchmark input (`BENCHMARK_INPUT_URL`) |

| Constraint | Value |
|---|---|
| Model server port | `18000` (`MODEL_SERVER_PORT`) |
| PyWorker port | `3000` (`WORKER_PORT`, autoscaler-facing) |
| Parallelism | One job per GPU (`allow_parallel_requests=False`) |
| Handler cancel | Forced off — dispatcher disconnect must not kill load accounting |
| Benchmark | `file:///app/sample.mp4` → `file:///tmp/benchmark_*.json` |

---

## File structure

```
workers/vast/video-det/
├── server.py           # FastAPI job boundary (lifespan startup)
├── worker.py           # PyWorker config
├── io_util.py          # file:// + HTTP transport (stream GET/PUT)
├── entrypoint.sh
├── start_server.sh
├── detect/             # VideoDetector, shuttle, types
│   └── tracknet.py     # TrackNetV5 (loads tracknetv5.pt)
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
  product image (`tensorrt:24.04-py3`) and target GPU arch.
- **Model cache (baked into image):** CI mints CDN delivery URLs via Supabase
  `ops/model-urls` (`PIPELINE_SERVICE_TOKEN`), downloads through Cloudflare
  (free B2→CF egress), writes `models/` (`tools/fetch_models.sh` +
  `models/MANIFEST.json`), then `Dockerfile` copies to `/app/models/`.
  Runtime workers and GHA hold **no** B2 keys. See `models/README.md`.
- Default paths under `/app/models/`:
  - `yolo26x-pose.engine` (`POSE_ENGINE`)
  - `tracknetv5.pt` (`SHUTTLE_CKPT`)
  - `tracknetv5_fp16_b48.engine` (`SHUTTLE_ENGINE`)
- Detect env (see `detect/config.py` + Dockerfile): `POSE_ENGINE`,
  `SHUTTLE_CKPT`, `SHUTTLE_ENGINE`, `POSE_CONF`, batching / overlap flags.
  Startup **fails** if pose/shuttle weights are missing unless
  `ALLOW_MISSING_MODELS=1` (CI unit tests). `/health` returns **503** when
  models are not loaded.
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

- Pose: TensorRT FP16 engine (CUDA graphs in product path)
- Shuttle: TrackNetV5 TRT FP16 when `SHUTTLE_ENGINE` is set; torch `.pt` fallback

### Payload sizing (analyze consumers)

`detections.json` is streamed to disk then PUT once. Rough upper bound per
frame with default K=8 shuttle peaks and up to 4 poses × 17 kpts:

| | |
|---|---|
| ~bytes / frame | ~2–4 KiB JSON (varies with pose count) |
| 30 min @ 30 fps | ~54k frames → ~100–200 MiB JSON |
| Peak worker RAM | video file + one chunk of BGR (~48×1080p) + one peek frame + TrackNet micro-batch (≤16 triplets) + output file |

Analyze should stream-parse the frames array rather than loading whole files
when matches grow long.
