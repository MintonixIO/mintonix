#!/usr/bin/env bash
# Container entrypoint (docker ENTRYPOINT launch mode on vast serverless).
#
# Two processes: FastAPI backend (server.py) + vast PyWorker via start_server.sh.
# Same pattern as video-preprocess/entrypoint.sh.
#
# Models (startup vs health):
#   - Default: weights are baked into the image at /app/models (B2 → CI → docker).
#     POSE_ENGINE / SHUTTLE_CKPT / SHUTTLE_ENGINE must exist when server.py starts;
#     otherwise startup raises and the process dies.
#   - ALLOW_MISSING_MODELS=1 (CI only): server starts without loading models;
#     GET /health then returns 503 {status:not_ready, models_loaded:false} and
#     jobs are refused until weights are present and the process restarts.
#
# Local/benchmark file:// I/O requires ALLOW_FILE_URLS=1 (Dockerfile for sample.mp4).
# Paths are allowlisted to /app, /tmp, and tempfile.gettempdir() only.
set -uo pipefail

export MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-det.log}"
export MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"

mkdir -p "$(dirname "$MODEL_LOG")"
: > "$MODEL_LOG"

echo "entrypoint: starting backend (server.py) -> $MODEL_LOG"
echo "entrypoint: models POSE_ENGINE=${POSE_ENGINE:-/app/models/yolo26x-pose.engine} SHUTTLE_CKPT=${SHUTTLE_CKPT:-/app/models/tracknetv5.pt} SHUTTLE_ENGINE=${SHUTTLE_ENGINE:-/app/models/tracknetv5_fp16_b48.engine}"
python -u /app/server.py >> "$MODEL_LOG" 2>&1 &

tail -n +1 -F "$MODEL_LOG" &

echo "entrypoint: handing off to start_server.sh (launches the PyWorker)"
exec bash /app/start_server.sh
