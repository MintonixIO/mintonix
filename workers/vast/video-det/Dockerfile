# Runtime image is CUDA 12.4 + TRT 10 libs only. Engines stay baked (cold-start
# win). The NGC TensorRT devel image is a *builder* so we do not ship compilers,
# samples, or libnvinfer_builder_resource.
#
# Product engines must be built against this TRT/CUDA stack / GPU arch.
# Product path is TRT-only (no PyTorch wheel).
FROM nvcr.io/nvidia/tensorrt:24.04-py3 AS trt

# Collect inference .so files + the TensorRT Python package. Skip builder-only
# blobs (libnvinfer_builder_resource is hundreds of MB and unused at runtime).
RUN python3 - <<'PY'
import glob
import os
import shutil
import sys
from pathlib import Path

lib_dst = Path("/opt/trt-runtime/lib")
py_dst = Path("/opt/trt-runtime/python")
lib_dst.mkdir(parents=True)
py_dst.mkdir(parents=True)

lib_globs = [
    "/usr/lib/x86_64-linux-gnu/libnvinfer.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_plugin.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_dispatch.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_lean.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_vc_plugin.so*",
    "/usr/lib/x86_64-linux-gnu/libnvonnxparser.so*",
    "/usr/lib/x86_64-linux-gnu/libnvparsers.so*",
    "/usr/lib/x86_64-linux-gnu/libcudnn*.so*",
    "/usr/local/tensorrt/lib/libnvinfer.so*",
    "/usr/local/tensorrt/lib/libnvinfer_plugin.so*",
    "/usr/local/tensorrt/lib/libnvinfer_dispatch.so*",
    "/usr/local/tensorrt/lib/libnvinfer_lean.so*",
    "/usr/local/tensorrt/lib/libnvonnxparser.so*",
    "/usr/local/cuda/lib64/libcudnn*.so*",
]
copied = []
for pattern in lib_globs:
    for src in glob.glob(pattern):
        name = os.path.basename(src)
        if "builder_resource" in name:
            continue
        dest = lib_dst / name
        if dest.exists():
            continue
        shutil.copy2(src, dest, follow_symlinks=False)
        copied.append(name)
if not any(n.startswith("libnvinfer.so") for n in copied):
    sys.exit("ERROR: libnvinfer.so* not found in NGC image")
print("trt libs:", ", ".join(sorted(copied)))

# tensorrt, tensorrt_bindings, tensorrt_libs — whatever import resolves.
import tensorrt  # noqa: E402

seen: set[Path] = set()
for mod in ("tensorrt", "tensorrt_bindings", "tensorrt_libs"):
    try:
        pkg = __import__(mod)
    except ImportError:
        continue
    root = Path(pkg.__file__).resolve().parent
    if root in seen:
        continue
    seen.add(root)
    dest = py_dst / root.name
    shutil.copytree(root, dest, symlinks=True, dirs_exist_ok=True)
    print(f"python pkg: {root} -> {dest}")
if not (py_dst / "tensorrt").exists():
    sys.exit("ERROR: tensorrt python package not found")
print("tensorrt", tensorrt.__version__)
PY

# pycuda has no manylinux wheel — compile it here (g++ / CUDA toolkit) and
# copy the finished venv into the runtime image. Do not compile on the slim stage.
# NGC's python3 has no ensurepip/venv until python3.10-venv is installed.
COPY requirements.txt /tmp/requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3.10-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/worker-env \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/worker-env/bin/python -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && site="$("/opt/worker-env/bin/python" -c "import site; print(site.getsitepackages()[0])")" \
    && cp -a /opt/trt-runtime/python/. "$site/" \
    && /opt/worker-env/bin/python -c "import tensorrt, cv2, fastapi; print('tensorrt', tensorrt.__version__)"

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV NVIDIA_REQUIRE_CUDA="cuda>=12.4" \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python-is-python3 \
    curl ca-certificates openssl \
    libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=trt /opt/trt-runtime/lib/ /usr/local/lib/trt/
COPY --from=trt /opt/worker-env/ /opt/worker-env/
RUN printf '/usr/local/lib/trt\n' > /etc/ld.so.conf.d/trt.conf && ldconfig

WORKDIR /app

# Product path only (see .dockerignore).
COPY . .

# Tiny local sample for autoscaler BenchmarkConfig (file:///app/sample.mp4).
# Written with OpenCV so we do not need ffmpeg in the image.
RUN /opt/worker-env/bin/python - <<'PY'
import cv2
import numpy as np
from pathlib import Path
path = Path("/app/sample.mp4")
# ~1s of 320x180 black frames @ 10fps — enough to exercise download + decode.
fourcc = cv2.VideoWriter_fourcc(*"mp4v")
w = cv2.VideoWriter(str(path), fourcc, 10.0, (320, 180))
frame = np.zeros((180, 320, 3), dtype=np.uint8)
for _ in range(12):
    w.write(frame)
w.release()
assert path.is_file() and path.stat().st_size > 0, path
print("sample.mp4", path.stat().st_size, "bytes")
PY

# Product weights are fetched in CI via CDN delivery (tools/fetch_models.sh →
# ops/model-urls) into ./models/ before `docker build`, then baked here.
# Fail the image if MANIFEST-required files are missing (unless
# BUILD_ALLOW_MISSING_MODELS=1).
ARG BUILD_ALLOW_MISSING_MODELS=0
ENV BUILD_ALLOW_MISSING_MODELS=${BUILD_ALLOW_MISSING_MODELS}
RUN /opt/worker-env/bin/python - <<'PY'
import json, os, sys
from pathlib import Path

models = Path("/app/models")
models.mkdir(parents=True, exist_ok=True)
manifest_path = models / "MANIFEST.json"
allow = os.environ.get("BUILD_ALLOW_MISSING_MODELS", "0") in ("1", "true", "True")
if not manifest_path.is_file():
    print("ERROR: /app/models/MANIFEST.json missing", file=sys.stderr)
    sys.exit(0 if allow else 1)
manifest = json.loads(manifest_path.read_text())
missing = []
for entry in manifest.get("files", []):
    p = models / entry["name"]
    if not p.is_file() or p.stat().st_size == 0:
        missing.append(entry["name"])
    else:
        print(f"model ok: {p.name} ({p.stat().st_size} bytes)")
if missing:
    msg = "models missing: " + ", ".join(missing)
    if allow:
        print("WARN:", msg, "(BUILD_ALLOW_MISSING_MODELS=1)")
    else:
        print("ERROR:", msg, file=sys.stderr)
        print(
            "CI must run tools/fetch_models.sh before docker build.",
            file=sys.stderr,
        )
        sys.exit(1)
print(
    "models bake: version=",
    manifest.get("version"),
    "prefix=",
    manifest.get("b2_prefix"),
)
PY

# ALLOW_FILE_URLS=1 enables local benchmark file:// I/O only.
# Reads: /app (sample.mp4), /tmp, tempfile.gettempdir().
# Writes: /tmp + tempfile only — never /app (see io_util._file_url_write_roots).
# Production job traffic must use https presigned URLs, not file://.
#
# Models are baked under /app/models (B2 → CI → image). Runtime still may
# override paths via env. server.py fails startup if weights are missing
# unless ALLOW_MISSING_MODELS=1 (CI unit tests only).
ENV PATH="/opt/worker-env/bin:${PATH}" \
    ENV_PATH=/opt/worker-env \
    MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-det.log \
    WORKER_PORT=3000 \
    BENCHMARK_INPUT_URL=file:///app/sample.mp4 \
    ALLOW_FILE_URLS=1 \
    POSE_ENGINE=/app/models/yolo26x-pose.engine \
    SHUTTLE_ENGINE=/app/models/tracknetv5_fp16_b48.engine \
    SHUTTLE_TRT_BATCH=48 \
    SHUTTLE_MAX_TRIPLETS=48 \
    OVERLAP_DECODE=1 \
    PARALLEL_DETECT=0 \
    POSE_IMGSZ=640 \
    PYTHONUNBUFFERED=1

EXPOSE 3000

CMD ["bash", "entrypoint.sh"]
