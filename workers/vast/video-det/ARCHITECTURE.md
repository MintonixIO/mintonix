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
  ├─ VideoDetector          single-pass OpenCV: pose + shuttle (+ exclusive ReID)
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
              single OpenCV VideoCapture (one producer thread owns the cap):
              one-chunk lookahead decode (Queue maxsize=1 data-only + EOS Event):
              main thread per chunk, **serial on one GPU**:
              ├─ pose.PoseEngine.run_batch (pad last incomplete engine batch)
              │    detect/pose.py to_pose_result normalizes pixels → [0,1]
              │    product GpuConsumer is K=1: stage_host → run_gpu → sync
              ├─ detect/shuttle.py TrackNetV5 **stride-1 sliding windows**
              │    for global frame i: triplet (i-1, i, i+1), **center** heatmap
              │    one-frame hold in run() only (prev/next stitch → _process_chunk)
              │    list edges pad by repeating edge; micro-batch ≤16 triplets
              │    PyTorch path (not TRT) — known gap vs pose
              └─ detect/reid.py (optional OSNet; seed + match on **main** thread)
```

**One product path:** OpenCV frame index is the sole authority for pose and
shuttle. No full-video pose map, no second VideoCapture pass, no multi-ffmpeg
product feed (frame desync risk). Zero-frame videos fail the job.

**Decode/process overlap:** a CPU-only producer thread fills the next BGR chunk
while the main thread runs pose→shuttle→ReID. Data queue is **maxsize=1**
(one pending chunk). EOS is a separate ``threading.Event`` (always writable;
never competes for a queue slot; main drains remaining items on EOS before
breaking — no TOCTOU drop). Peak BGR residency when the producer is
**put-blocked** is about **producer fill buffer + one queued chunk +
main-thread current chunk + one held boundary frame** (≈**3×** ``chunk_size``
pipeline frames + 1 held frame; each BGR already `.copy()`'d).

**Cross-chunk shuttle:** hold lives only in ``run()``. The last frame of each
OpenCV chunk is held (BGR + index) until the next chunk (or EOS); ``run()``
then calls pure ``_process_chunk`` with resolved ``prev_frame`` / ``next_frame``.
Video start/end still edge-pad.

**Serial pose → shuttle (intentional):** both models share one GPU. Dual-stream
pose+shuttle is deliberately out of scope for the product path — simpler
scheduling, correct frame alignment, no multi-stream CUDA complexity.
ReID (pycuda/TRT) runs only on the main thread.

Engine tensor shape is the authority for batch/imgsz after load. Product
`GpuConsumer` uses a single CUDA-graph buffer (no multi-K research ring). Multi-K
`feed` / decode-ring APIs live only under `tools/ffmpeg_pose_bench/`.
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
| `io_util.py` | download / upload / callback (`file://` + HTTP) |
| `detect/` | VideoDetector, shuttle, reid, types |
| `pose/` | PoseEngine + TRT runtime + export helpers |
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
├── io_util.py          # file:// + HTTP transport (streaming PUT)
├── entrypoint.sh
├── start_server.sh
├── detect/             # VideoDetector, shuttle, reid, types
│   └── tracknet.py     # TrackNetV5 (loads tracknetv5.pt)
├── pose/               # PoseEngine + product GpuConsumer (K=1) + export
├── tools/
│   ├── visualize_detections.py
│   └── ffmpeg_pose_bench/   # non-product multi-ffmpeg research (RingGpuConsumer)
├── sample.mp4          # generated in Docker image
├── Dockerfile
├── .dockerignore
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
- Detect env (see `detect/config.py`): `POSE_ENGINE`, `SHUTTLE_CKPT`,
  `REID_ENGINE`, `POSE_CONF`. Startup **fails** if pose/shuttle weights are
  missing unless `ALLOW_MISSING_MODELS=1` (CI). `/health` returns **503** when
  models are not loaded. Mount models **before** `server.py` starts
  (see `entrypoint.sh` comment).
- `ALLOW_FILE_URLS=1` required for `file://` benchmark I/O (set in Dockerfile for
  `sample.mp4`). **Reads** allowlisted under `/app`, `/tmp`, or
  `tempfile.gettempdir()`. **Writes** allowlisted under `/tmp` /
  `tempfile.gettempdir()` only (not `/app`, so jobs cannot overwrite app assets).
  Production jobs use https presigned URLs.
  Downloads capped by `MAX_DOWNLOAD_BYTES` / `MAX_MASK_BYTES`. HTTP clients use
  `follow_redirects=False`; **3xx is a hard error** (B2/S3 presigns do not redirect).
- CI smoke: `import server, worker, detect` + `test_*.py` with CUDA stub;
  set `ALLOW_MISSING_MODELS=1` if the model server process is started without
  weights.
- Env for jobs function: `VAST_DETECT_ENDPOINT_NAME` (optional fallback to
  `VAST_ENDPOINT_NAME`).
- Download parallelism: `DL_CONNECTIONS` (default 8) for range-capable GETs.
- Upload streams from disk (no full-file `read_bytes` into RAM). Exception
  text for callbacks/API is redacted (presigned query strings stripped).

### Dual CUDA stacks (intentional)

- Pose: torch + TensorRT CUDA graphs (product `GpuConsumer` K=1)
- Shuttle: torch TrackNetV5 (PyTorch, not TRT — known gap)
- ReID: pycuda + TensorRT (optional; leave as-is)

Do not big-bang rewrite ReID onto one stack unless needed. Full TrackNet TRT
export is deferred (large project; product stays on improved PyTorch path).

### Payload sizing (analyze consumers)

`detections.json` is streamed to disk then PUT once. Rough upper bound per
frame with default K=8 shuttle peaks and up to 4 poses × 17 kpts:

| | |
|---|---|
| ~bytes / frame | ~2–4 KiB JSON (varies with pose count) |
| 30 min @ 30 fps | ~54k frames → ~100–200 MiB JSON |
| Peak worker RAM | video file + ≈3× chunk BGR when put-blocked (producer fill + 1 queued + main current; ≤96 frames each; ~48×1080p ≈ 300 MiB/chunk) + one held boundary frame + TrackNet micro-batch host tensors (≤16 triplets) + output file (not full JSON in RAM). Queue is maxsize=1 data-only; EOS is an Event |

Analyze should stream-parse the frames array rather than loading whole files
when matches grow long.
