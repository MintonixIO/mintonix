"""Detect job configuration (env → frozen dataclass).

Single product path: OpenCV decode + PoseEngine + ShuttleDetector.
`pose/` owns TRT/batch geometry after load; this module only maps env knobs
into a typed config for `VideoDetector`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_conf() -> float:
    # Import carefully: pose.engine is light (no CUDA at import).
    try:
        from pose.engine import DEFAULT_CONF

        return float(DEFAULT_CONF)
    except Exception:  # noqa: BLE001 — CI / partial installs
        return 0.15


@dataclass(frozen=True)
class DetectConfig:
    pose_engine: Path
    shuttle_ckpt: Path
    reid_engine: Path | None
    conf: float

    @classmethod
    def from_env(cls) -> DetectConfig:
        pose_engine = Path(
            os.environ.get("POSE_ENGINE", "/app/models/yolo26x_pose_int8.engine")
        )
        shuttle_ckpt = Path(
            os.environ.get("SHUTTLE_CKPT", "/app/models/tracknetv5.pt")
        )
        reid_raw = os.environ.get("REID_ENGINE", "/app/models/osnet_reid_int8.engine")
        reid_path = Path(reid_raw) if reid_raw else None
        reid_engine = (
            reid_path if reid_path is not None and reid_path.is_file() else None
        )

        conf_env = os.environ.get("POSE_CONF")
        conf = float(conf_env) if conf_env is not None else _default_conf()

        return cls(
            pose_engine=pose_engine,
            shuttle_ckpt=shuttle_ckpt,
            reid_engine=reid_engine,
            conf=conf,
        )
