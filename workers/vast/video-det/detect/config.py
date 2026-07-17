"""Detect job configuration (env → frozen dataclass).

`pose/` owns TRT/batch geometry after load; this module only maps env knobs
into a typed config for `VideoDetector`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


def _default_conf() -> float:
    # Import carefully: pose.engine is light (no CUDA at import).
    try:
        from pose.engine import DEFAULT_CONF

        return float(DEFAULT_CONF)
    except Exception:  # noqa: BLE001 — CI / partial installs
        return 0.15


def _parse_pose_feed(raw: str | None, legacy_pipeline: str | None) -> Literal["opencv", "ffmpeg"]:
    """Map POSE_FEED (preferred) or legacy POSE_PIPELINE to a feed name.

    Defaults to **opencv** for product safety. FFmpeg multi-decode is available
    via POSE_FEED=ffmpeg (legacy: POSE_PIPELINE=research).
    """
    if raw:
        v = raw.strip().lower()
        if v in ("opencv", "serial"):
            return "opencv"
        if v in ("ffmpeg", "research"):
            return "ffmpeg"
        raise ValueError(
            f"POSE_FEED must be 'opencv' or 'ffmpeg' (got {raw!r}); "
            "legacy aliases: serial→opencv, research→ffmpeg"
        )
    if legacy_pipeline:
        v = legacy_pipeline.strip().lower()
        if v == "serial":
            return "opencv"
        if v == "research":
            return "ffmpeg"
        # Unknown legacy values fall through to product default
    return "opencv"


@dataclass(frozen=True)
class DetectConfig:
    pose_engine: Path
    shuttle_ckpt: Path
    reid_engine: Path | None
    pose_feed: Literal["opencv", "ffmpeg"]  # not "research"/"serial"
    conf: float
    # Optional overrides; engine is source of truth when loaded
    imgsz: int | None = None
    decode_workers: int | None = None
    pose_ceiling: float | None = None

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
        reid_engine = reid_path if reid_path is not None and reid_path.is_file() else None

        pose_feed = _parse_pose_feed(
            os.environ.get("POSE_FEED"),
            os.environ.get("POSE_PIPELINE"),
        )

        conf_env = os.environ.get("POSE_CONF")
        conf = float(conf_env) if conf_env is not None else _default_conf()

        imgsz_env = os.environ.get("POSE_IMGSZ")
        imgsz = int(imgsz_env) if imgsz_env else None

        workers_env = os.environ.get("POSE_DECODE_WORKERS")
        decode_workers = int(workers_env) if workers_env else None

        ceiling_env = os.environ.get("POSE_CEILING")
        pose_ceiling = float(ceiling_env) if ceiling_env else None

        return cls(
            pose_engine=pose_engine,
            shuttle_ckpt=shuttle_ckpt,
            reid_engine=reid_engine,
            pose_feed=pose_feed,
            conf=conf,
            imgsz=imgsz,
            decode_workers=decode_workers,
            pose_ceiling=pose_ceiling,
        )
