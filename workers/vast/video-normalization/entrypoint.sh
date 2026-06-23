#!/usr/bin/env bash
# Container entrypoint (docker ENTRYPOINT launch mode on vast serverless).
#
# Two processes are needed: our FastAPI backend (server.py) that does the
# transcode, and vast's PyWorker that the autoscaler talks to. We start the
# backend, then hand off to vast's own start_server.sh to launch the PyWorker.
#
# Why start_server.sh and not `python -m worker` directly: the SDK's Worker
# needs autoscaler env (WORKER_PORT, REPORT_ADDR, USE_SSL, a signed TLS cert,
# ...) that start_server.sh provides — it fills the env defaults, signs the
# instance cert via the injected CONTAINER_ID, builds the worker venv, and runs
# `python -m worker` from SERVER_DIR. Running worker.py ourselves skipped all of
# that and crash-looped on `KeyError: 'WORKER_PORT'`.
set -uo pipefail

export MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-normalization.log}"
export MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"

mkdir -p "$(dirname "$MODEL_LOG")"
: > "$MODEL_LOG"

echo "entrypoint: starting backend (server.py) -> $MODEL_LOG"
python -u /app/server.py >> "$MODEL_LOG" 2>&1 &

# Mirror backend logs into the container log (start_server.sh's PyWorker also
# tails MODEL_LOG to detect the backend's readiness line).
tail -n +1 -F "$MODEL_LOG" &

echo "entrypoint: handing off to start_server.sh (launches the PyWorker)"
exec bash /app/start_server.sh
