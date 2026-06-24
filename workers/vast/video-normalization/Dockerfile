# CUDA 12.8 is the first toolkit with Blackwell / sm_120 support (RTX 50-series,
# e.g. RTX 5080). Keep this base >= 12.8 to run GPU code on those GPUs.
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

# vast.ai decides 5080 (Blackwell) compatibility by evaluating the image's
# NVIDIA_REQUIRE_CUDA against each offer's host driver. The stock 12.8.0 string
# whitelists host drivers only up to 565 (driver<566), but EVERY rentable vast
# RTX 5080 runs driver 570-595 (verified: 52 live offers, drivers 570.x-595.x,
# cuda_max_good 12.8-13.2). So vast's compat check rejects this image on all of
# them and the autoscaler can never recruit a 5080 — bumping the base tag would
# only shift the ceiling, not remove it (12.9.x still caps at driver<571, which
# matches just 1 of those 52 hosts). Relax the constraint to the real
# requirement — the CUDA floor for sm_120 — so any modern Blackwell driver
# passes. (vast reads this env; NVIDIA_DISABLE_REQUIRE would only affect the
# runtime check, not vast's offer filter.)
ENV NVIDIA_REQUIRE_CUDA="cuda>=12.8"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates xz-utils \
    python3 python3-pip python3-venv \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

# Ubuntu 22.04's apt ffmpeg is 4.4, whose scale_cuda filter has NO `format`
# option (added in ffmpeg 5.0) — so the GPU chain `scale_cuda=w:h:format=nv12`
# in normalize.py fails on every host ("Option 'format' not found"), killing the
# startup benchmark and any real transcode. Its nvcodec headers also predate
# Blackwell (sm_120 / RTX 50-series). Install a current static build with CUDA
# NVENC/NVDEC + scale_cuda(format=…) so the GPU path works on the 5080 and
# matches the ffmpeg we develop/test against locally. It dlopens libcuda /
# libnvcuvid from the host driver at runtime (nothing CUDA is baked in).
ARG FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz
RUN curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && d="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*')" \
    && install -m755 "$d/bin/ffmpeg" "$d/bin/ffprobe" /usr/local/bin/ \
    && rm -rf /tmp/ffmpeg.tar.xz "$d" \
    && ffmpeg -version | head -1

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
# REQUIRE_GPU=1 makes normalize.py refuse to transcode on CPU when no usable
# NVIDIA GPU is present: on a rented GPU instance a libx264 fallback would burn
# credit at a fraction of the speed, and a GPU-broken host should fail its
# startup benchmark so the autoscaler discards it. CI overrides this with
# `-e REQUIRE_GPU=0` to run the CPU e2e test on its GPU-less runner.
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-normalization.log \
    WORKSPACE_DIR=/workspace \
    WORKER_PORT=3000 \
    REQUIRE_GPU=1

CMD ["bash", "entrypoint.sh"]
