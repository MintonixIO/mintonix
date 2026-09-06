"""Pose engine package for the video-preprocess product worker.

Owns YOLO26x-pose TensorRT inference, letterbox geometry, CUDA-graph runner,
and engine export helpers. Job I/O and shuttle live in `detect/` + `server.py`
and should import pose only through this package.

Multi-ffmpeg research code lives under `tools/ffmpeg_pose_bench/` (not product).
"""
from .engine import (
    DEFAULT_CONF,
    EngineDetection,
    PoseEngine,
    coerce_ultralytics_pose,
    decode_pose_batch,
    decode_pose_frame,
)
from .letterbox import IMGSZ, LetterboxMeta, letterbox_bgr, letterbox_params

__all__ = [
    "DEFAULT_CONF",
    "EngineDetection",
    "IMGSZ",
    "LetterboxMeta",
    "PoseEngine",
    "coerce_ultralytics_pose",
    "decode_pose_batch",
    "decode_pose_frame",
    "letterbox_bgr",
    "letterbox_params",
]
