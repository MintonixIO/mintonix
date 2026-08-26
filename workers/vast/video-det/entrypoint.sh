#!/usr/bin/env bash
# Container entrypoint (docker ENTRYPOINT launch mode on vast serverless).
#
# Prebuilt venv, start FastAPI in the background, then exec PyWorker as PID 1
# so port 3000 binds inside Vast's ~15s window. Do not wait on /health (TRT)
# or sign_cert/openssl — both delayed bind and recycled the box. Default
# USE_SSL=false (HTTP); product detect DEV does not use Vast TLS. PyWorker
# waits for "VideoDetector loaded" then POST /benchmark/ping (HTTP 200;
# /detect/sync is 202). Do not install uv/pip at boot.
set -euo pipefail

ENV_PATH="${ENV_PATH:-/opt/worker-env}"
MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-det.log}"
MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"
WORKER_PORT="${WORKER_PORT:-3000}"
USE_SSL="${USE_SSL:-false}"
REPORT_ADDR="${REPORT_ADDR:-https://run.vast.ai}"

PYTHON="${ENV_PATH}/bin/python"
if [ ! -x "$PYTHON" ]; then
    echo "entrypoint: ERROR missing prebuilt venv: $PYTHON" >&2
    exit 1
fi

mkdir -p "$(dirname "$MODEL_LOG")" /workspace
: > "$MODEL_LOG"

echo "entrypoint: engines POSE_ENGINE=${POSE_ENGINE:-/app/models/yolo26x-pose.engine} SHUTTLE_ENGINE=${SHUTTLE_ENGINE:-/app/models/tracknetv5_fp16_b48.engine}"
echo "entrypoint: starting server.py -> $MODEL_LOG"
"$PYTHON" -u /app/server.py >>"$MODEL_LOG" 2>&1 &
BACKEND_PID=$!
sleep 0.5
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "entrypoint: ERROR backend exited immediately" >&2
    tail -n 80 "$MODEL_LOG" >&2 || true
    exit 1
fi

if [ -z "${CONTAINER_ID:-}" ]; then
    echo "entrypoint: ERROR CONTAINER_ID must be set" >&2
    exit 1
fi

export REPORT_ADDR WORKER_PORT USE_SSL UNSECURED
export MODEL_LOG MODEL_SERVER_PORT

cd /app
# shellcheck source=/dev/null
source "${ENV_PATH}/bin/activate"
echo "entrypoint: exec python -m worker"
exec python -m worker
