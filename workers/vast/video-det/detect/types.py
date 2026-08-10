from dataclasses import dataclass
from typing import Optional


@dataclass
class Keypoint:
    x: float  # normalized [0, 1]
    y: float
    conf: float


@dataclass
class PoseResult:
    keypoints: list[Keypoint]  # 17 COCO keypoints
    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2 normalized
    conf: float
    # Always null in product path (ReID removed until jobs ships masks).
    player_id: Optional[int] = None


@dataclass
class ShuttleCandidate:
    """One heatmap peak in **source-frame** normalized UV [0, 1].

    TrackNet preprocesses with anisotropic stretch to 512×288. Peak indices
    are converted with ``(px+0.5)/net_w`` which equals source-frame UV under
    pure stretch. Same product space as pose keypoints.
    """

    x: float  # source-frame [0, 1]
    y: float
    conf: float


@dataclass
class FrameResult:
    frame: int
    poses: list[PoseResult]
    # Top-K shuttle peaks for this frame, highest conf first.
    shuttle: list[ShuttleCandidate]

    def to_dict(self) -> dict:
        return {
            "frame": self.frame,
            "poses": [
                {
                    "keypoints": [[kp.x, kp.y, kp.conf] for kp in p.keypoints],
                    "bbox": list(p.bbox),
                    "conf": p.conf,
                    "player_id": p.player_id,
                }
                for p in self.poses
            ],
            "shuttle": [{"x": c.x, "y": c.y, "conf": c.conf} for c in self.shuttle],
        }
