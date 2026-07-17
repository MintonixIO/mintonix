# pose/ — YOLO26x-pose TensorRT engine

Product pose inference used by `detect.PoseEstimator` → `detections.json`.

## Layout

| File | Role |
|---|---|
| `engine.py` | `PoseEngine`: letterbox batch → TRT → pixel detections |
| `letterbox.py` | 640 letterbox / unletterbox geometry (`IMGSZ`) |
| `trt_runtime.py` | `load_engine`, `GpuConsumer` (CUDA graphs) |
| `export_trt.py` / `download_model.py` | Manual engine build on target GPU |

## Engine build

TensorRT engines are **GPU-arch and TRT-version specific**. The product image is
`nvcr.io/nvidia/tensorrt:24.04-py3` (TRT 10 / CUDA 12.x). Build on a matching
host:

```bash
python pose/download_model.py
python pose/export_trt.py   # writes models/yolo26x_pose_int8.engine
```

Mount or copy the engine to `/app/models/yolo26x_pose_int8.engine`
(`POSE_ENGINE` env).

## Product usage

```python
from pose import PoseEngine

engine = PoseEngine("/app/models/yolo26x_pose_int8.engine")
dets = engine.run_batch(frames_bgr)  # len == engine.batch_size
```

Job orchestration, shuttle, and ReID live in `detect/` — not here.
