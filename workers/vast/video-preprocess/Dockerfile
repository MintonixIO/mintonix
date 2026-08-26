# CUDA 12.8+ for Blackwell / sm_120 when GPU encode + NVDEC are used.
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

ENV NVIDIA_REQUIRE_CUDA="cuda>=12.8"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates xz-utils openssl unzip \
    python3 python3-pip python3-venv python-is-python3 \
    libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Deno for yt-dlp YouTube n-challenge (required for reliable YT downloads).
ARG DENO_VERSION=v2.1.4
RUN curl -fsSL "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
      -o /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && deno --version

# FFmpeg with NVENC/NVDEC + scale_cuda (pinned BtbN build, not Ubuntu 4.4 apt).
# BtbN dropped 7.1 autobuilds (replaced with 8.1/9.0). Pin a dated GPL linux64
# tarball so CI does not 404. NVENC/NVDEC stay in the gpl static build.
ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-25-13-06/ffmpeg-n8.1.2-44-g7c533d0f86-linux64-gpl-8.1.tar.xz
RUN curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && d="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*')" \
    && install -m755 "$d/bin/ffmpeg" "$d/bin/ffprobe" /usr/local/bin/ \
    && rm -rf /tmp/ffmpeg.tar.xz "$d" \
    && ffmpeg -version | head -1

WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/worker-env \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir -r requirements.txt

COPY . .

# sample.mp4 is used by PyWorker BenchmarkConfig via local_source.
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-preprocess.log \
    ENV_PATH=/opt/worker-env \
    WORKER_PORT=3000 \
    BENCHMARK_LOCAL_SOURCE=/app/sample.mp4

EXPOSE 3000
CMD ["bash", "entrypoint.sh"]
