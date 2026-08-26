"""Detect job configuration (env → frozen dataclass).

Product path: OpenCV decode + PoseEngine (TRT) + ShuttleDetector (TRT).
Both engines are required; there is no PyTorch / ``.pt`` fallback.
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
    pose_engine: Path  # TensorRT .engine only
    shuttle_engine: Path  # TensorRT .engine only
    conf: float

    @classmethod
    def from_env(cls) -> DetectConfig:
        pose_engine = Path(
            os.environ.get("POSE_ENGINE", "/app/models/yolo26x-pose.engine")
        )
        shuttle_engine = Path(
            os.environ.get(
                "SHUTTLE_ENGINE", "/app/models/tracknetv5_fp16_b48.engine"
            )
        )
        conf_env = os.environ.get("POSE_CONF")
        conf = float(conf_env) if conf_env is not None else _default_conf()

        return cls(
            pose_engine=pose_engine,
            shuttle_engine=shuttle_engine,
            conf=conf,
        )
