# CUDA 12.8+ for Blackwell / sm_120 when GPU encode + NVDEC are used.
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

ENV NVIDIA_REQUIRE_CUDA="cuda>=12.8"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates xz-utils openssl \
    python3 python3-pip python3-venv python-is-python3 \
    libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

# FFmpeg with NVENC/NVDEC + scale_cuda (not Ubuntu 4.4 apt).
ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz
RUN curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && d="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*')" \
    && install -m755 "$d/bin/ffmpeg" "$d/bin/ffprobe" /usr/local/bin/ \
    && rm -rf /tmp/ffmpeg.tar.xz "$d"

WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/worker-env \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir -r requirements.txt

COPY . .

# sample.mp4 is used by PyWorker BenchmarkConfig (file:///app/sample.mp4).
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-preprocess.log \
    ENV_PATH=/opt/worker-env \
    WORKER_PORT=3000 \
    BENCHMARK_INPUT_URL=file:///app/sample.mp4

EXPOSE 3000
CMD ["bash", "entrypoint.sh"]
