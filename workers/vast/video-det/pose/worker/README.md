# Pose-estimation video worker

Self-contained Docker container that runs the full CPU-decode → INT8-TensorRT
pose pipeline on a video and returns a results file. Everything (deps, ffmpeg,
the prebuilt INT8 engine, code) is baked into the image, so a cold start does
**zero downloads**.

What it does on each run:

1. **Calibrate** — detects the container's real vCPU budget (cgroup-aware; the
   raw core count lies in containers) and picks the decoder-worker count from a
   sub-second single-stream ffmpeg probe so CPU decode just clears the GPU
   ceiling. No N-point sweep.
2. **Decode** — `workers` ffmpeg processes letterbox to 640×640 into a shared-
   memory ring registered as CUDA-pinned (frames DMA straight to the GPU, no
   host memcpy).
3. **Infer** — one ordered CUDA stream, K-deep CUDA-graph buffer pool.
4. **Capture & save** — every detection is un-letterboxed to original-resolution
   coords and written to `poses.npz` (+ `poses.json` summary).

## Build

```bash
./build.sh                 # stages engine+modules, builds pose-worker:latest
```

Requires Docker with the NVIDIA Container Toolkit. Pinned to the exact stack that
built the engine (TensorRT 11.1.0.106 / torch 2.12.0+cu130 / numpy 2.4.6 / CUDA
13.0, RTX 5090 sm_120) — a TRT engine only deserializes under its build-time
version and GPU arch.

## Run

```bash
./run.sh /path/to/video.mp4 ./out
```

`--shm-size=2g` is mandatory (the decode ring lives in `/dev/shm`; Docker's 64 MB
default is far too small). The script sets it.

Tunables via `-e` (see `entrypoint.sh`):

| env | default | meaning |
|-----|---------|---------|
| `CONF` | `0.15` | detection conf threshold. INT8 scores run ~0.2 below FP32, and the far singles player is faint; 0.15 captures both court players (extra crowd/officials are expected and filtered downstream). Raise to ~0.4 for clean single-subject only. |
| `CEILING` | `1040` | baked GPU img/s ceiling; set `0` to measure at startup |
| `WORKERS` | _(auto)_ | override calibration |
| `VCPUS` | _(auto)_ | override detected vCPU budget |
| `THREADS` | `1` | ffmpeg threads per worker (pin to 1 → workers scale ~linearly) |
| `OUT` | `/out/poses.npz` | output path inside the container |

## Output

`poses.npz`:
- `dets` — `(N, 57)` float32, one row per detection:
  `[frame_idx, x1, y1, x2, y2, conf, 17×(kx, ky, kconf)]` in **original-resolution**
  pixel coords. Only detections above `CONF` are kept.
- `meta` — JSON string (orig HxW, fps, source/processed frame counts, coverage,
  throughput, worker count, …). Also written separately as `poses.json`.

```python
import numpy as np, json
d = np.load("poses.npz")
dets = d["dets"]                       # (N, 57)
meta = json.loads(str(d["meta"]))
frame = dets[dets[:, 0] == 1000]       # all people in frame 1000
```
