#!/usr/bin/env bash
# Container entrypoint (docker ENTRYPOINT launch mode on vast serverless).
#
# Same pattern as video-preprocess: prebuilt venv, start FastAPI, wait until
# /health is 200 (TRT engines loaded), optional TLS, then exec PyWorker as PID 1.
# Do not install uv/pip or clone pyworker at boot — that ate the Vast ready window.
set -euo pipefail

ENV_PATH="${ENV_PATH:-/opt/worker-env}"
MODEL_LOG="${MODEL_LOG:-/var/log/portal/video-det.log}"
MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-18000}"
WORKER_PORT="${WORKER_PORT:-3000}"
USE_SSL="${USE_SSL:-true}"
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

# TRT deserialize of baked engines can take tens of seconds after a fast pull.
# 600 × 0.5s = 300s. curl -sf fails on 503 (models not loaded yet).
echo "entrypoint: waiting for http://127.0.0.1:${MODEL_SERVER_PORT}/health"
for _ in $(seq 1 600); do
    if curl -sf "http://127.0.0.1:${MODEL_SERVER_PORT}/health" >/dev/null; then
        break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "entrypoint: ERROR backend exited before healthy" >&2
        tail -n 80 "$MODEL_LOG" >&2 || true
        exit 1
    fi
    sleep 0.5
done
if ! curl -sf "http://127.0.0.1:${MODEL_SERVER_PORT}/health" >/dev/null; then
    echo "entrypoint: ERROR health timeout" >&2
    tail -n 80 "$MODEL_LOG" >&2 || true
    exit 1
fi
echo "entrypoint: backend healthy"

if [ -z "${CONTAINER_ID:-}" ]; then
    echo "entrypoint: ERROR CONTAINER_ID must be set" >&2
    exit 1
fi

if [ "$USE_SSL" = true ]; then
    cat >/etc/openssl-san.cnf <<'EOF'
[req]
default_bits       = 2048
distinguished_name = req_distinguished_name
req_extensions     = v3_req
[req_distinguished_name]
commonName = vast.ai
[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names
[alt_names]
IP.1 = 0.0.0.0
EOF
    openssl req -newkey rsa:2048 -subj "/CN=pyworker.vast.ai/" -nodes -sha256 \
        -keyout /etc/instance.key -out /etc/instance.csr \
        -config /etc/openssl-san.cnf
    http_code=$(curl -sS -o /etc/instance.crt -w '%{http_code}' \
        --header 'Content-Type: application/octet-stream' \
        --data-binary @/etc/instance.csr \
        -X POST "https://console.vast.ai/api/v0/sign_cert/?instance_id=$CONTAINER_ID")
    if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
        echo "entrypoint: ERROR SSL cert sign failed (HTTP $http_code)" >&2
        exit 1
    fi
    echo "entrypoint: SSL cert signed"
fi

export REPORT_ADDR WORKER_PORT USE_SSL UNSECURED
export MODEL_LOG MODEL_SERVER_PORT

cd /app
# shellcheck source=/dev/null
source "${ENV_PATH}/bin/activate"
echo "entrypoint: exec python -m worker"
exec python -m worker
