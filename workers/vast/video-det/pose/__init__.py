"""Pose engine package for the video-det product worker.

Owns YOLO26x-pose TensorRT inference, letterbox geometry, CUDA-graph consumer,
and engine export helpers. Job I/O, shuttle, and ReID live in `detect/` +
`server.py` and should import pose only through this package.
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
# ffmpeg_feed / decode_pool are optional heavy imports (ffmpeg + mp);
# use `from pose.ffmpeg_feed import run_ffmpeg_pose` (or research_pipeline alias).
