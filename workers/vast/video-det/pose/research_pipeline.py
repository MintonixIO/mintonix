"""Backward-compatible import surface for the multi-ffmpeg pose feed.

Prefer `pose.ffmpeg_feed` for new code. This module re-exports the public API
so existing `from pose.research_pipeline import run_research_pose` keeps working.
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
