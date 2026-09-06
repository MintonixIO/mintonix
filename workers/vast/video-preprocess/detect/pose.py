"""Product pose adapter: engine detections → normalized PoseResult.

Does not own TRT loading, letterbox math, or NMS — that is the pose package.
"""
from __future__ import annotations

from pose.engine import EngineDetection

from .types import Keypoint, PoseResult


def to_pose_result(det: EngineDetection, width: int, height: int) -> PoseResult:
    """Convert an engine detection (original pixels) to normalized PoseResult."""
    w = max(float(width), 1.0)
    h = max(float(height), 1.0)
    x1, y1, x2, y2 = det.bbox
    keypoints = [
        Keypoint(
            x=float(det.keypoints[k, 0] / w),
            y=float(det.keypoints[k, 1] / h),
            conf=float(det.keypoints[k, 2]),
        )
        for k in range(det.keypoints.shape[0])
    ]
    return PoseResult(
        keypoints=keypoints,
        bbox=(x1 / w, y1 / h, x2 / w, y2 / h),
        conf=det.conf,
    )
