"""Detect job configuration (env → frozen dataclass).

Product path: OpenCV decode + PoseEngine (TRT) + ShuttleDetector.
Bench path: ``POSE_ENGINE`` may point at a ``.pt`` (Ultralytics PyTorch pose).
`pose/` owns TRT/batch geometry after load; this module only maps env knobs
into a typed config for `VideoDetector`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_conf() -> float:
    try:
        from pose.engine import DEFAULT_CONF

        return float(DEFAULT_CONF)
    except Exception:  # noqa: BLE001 — CI / partial installs
        return 0.15


@dataclass(frozen=True)
class DetectConfig:
    pose_engine: Path  # .engine (product TRT) or .pt (bench torch)
    shuttle_ckpt: Path
    conf: float

    @classmethod
    def from_env(cls) -> DetectConfig:
        pose_engine = Path(
            os.environ.get("POSE_ENGINE", "/app/models/yolo26x-pose.engine")
        )
        shuttle_ckpt = Path(
            os.environ.get("SHUTTLE_CKPT", "/app/models/tracknetv5.pt")
        )
        conf_env = os.environ.get("POSE_CONF")
        conf = float(conf_env) if conf_env is not None else _default_conf()

        return cls(
            pose_engine=pose_engine,
            shuttle_ckpt=shuttle_ckpt,
            conf=conf,
        )
