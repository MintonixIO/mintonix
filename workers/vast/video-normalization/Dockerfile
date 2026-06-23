FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 python3-pip python3-venv \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY . .

# Backend FastAPI server (server.py) + vast.ai PyWorker (worker.py).
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-normalization.log

CMD ["bash", "entrypoint.sh"]
