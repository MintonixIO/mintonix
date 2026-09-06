# tools

## `ffmpeg_pose_bench/` (non-product)

Multi-ffmpeg SHM + CUDA-graph pose throughput research. **Not** used by
`detect.VideoDetector` or `server.py`. Time-sliced multi-decode can desync from
sequential OpenCV shuttle indices; product stays single OpenCV pass.

Owns multi-K `RingGpuConsumer` + zero-copy `feed` (`ring_consumer.py`); product
pose uses `pose.trt_runtime._TrtRunner.infer` only.

```bash
# from workers/vast/video-preprocess with PYTHONPATH=.
python -c "from tools.ffmpeg_pose_bench.ffmpeg_feed import run_ffmpeg_pose"
```

## `run_ds1_eval.py` / `remote_ds1_bootstrap.sh`

GPU-host eval. Writes the **Engine** `detections.json` (meta + `segments` +
`rallies` + `frames`) via the same writer as `server.py`. Requires
`POSE_ENGINE` + `SHUTTLE_ENGINE` (no `.pt`). Optional `--annotation` and
`--preprocess-log` (bootstrap picks them up from `$DS1/` when present).

## `visualize_detections.py`

Overlay product `detections.json` (pose + shuttle) on a match video for quality review.

### Inputs

| | |
|---|---|
| Video | e.g. `matches/…/normalized.mp4` |
| Detections | product JSON: `{ "job_id", "fps", "width", "height", "segments", "rallies", "frames" }` (overlay uses `frames[]`) |

Coords are **normalized [0,1]** of the source frame for both pose and shuttle peaks.

### Quick start

```bash
# from workers/vast/video-preprocess
python3 tools/visualize_detections.py \
  --video /path/to/normalized.mp4 \
  --detections /path/to/detections.json \
  --start 45000 --end 45900 \
  --out /tmp/preview.mp4 \
  --png-dir /tmp/pngs --png-every 30 \
  --scale 0.5
```

### Useful flags

| Flag | Meaning |
|---|---|
| `--start` / `--end` | Frame range (end exclusive) |
| `--stride N` | Keep every Nth frame |
| `--max-frames` | Cap written frames |
| `--kpt-conf` | Min keypoint conf to draw (default 0.3) |
| `--shuttle-min-conf` | Min shuttle peak conf (default 0.05) |
| `--shuttle-k` | Max peaks drawn (default 8) |
| `--scale` | Resize output (0.5 = half-res preview) |

Legend: person colors = multi-pose; **red ring** = highest-conf shuttle peak; HUD shows frame index / time / counts.
