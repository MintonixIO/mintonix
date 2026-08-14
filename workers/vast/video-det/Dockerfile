# TensorRT 24.04 base includes CUDA 12.4, cuDNN 9, TensorRT 10, Python 3.10
# Product engines must be built against this TRT stack / GPU arch.
# Product path is TRT-only (no PyTorch wheel) to keep cold pulls reliable.
FROM nvcr.io/nvidia/tensorrt:24.04-py3

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Product path only (see .dockerignore).
COPY . .

# Tiny local sample for autoscaler BenchmarkConfig (file:///app/sample.mp4).
# Written with OpenCV so we do not need ffmpeg in the image.
RUN python3 - <<'PY'
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
RUN python3 - <<'PY'
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

# vast's start_server.sh launches the PyWorker via `python -m worker` from
# SERVER_DIR ($WORKSPACE_DIR/vast-pyworker). Pre-place worker.py there so the
# script skips its git clone.
RUN mkdir -p /workspace/vast-pyworker \
    && cp worker.py /workspace/vast-pyworker/worker.py \
    && printf '# worker.py needs only vastai, installed by start_server.sh\n' \
       > /workspace/vast-pyworker/requirements.txt

# ALLOW_FILE_URLS=1 enables local benchmark file:// I/O only.
# Reads: /app (sample.mp4), /tmp, tempfile.gettempdir().
# Writes: /tmp + tempfile only — never /app (see io_util._file_url_write_roots).
# Production job traffic must use https presigned URLs, not file://.
#
# Models are baked under /app/models (B2 → CI → image). Runtime still may
# override paths via env. server.py fails startup if weights are missing
# unless ALLOW_MISSING_MODELS=1 (CI unit tests only).
ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-det.log \
    WORKSPACE_DIR=/workspace \
    WORKER_PORT=3000 \
    BENCHMARK_INPUT_URL=file:///app/sample.mp4 \
    ALLOW_FILE_URLS=1 \
    POSE_ENGINE=/app/models/yolo26x-pose.engine \
    SHUTTLE_ENGINE=/app/models/tracknetv5_fp16_b48.engine \
    SHUTTLE_TRT_BATCH=48 \
    SHUTTLE_MAX_TRIPLETS=48 \
    OVERLAP_DECODE=1 \
    PARALLEL_DETECT=0 \
    POSE_IMGSZ=640

EXPOSE 3000

CMD ["bash", "entrypoint.sh"]
