# Combine preprocess + detect Implementation Plan

> **For agentic workers:** Execute inline in this session. First milestone is a **5090-testable Docker image**. Jobs settlement / GHA serverless come after GPU sign-off.

**Goal:** One `video-preprocess` image that can normalize and detect on a 5090 (fused local job + `/detect/sync` retry).

**Architecture:** Move `video-det` modules into `workers/vast/video-preprocess/`. One Dockerfile (TRT runtime + ffmpeg/Deno). `job.py` encodes then runs detect on the local mp4 when `detections_upload_url` or `local_output_dir` is set. `/detect/sync` stays for retry. No factories.

**Tech Stack:** FastAPI, TensorRT 10.8 / CUDA 12.8, ffmpeg NVENC, yt-dlp, vast PyWorker.

## Global Constraints

- Keep the name `video-preprocess` (folder, image, logs, `VAST_PREPROCESS_ENDPOINT_NAME`).
- No BaseWorker / factory / `packages/shared`.
- Artifact basenames unchanged.
- `numpy<2`. One HTTP client: `requests`.
- Trust model unchanged (presigned URLs + callback token).

## Milestone 1 — image for 5090 (this session)

### Task 1: Move detect code into video-preprocess

- git mv `detect/`, `pose/`, `models/`, `trt_io.py`, detect tests, `tools/` (non-colliding), `ARCHITECTURE.md` → `detect/ARCHITECTURE.md`
- Merge colliding files: `io_util.py`, `server.py`, `worker.py`, `Dockerfile`, `entrypoint.sh`, `requirements.txt`, `.dockerignore`
- Add `detect_job.py` from today’s detect `_run_job`
- Delete `workers/vast/video-det`

### Task 2: Fused `job.py` (encode then local detect)

- After `normalized.mp4` exists, if detector is passed and (`local_output_dir` or `detections_upload_url`): write `detections.json` via existing `write_detections_json` + `VideoDetector.run(path)`
- Local debug writes four artifacts
- Production without `detections_upload_url` stays encode-only (cutover)

### Task 3: HTTP surface

- `/health` 200 only when TRT loaded
- `/preprocess/sync` and `/detect/sync` 202 hold-until-done
- `/benchmark/ping` 200
- worker.py: both GPU routes + ping; `on_load = VideoDetector loaded`
- entrypoint: detect bind-fast, `USE_SSL=false`, log `video-preprocess`

### Task 4: Dockerfile

- Detect TRT multi-stage + preprocess ffmpeg/Deno/yt-dlp on Ubuntu 24.04 runtime
- Bake models (CI fetch); `BUILD_ALLOW_MISSING_MODELS` for local
- Union requirements (`setuptools<82`, `numpy<2`, `yt-dlp`, `requests`, `pycuda`, opencv, fastapi, vastai-sdk)

### Task 5: CPU tests + 5090 instructions

- Run preprocess + moved detect unit tests
- Document docker build/run and a local fused POST for the 5090

## Later (after 5090 sign-off)

- `complete_job` `p_complete_stage` + jobs envelope
- ffmpeg decode-once tee
- GHA `video-preprocess.yml` model bake; delete `video-det.yml`
- Point vast serverless at the image
