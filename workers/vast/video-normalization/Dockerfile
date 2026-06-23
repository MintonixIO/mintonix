FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git curl ca-certificates \
    python3 python3-pip python3-venv \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY . .

# vast's start_server.sh launches the PyWorker via `python -m worker` from
# SERVER_DIR ($WORKSPACE_DIR/vast-pyworker). Pre-place worker.py there so the
# script skips its git clone (it only clones when SERVER_DIR is absent). It
# builds an isolated uv venv for the worker and installs this requirements.txt,
# so keep it minimal — worker.py imports only `vastai` (installed by the
# script's install_vastai_sdk) plus stdlib.
RUN mkdir -p /workspace/vast-pyworker \
    && cp worker.py /workspace/vast-pyworker/worker.py \
    && printf '# worker.py needs only vastai, installed by start_server.sh\n' \
       > /workspace/vast-pyworker/requirements.txt

# Backend FastAPI server (server.py) + vast PyWorker (worker.py via start_server.sh).
# Do NOT set BACKEND (start_server.sh would then require HF_TOKEN) or
# USE_SYSTEM_PYTHON (that path installs `vastai` over our `vastai-sdk`).
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-normalization.log \
    WORKSPACE_DIR=/workspace \
    WORKER_PORT=3000

CMD ["bash", "entrypoint.sh"]
