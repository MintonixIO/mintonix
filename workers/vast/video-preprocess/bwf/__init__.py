"""BWF path: annotation → court-only detect keep-ranges."""

from __future__ import annotations

import logging
import os

from bwf.annotation import config_from_annotation
from normalize import delivery_fps

log = logging.getLogger("video-preprocess.bwf")

__all__ = [
    "config_from_annotation",
    "detect_ranges",
    "write_manifest_csv",
]


def detect_ranges(
    video_path: str,
    config: dict,
    *,
    fps: float,
    width: int,
    height: int,
    out_fps: float | None = None,
    codec: str | None = None,
) -> dict:
    """Run court-only detect; return ranges + frame_map + optional CSV path helper."""
    from bwf import detect as _detect  # lazy: cv2

    log.info("bwf.detect: %s fps=%.3f %dx%d", video_path, fps, width, height)
    ranges, n_src, detect_timings = _detect.detect_valid_ranges(
        video_path, config, fps=fps, width=width, height=height, codec=codec,
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


def write_manifest_csv(frame_map: list[dict], path: str) -> int:
    """Write frame_ranges.csv; return file size."""
    from bwf.detect import write_range_manifest_csv

    write_range_manifest_csv(frame_map, path)
    return os.path.getsize(path)
