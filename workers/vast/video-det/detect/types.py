from dataclasses import dataclass
from typing import Optional


@dataclass
class Keypoint:
    x: float    # normalized [0, 1]
    y: float
    conf: float


@dataclass
class PoseResult:
    keypoints: list[Keypoint]                       # 17 COCO keypoints
    bbox: tuple[float, float, float, float]         # x1, y1, x2, y2 normalized
    conf: float


@dataclass
class ShuttleResult:
    x: float        # normalized [0, 1], heatmap peak column
    y: float        # normalized [0, 1], heatmap peak row
    conf: float     # heatmap peak value
    visible: bool


@dataclass
class FrameResult:
    frame: int
    poses: list[PoseResult]
    shuttle: Optional[ShuttleResult]

    def to_dict(self) -> dict:
        return {
            "frame": self.frame,
            "poses": [
                {
                    "keypoints": [[kp.x, kp.y, kp.conf] for kp in p.keypoints],
                    "bbox": list(p.bbox),
                    "conf": p.conf,
                }
                for p in self.poses
            ],
            "shuttle": (
                {
                    "x": self.shuttle.x,
                    "y": self.shuttle.y,
                    "conf": self.shuttle.conf,
                    "visible": self.shuttle.visible,
                }
                if self.shuttle is not None
                else None
            ),
        }
