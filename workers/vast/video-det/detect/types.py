import math
from dataclasses import dataclass
from typing import Optional


def json_float(value: object, default: float = 0.0) -> float:
    """Finite float for JSON (NaN/Inf → default). ``json.dumps`` emits invalid NaN."""
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


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
            "frame": int(self.frame),
            "poses": [
                {
                    "keypoints": [
                        [json_float(kp.x), json_float(kp.y), json_float(kp.conf)]
                        for kp in p.keypoints
                    ],
                    "bbox": [json_float(v) for v in p.bbox],
                    "conf": json_float(p.conf),
                    "player_id": p.player_id,
                }
                for p in self.poses
            ],
            "shuttle": [
                {
                    "x": json_float(c.x),
                    "y": json_float(c.y),
                    "conf": json_float(c.conf),
                }
                for c in self.shuttle
            ],
        }
