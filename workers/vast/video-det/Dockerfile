# TensorRT 24.04 base includes CUDA 12.4, cuDNN 9, TensorRT 10, Python 3.10
# Product engines (POSE_ENGINE) must be built against this TRT stack / GPU arch.
FROM nvcr.io/nvidia/tensorrt:24.04-py3

WORKDIR /app

# PyTorch must be installed separately; pin to a CUDA 12.1-compatible wheel
RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 \
    --index-url https://download.pytorch.org/whl/cu121

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

RUN mkdir -p /app/models

# vast's start_server.sh launches the PyWorker via `python -m worker` from
# SERVER_DIR ($WORKSPACE_DIR/vast-pyworker). Pre-place worker.py there so the
# script skips its git clone.
RUN mkdir -p /workspace/vast-pyworker \
    && cp worker.py /workspace/vast-pyworker/worker.py \
    && printf '# worker.py needs only vastai, installed by start_server.sh\n' \
       > /workspace/vast-pyworker/requirements.txt

ENV MODEL_SERVER_PORT=18000 \
    MODEL_LOG=/var/log/portal/video-det.log \
    WORKSPACE_DIR=/workspace \
    WORKER_PORT=3000 \
    BENCHMARK_INPUT_URL=file:///app/sample.mp4 \
    POSE_ENGINE=/app/models/yolo26x_pose_int8.engine \
    SHUTTLE_CKPT=/app/models/tracknetv5.pt \
    REID_ENGINE=/app/models/osnet_reid_int8.engine

# Models are mounted or downloaded at container start (not always baked in).
EXPOSE 3000

CMD ["bash", "entrypoint.sh"]
