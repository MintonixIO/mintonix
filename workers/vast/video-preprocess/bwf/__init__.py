"""BWF path: annotation → config → court-only detect keep-ranges.

Public API only. Detection (cv2) lives in bwf.detect and is imported lazily
so non-BWF jobs never load those deps.
"""

from __future__ import annotations

import logging

from bwf.annotation import (
    annotation_to_valid_frames_config,
    apply_valid_frames_defaults,
)
from normalize import delivery_fps

log = logging.getLogger("video-preprocess.bwf")

__all__ = [
    "config_from_annotation",
    "apply_defaults",
    "detect_ranges",
]


def config_from_annotation(annotation: dict, roster: dict | None = None) -> dict | None:
    """Map thin annotation.json (+ optional roster) → valid_frames_config."""
    return annotation_to_valid_frames_config(annotation, roster=roster)


def apply_defaults(config: dict, width: int, height: int) -> dict:
    """Fill missing tunables after probe (court-only; no scoreboard)."""
    return apply_valid_frames_defaults(config, width, height)


def detect_ranges(
    video_path: str,
    config: dict,
    *,
    fps: float,
    width: int,
    height: int,
    out_fps: float | None = None,
) -> dict:
    """Run court-only detect; return ranges + frame_map for metadata.

    Returns:
      {
        "ranges": [(old_start, old_end), …],  # inclusive source frames
        "source_frame_count": int,
        "kept_frames": int,
        "frame_map": [
          {"old_start", "old_end", "new_start", "new_end"}, …  # inclusive
        ],
        "detect_timings": {…},  # sub-stage seconds
      }
    """
    from bwf import detect as _detect  # lazy: cv2

    log.info(
        "bwf.detect: %s fps=%.3f %dx%d (court-only)",
        video_path, fps, width, height,
    )
    ranges, n_src, detect_timings = _detect.detect_valid_ranges(
        video_path, config, fps=fps, width=width, height=height,
    )
    if out_fps is None:
        out_fps = delivery_fps(fps)
    frame_map = _detect.build_range_manifest(
        ranges, src_fps=fps, out_fps=out_fps,
    )
    kept = sum(e - s + 1 for s, e in ranges)
    log.info(
        "bwf.detect(done): %d ranges, %d src frames, %d kept",
        len(ranges), n_src, kept,
    )
    return {
        "ranges": ranges,
        "source_frame_count": n_src,
        "kept_frames": kept,
        "frame_map": frame_map,
        "detect_timings": detect_timings,
        "src_fps": fps,
        "out_fps": out_fps,
    }
