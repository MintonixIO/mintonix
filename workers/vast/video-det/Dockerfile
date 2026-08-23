# Runtime image is CUDA 12.6 + TRT 10.6 libs only. Engines stay baked (cold-start
# win). The NGC TensorRT devel image is a *builder* so we do not ship compilers,
# samples, or libnvinfer_builder_resource.
#
# Product engines must be built against this TRT/CUDA stack / GPU arch (sm_120).
# Product path is TRT-only (no PyTorch wheel).
FROM nvcr.io/nvidia/tensorrt:24.11-py3 AS trt

# Collect inference .so files via realpath + ldd closure (libnvinfer needs
# libcublas / libcublasLt). Copy real files, not dangling absolute symlinks.
# skip_copied_lib denylists builder_resource, glibc/libstdc++, libcuda (host driver).
COPY tools/check_trt_runtime.py /tmp/check_trt_runtime.py
RUN python3 - <<'PY'
import glob
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "check_trt_runtime", "/tmp/check_trt_runtime.py"
)
assert spec and spec.loader
crt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crt)
skip_copied_lib = crt.skip_copied_lib

lib_dst = Path("/opt/trt-runtime/lib")
py_dst = Path("/opt/trt-runtime/python")
lib_dst.mkdir(parents=True)
py_dst.mkdir(parents=True)

seeds = []
for pattern in (
    "/usr/lib/x86_64-linux-gnu/libnvinfer.so*",
    "/usr/local/tensorrt/lib/libnvinfer.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_plugin.so*",
    "/usr/local/tensorrt/lib/libnvinfer_plugin.so*",
    "/usr/lib/x86_64-linux-gnu/libnvonnxparser.so*",
    "/usr/local/tensorrt/lib/libnvonnxparser.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_dispatch.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_lean.so*",
    "/usr/lib/x86_64-linux-gnu/libnvinfer_vc_plugin.so*",
    "/usr/lib/x86_64-linux-gnu/libnvparsers.so*",
    "/usr/local/tensorrt/lib/libnvinfer_dispatch.so*",
    "/usr/local/tensorrt/lib/libnvinfer_lean.so*",
    "/usr/lib/x86_64-linux-gnu/libcudnn*.so*",
    "/usr/local/cuda/lib64/libcudnn*.so*",
):
    seeds += [Path(p) for p in glob.glob(pattern)]

needed: set[Path] = set()
queue = [
    p.resolve()
    for p in seeds
    if p.is_file() and not skip_copied_lib(p.name)
]
while queue:
    lib = queue.pop()
    if lib in needed or not lib.is_file():
        continue
    if skip_copied_lib(lib.name):
        continue
    needed.add(lib)
    try:
        out = subprocess.check_output(["ldd", str(lib)], text=True)
    except subprocess.CalledProcessError:
        continue
    for line in out.splitlines():
        if " => " not in line or "not found" in line:
            continue
        dest = line.split(" => ", 1)[1].split(" (")[0].strip()
        if dest.startswith("/"):
            queue.append(Path(dest).resolve())

copied = []
for src in sorted(needed):
    if skip_copied_lib(src.name):
        continue
    shutil.copy2(src, lib_dst / src.name, follow_symlinks=True)
    copied.append(src.name)
if not any(n.startswith("libnvinfer.so") for n in copied):
    sys.exit("ERROR: libnvinfer.so* not found in NGC image")
print("trt libs:", ", ".join(sorted(copied)))

# Stubs for bake/CI import only (not registered with the dynamic linker).
stub_dst = Path("/opt/trt-runtime/cuda-stubs")
stub_dst.mkdir(parents=True)
for pattern in (
    "/usr/local/cuda/lib64/stubs/libcuda.so*",
    "/usr/local/cuda/compat/libcuda.so*",
):
    for src in glob.glob(pattern):
        shutil.copy2(src, stub_dst / Path(src).name, follow_symlinks=True)
print("cuda stubs:", ", ".join(sorted(p.name for p in stub_dst.glob("*"))) or "(none)")

# tensorrt, tensorrt_bindings, tensorrt_libs — whatever import resolves.
# Follow symlinks so the slim image does not inherit dangling NGC paths.
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
    shutil.copytree(root, dest, symlinks=False, dirs_exist_ok=True)
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

FROM nvidia/cuda:12.6.3-runtime-ubuntu22.04

ENV NVIDIA_REQUIRE_CUDA="cuda>=12.6" \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    EXPECTED_TRT_VERSION=10.6.0 \
    TRT_LIB_DIR=/usr/local/lib/trt

# python3-distutils: vastai's PyWorker backend imports distutils.util.strtobool.
# Ubuntu's python3 package does not ship distutils; without it, `from vastai
# import BenchmarkConfig` succeeds with BenchmarkConfig=None (SDK swallows
# ImportError) and `python -m worker` dies at config construction.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python-is-python3 python3-distutils \
    curl ca-certificates openssl \
    libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=trt /opt/trt-runtime/lib/ /usr/local/lib/trt/
COPY --from=trt /opt/trt-runtime/cuda-stubs/ /opt/cuda-stubs/
COPY --from=trt /opt/worker-env/ /opt/worker-env/
ENV LD_LIBRARY_PATH="/usr/local/lib/trt:${LD_LIBRARY_PATH}"
RUN printf '/usr/local/lib/trt\n' > /etc/ld.so.conf.d/trt.conf && ldconfig

WORKDIR /app
COPY tools/check_trt_runtime.py /app/tools/check_trt_runtime.py
# Non-persistent stub path for import/CDLL only — not ENV, not ldconfig.
# ldd may still report libcuda.so.1 "not found"; check_trt_runtime allows that.
RUN LD_LIBRARY_PATH="/opt/cuda-stubs:/usr/local/cuda/lib64/stubs:/usr/local/cuda/compat:${LD_LIBRARY_PATH}" \
    /opt/worker-env/bin/python /app/tools/check_trt_runtime.py

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
