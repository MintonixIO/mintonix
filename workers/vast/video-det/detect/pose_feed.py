"""Pose feed adapters for VideoDetector.

Two feeds produce the same contract:

    (by_frame: dict[int, list[EngineDetection]], meta: dict)

- **opencv** — product default: OpenCV decode + `pose.PoseEngine` batch infer.
- **ffmpeg** — multi-ffmpeg SHM research path (`pose.ffmpeg_feed` or legacy
  `pose.research_pipeline`).

Engine batch size is always taken from the loaded engine (never a hard-coded
POSE_BATCH authority).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

log = logging.getLogger("video-det.pose_feed")


def run_opencv_pose(
    video_path: str | Path,
    engine_path: str | Path,
    *,
    conf: float,
    batch_size: int | None = None,
) -> tuple[dict[int, list], dict[str, Any]]:
    """Decode with OpenCV and run pose via PoseEngine.

    Returns detections in original pixels, keyed by frame index.
    `meta` includes `orig_hw` [H, W], `batch`, and timing.
    """
    from pose.engine import EngineDetection, PoseEngine

    engine = PoseEngine(engine_path, conf=conf, batch_size=batch_size)
    bs = engine.batch_size
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {video_path}")

    by_frame: dict[int, list[EngineDetection]] = {}
    buf: list[np.ndarray] = []
    global_idx = 0
    orig_hw: tuple[int, int] | None = None
    t0 = time.perf_counter()

    def _flush_full() -> None:
        nonlocal buf
        if len(buf) != bs:
            return
        base = global_idx - bs
        for j, dets in enumerate(engine.run_batch(buf)):
            by_frame[base + j] = dets
        buf = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if orig_hw is None:
            h, w = frame.shape[:2]
            orig_hw = (h, w)
        buf.append(frame)
        global_idx += 1
        if len(buf) == bs:
            _flush_full()

    # Tail: pad last frame to a full engine batch, keep only real frames.
    if buf:
        n = len(buf)
        last = buf[-1]
        padded = buf + [last] * (bs - n)
        base = global_idx - n
        for j, dets in enumerate(engine.run_batch(padded)[:n]):
            by_frame[base + j] = dets
        buf = []

    cap.release()
    elapsed = time.perf_counter() - t0
    frames_processed = global_idx
    thr = frames_processed / elapsed if elapsed > 0 else 0.0
    meta: dict[str, Any] = {
        "orig_hw": list(orig_hw) if orig_hw is not None else [0, 0],
        "frames_processed": frames_processed,
        "batch": bs,
        "elapsed_s": round(elapsed, 2),
        "throughput_img_s": round(thr, 1),
        "feed": "opencv",
    }
    log.info(
        "opencv pose done: frames=%d batch=%d thr=%.0f img/s elapsed=%.1fs",
        frames_processed,
        bs,
        thr,
        elapsed,
    )
    return by_frame, meta


def run_ffmpeg_pose(
    video_path: str | Path,
    engine_path: str | Path,
    *,
    conf: float,
    ceiling: float | None = None,
    workers: int | None = None,
    imgsz: int | None = None,
) -> tuple[dict[int, list], dict[str, Any]]:
    """Multi-ffmpeg pose feed.

    Prefers `pose.ffmpeg_feed.run_ffmpeg_pose` (rename landing); falls back to
    `pose.research_pipeline.run_research_pose`.
    """
    run = _import_ffmpeg_runner()
    kwargs: dict[str, Any] = {"conf": conf}
    if ceiling is not None:
        kwargs["ceiling"] = ceiling
    if workers is not None:
        kwargs["workers"] = workers
    # imgsz is accepted by the target API; pass only when set so older runners
    # that lack the parameter still work if they use ** or omit it.
    if imgsz is not None:
        try:
            by_frame, meta = run(
                video_path, engine_path, imgsz=imgsz, **kwargs
            )
        except TypeError:
            by_frame, meta = run(video_path, engine_path, **kwargs)
    else:
        by_frame, meta = run(video_path, engine_path, **kwargs)
    meta = dict(meta)
    meta.setdefault("feed", "ffmpeg")
    return by_frame, meta


def _import_ffmpeg_runner():
    try:
        from pose.ffmpeg_feed import run_ffmpeg_pose as run

        return run
    except ImportError:
        from pose.research_pipeline import run_research_pose as run

        return run
