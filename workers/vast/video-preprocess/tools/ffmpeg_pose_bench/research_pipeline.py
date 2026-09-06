"""Backward-compatible import surface for the multi-ffmpeg pose bench.

Research / throughput bench only — not imported by product `detect/` or `server`.
"""
from .ffmpeg_feed import (  # noqa: F401
    CaptureConsumer,
    calibrate_workers,
    effective_cpus,
    probe_single_stream,
    probe_video,
    run_ffmpeg_pose,
    run_research_pose,
)

__all__ = [
    "CaptureConsumer",
    "calibrate_workers",
    "effective_cpus",
    "probe_single_stream",
    "probe_video",
    "run_ffmpeg_pose",
    "run_research_pose",
]
