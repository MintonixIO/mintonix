"""Product pose adapter.

Wraps `pose.PoseEngine` and converts original-pixel detections into the
normalized `PoseResult` types used in detections.json. Does not own TRT
loading, letterbox math, or NMS/export format — that is the pose package.
"""
from __future__ import annotations

from pathlib import Path

from pose import DEFAULT_CONF, PoseEngine
from pose.engine import EngineDetection

from .types import Keypoint, PoseResult


class PoseEstimator:
    """Job-facing pose API used by OpenCV pose feed / VideoDetector.

    Coordinates in returned `PoseResult`s are normalized to the source frame
    (x / width, y / height) after letterboxed inference — not stretch-resize.

    `batch_size` defaults to None so the loaded engine is the authority
    (do not hard-code POSE_BATCH=16).
    """

    def __init__(
        self,
        engine_path: str | Path,
        *,
        conf: float = DEFAULT_CONF,
        batch_size: int | None = None,
    ) -> None:
        # PoseEngine validates batch_size against the serialized engine when set.
        self._engine = PoseEngine(engine_path, conf=conf, batch_size=batch_size)
        self.batch_size = self._engine.batch_size
        self.conf = conf

    def run_batch(self, frames: list) -> list[list[PoseResult]]:
        """frames: list of BGR uint8 arrays, length == batch_size."""
        engine_out = self._engine.run_batch(frames)
        results: list[list[PoseResult]] = []
        for frame, dets in zip(frames, engine_out):
            h, w = frame.shape[:2]
            results.append([to_pose_result(d, w, h) for d in dets])
        return results


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
