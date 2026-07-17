# Video Detection Worker — Architecture

## Overview

A vast.ai serverless GPU worker for the pipeline **detect** stage. It downloads
a normalized match video via a presigned URL, runs pose + shuttle (+ optional
ReID), uploads `detections.json` to B2, and reports completion to the Supabase
`jobs/callback` route.

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
| **In** | `normalized.mp4` (presigned GET); optional `player_mask_url` PNG |
| **Out** | `detections.json` (presigned PUT) |
| **Route** | `POST /detect/sync` |
| **Dispatcher** | `supabase/functions/jobs` → `STAGES.detect` |

MVP always feeds `normalized.mp4`. Prefer `valid.mp4` later when dispatch can
confirm the object exists. Optional `player_mask_url` is accepted by the worker
but not yet presigned by jobs (ReID `player_id` stays null until mask lands).

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
  ├─ GET input_url          download video (HTTP or file://)
  ├─ optional player_mask   SlimSAM PNG → ReID seeds
  ├─ VideoDetector          pose + shuttle (+ exclusive ReID)
  ├─ stream detections.json  (chunked write, then PUT)
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
  "callback_token": "<jwt>",
  "player_mask_url": "https://…"        // optional PNG
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
          "player_id": 1              // null without mask/ReID
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

Optional `player_mask_url`: single-channel PNG, `0` = background, each positive
value = one player on frame 0. Seeds ReID reference embeddings; assignment is
**exclusive** (greedy bipartite by cosine similarity).

---

## Layers

| | Job boundary | Pose engine |
|---|---|---|
| **Code** | `server.py`, `io_util.py`, `detect/`, `worker.py` | `pose/` package |
| **Owns** | Envelope, B2 I/O (`file://` + HTTP), callback, shuttle+ReID schedule, JSON | YOLO26x-pose TRT, letterbox, CUDA-graph batch infer |
| **Coords in API** | Normalized `[0,1]` in `detections.json` | Original pixels inside engine; adapter normalizes |

```
server.py → DetectConfig.from_env() → detect.VideoDetector
              ├─ pose feed (opencv | ffmpeg)
              │    opencv:  detect/pose_feed.run_opencv_pose → pose.PoseEngine
              │    ffmpeg:  pose.ffmpeg_feed (multi-process SHM + GpuConsumer)
              │    both end at EngineDetection via pose.engine.decode_pose_*
              ├─ OpenCV once: detect/shuttle.py (TrackNetV5 → top-K peaks)
              └─ detect/reid.py (optional OSNet, exclusive match)
```

**One orchestration path:** pose feed produces `dict[frame → detections]`, then a
single OpenCV pass attaches shuttle (+ optional ReID). Output length equals
frames successfully read by OpenCV; missing pose indices are empty lists (no
invented trailing frames).

Default feed is **opencv** (`POSE_FEED=opencv`). FFmpeg multi-decode is opt-in
(`POSE_FEED=ffmpeg`; legacy `POSE_PIPELINE=research`). Engine tensor shape is
the authority for batch/imgsz after load. CUDA graphs run inside `GpuConsumer`.

---

## Runtime layout (vast.ai)

Matches the proven **normalize** pattern:

| Piece | Role |
|---|---|
| `entrypoint.sh` | Start `server.py`, then `start_server.sh` |
| `start_server.sh` | vast bootstrap: TLS, venv, `python -m worker` |
| `worker.py` | PyWorker: load reporting, proxy to model server |
| `server.py` | FastAPI `/detect/sync` + `/health` |
| `io_util.py` | download / upload / callback (`file://` + HTTP) |
| `detect/` | VideoDetector, pose adapter, TrackNet, reid, types |
| `pose/` | Engine used by product |
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
├── server.py           # FastAPI job boundary
├── worker.py           # PyWorker config
├── io_util.py          # file:// + HTTP transport
├── entrypoint.sh
├── start_server.sh
├── detect/             # VideoDetector, shuttle, reid, types
│   └── tracknet.py     # TrackNetV5 (loads tracknetv5.pt)
├── pose/               # PoseEngine + TRT runtime + export helpers
├── sample.mp4          # generated in Docker image
├── Dockerfile
├── .dockerignore
├── requirements.txt
├── test_contract.py
└── ARCHITECTURE.md
```

---

## Security

| Concern | Mechanism |
|---|---|
| B2 credentials | Never on worker; presigned URLs only |
| Worker identity | `callback_token` JWT (aud=`jobs-callback`), bound to job/stage/attempt |
| Service role key | Never passed to the worker |
| Replay | Callback marks job terminal / CAS on attempt+stage |

---

## Ops notes

- TensorRT engines are GPU-arch + TRT-version specific; build via
  `pose/export_trt.py` on a host matching the product image
  (`tensorrt:24.04-py3`).
- Weights expected under `/app/models/` (mount or download at start):
  - pose TRT engine (`POSE_ENGINE`; spatial size + batch from tensor shape)
  - `tracknetv5.pt` (`SHUTTLE_CKPT`)
  - optional `osnet_reid_int8.engine` (`REID_ENGINE`)
- Detect env (see `detect/config.py`): `POSE_FEED`, `POSE_CONF`, optional
  `POSE_IMGSZ` / `POSE_DECODE_WORKERS` / `POSE_CEILING` for ffmpeg feed.
- CI smoke: `import server, worker, detect` + `test_contract` with CUDA stub.
- Env for jobs function: `VAST_DETECT_ENDPOINT_NAME` (optional fallback to
  `VAST_ENDPOINT_NAME`).
- Download parallelism: `DL_CONNECTIONS` (default 8) for range-capable GETs.

### Payload sizing (analyze consumers)

`detections.json` is streamed to disk then PUT once. Rough upper bound per
frame with default K=8 shuttle peaks and up to 4 poses × 17 kpts:

| | |
|---|---|
| ~bytes / frame | ~2–4 KiB JSON (varies with pose count) |
| 30 min @ 30 fps | ~54k frames → ~100–200 MiB JSON |
| Peak worker RAM | video file + one 48-frame BGR chunk + output file (not full JSON in RAM) |

Analyze should stream-parse the frames array rather than loading whole files
when matches grow long.
