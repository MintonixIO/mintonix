#!/usr/bin/env bash
# Container entrypoint (docker ENTRYPOINT launch mode on vast serverless).
#
# Two processes: FastAPI backend (server.py) + vast PyWorker via start_server.sh.
# Same pattern as video-normalization/entrypoint.sh.
set -uo pipefail

export MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-det.log}"
export MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"

mkdir -p "$(dirname "$MODEL_LOG")"
: > "$MODEL_LOG"

echo "entrypoint: starting backend (server.py) -> $MODEL_LOG"
python -u /app/server.py >> "$MODEL_LOG" 2>&1 &

tail -n +1 -F "$MODEL_LOG" &

echo "entrypoint: handing off to start_server.sh (launches the PyWorker)"
exec bash /app/start_server.sh
