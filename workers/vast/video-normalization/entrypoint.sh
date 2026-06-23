#!/usr/bin/env bash
# Starts the two processes a vast.ai PyWorker deployment needs in one container:
#   1. server.py  — the FastAPI backend "model server" that does the transcode
#   2. worker.py  — the PyWorker proxy the autoscaler talks to
#
# The PyWorker detects backend readiness by tailing MODEL_LOG for uvicorn's
# "Application startup complete." line, so the backend's stdout/stderr must land
# in that file. We also mirror it to the container log for debugging.
#
# On managed vast serverless the platform's start_server.sh launches worker.py
# itself; this entrypoint is for running the image standalone (or as the base
# the platform builds on).
set -euo pipefail

export MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-normalization.log}"
export MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"

mkdir -p "$(dirname "$MODEL_LOG")"
: > "$MODEL_LOG"

echo "entrypoint: starting backend (server.py) -> $MODEL_LOG"
python -u server.py >> "$MODEL_LOG" 2>&1 &
backend_pid=$!

# Surface backend logs in the container's own stdout too.
tail -n +1 -F "$MODEL_LOG" &
tail_pid=$!

echo "entrypoint: starting PyWorker (worker.py)"
python -u -m worker &
worker_pid=$!

# Take the container down if EITHER process exits — a worker proxying to a dead
# backend (or a dead worker) is useless. `wait -n` returns on the first exit.
cleanup() { kill "$backend_pid" "$worker_pid" "$tail_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait -n "$backend_pid" "$worker_pid"
echo "entrypoint: a child exited; shutting down"
