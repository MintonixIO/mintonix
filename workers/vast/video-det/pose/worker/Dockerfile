# yolo26x-pose INT8 serverless video worker.
#
# Versions are pinned to EXACTLY what built yolo26x-pose-int8-b16.engine — a TRT
# engine only deserializes under its build-time TensorRT version + GPU arch.
# Verified on the build box: RTX 5090 (sm_120), driver 580.142, CUDA 13.0,
# Ubuntu 24.04, Python 3.12.
#
# Build context is this worker/ directory; build.sh stages the engine + shared
# pipeline modules into it first. Everything (deps, ffmpeg, engine, code) is
# baked into the image so a cold start does zero downloads.
FROM nvidia/cuda:13.0.3-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3-pip ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch (cu130 wheel bundles its own CUDA/cuDNN/cuBLAS) from the PyTorch index;
# tensorrt-cu13 pulls _bindings + _libs; numpy pinned to the build-box version.
RUN pip3 install --index-url https://download.pytorch.org/whl/cu130 \
        torch==2.12.0+cu130 && \
    pip3 install \
        tensorrt-cu13==11.1.0.106 \
        tensorrt-cu13-bindings==11.1.0.106 \
        tensorrt-cu13-libs==11.1.0.106 \
        numpy==2.4.6

# Pipeline code + the prebuilt INT8 engine (staged here by build.sh).
COPY pipeline_decode.py calibrate_workers.py process_video.py entrypoint.sh /app/
COPY yolo26x-pose-int8-b16.engine /app/
RUN chmod +x /app/entrypoint.sh

# Defaults; override per-run with -e. CEILING baked → cold start skips the GPU
# ceiling measurement and runs only the sub-second CPU probe.
ENV ENGINE=/app/yolo26x-pose-int8-b16.engine \
    CEILING=1040 \
    CONF=0.15 \
    THREADS=1

ENTRYPOINT ["/app/entrypoint.sh"]
