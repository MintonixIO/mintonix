"""Write Engine-facing ``detections.json`` (segments + frames + video meta)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import cv2
import numpy as np

from .scoreboard import (
    ocr_score_from_frame,
    parse_preprocess_log,
    scoreboard_geometry,
)
from .segments import (
    build_segments,
    clamp_segments_to_frame_count,
    fallback_island,
    islands_from_frame_shifts,
    rallies_from_segments,
    representative_frame,
)
from .types import FrameResult, json_float

log = logging.getLogger("video-det.output")


def probe_video(path: Path) -> dict[str, Any]:
    """OpenCV probe for fps / width / height / frame_count hint."""
    meta: dict[str, Any] = {
        "fps": 0.0,
        "width": 0,
        "height": 0,
        "frame_count_hint": 0,
    }
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return meta
    try:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if w <= 0 or h <= 0:
            ok, frame = cap.read()
            if ok and frame is not None and frame.size:
                h, w = int(frame.shape[0]), int(frame.shape[1])
        meta["width"] = max(0, w)
        meta["height"] = max(0, h)
        meta["fps"] = float(fps) if fps > 0 else 0.0
        meta["frame_count_hint"] = max(0, n)
    finally:
        cap.release()
    return meta


def read_frame(path: Path, index: int) -> np.ndarray | None:
    """Seek and read one BGR frame; None on failure."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    try:
        if index > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, float(index))
        ok, frame = cap.read()
        if not ok or frame is None:
            return None
        return frame
    finally:
        cap.release()


def build_segments_for_video(
    *,
    video_path: Path,
    annotation: Mapping[str, Any] | None,
    preprocess_log: Mapping[str, Any] | None,
    frame_count_hint: int = 0,
) -> list[dict[str, Any]]:
    """Islands from preprocess-log + per-island scoreboard OCR."""
    shifts = parse_preprocess_log(preprocess_log)
    islands = islands_from_frame_shifts(shifts)
    if not islands:
        islands = fallback_island(frame_count_hint)

    geom = scoreboard_geometry(annotation)
    scores: list[dict[str, Any]] = []
    for start, end in islands:
        idx = representative_frame(start, end)
        frame = read_frame(video_path, idx)
        sc = ocr_score_from_frame(frame, geom) if frame is not None else {
            "t1": 0,
            "t2": 0,
            "score_conf": 0.0,
        }
        if frame is None:
            log.warning(
                "scoreboard OCR: could not read frame %d for island %d-%d",
                idx,
                start,
                end,
            )
        elif geom is None:
            log.warning(
                "scoreboard OCR: no scoreboard_crop in annotation; "
                "island %d-%d conf=0",
                start,
                end,
            )
        scores.append(sc)

    if not islands:
        # Still must emit non-empty segments if we later decode frames —
        # caller may re-build with real frame_count after detect.
        return []

    return build_segments(islands, scores)


def ensure_segments(
    segments: Sequence[Mapping[str, Any]],
    frame_count: int,
) -> list[dict[str, Any]]:
    """Guarantee non-empty segments covering decoded frames when possible."""
    clamped = clamp_segments_to_frame_count(segments, frame_count)
    if clamped:
        return clamped
    islands = fallback_island(frame_count)
    if not islands:
        return []
    scores = [{"t1": 0, "t2": 0, "score_conf": 0.0} for _ in islands]
    return build_segments(islands, scores)


def write_detections_json(
    dest: Path,
    *,
    request_id: str | None,
    video_path: Path,
    frame_chunks: Iterable[Sequence[FrameResult]],
    segments: Sequence[Mapping[str, Any]],
    fps: float,
    width: int,
    height: int,
) -> int:
    """Stream-write Engine ``detections.json``. Returns frame count.

    Required top-level fields: ``job_id``, ``fps``, ``width``, ``height``,
    ``segments``, ``rallies``, ``frames``. Frames are written incrementally so
    long matches stay memory-bounded. Segments are finalized after the stream
    so ``end_frame`` can clamp to the true last decoded index. Rallies group
    same-score islands with at most one island between them.
    """
    # Buffer frame dicts only as JSON lines on a side file, then assemble —
    # avoids holding all FrameResult objects while still knowing frame_count
    # before writing segments.
    side = dest.with_suffix(dest.suffix + ".frames.partial")
    frame_count = 0
    first = True
    try:
        with side.open("w", encoding="utf-8") as pf:
            for chunk in frame_chunks:
                for fr in chunk:
                    if not first:
                        pf.write(",")
                    pf.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                    first = False
                    frame_count += 1

        final_segments = ensure_segments(segments, frame_count)
        if frame_count > 0 and not final_segments:
            # Defensive: should not happen if ensure_segments works.
            final_segments = build_segments(
                fallback_island(frame_count),
                [{"t1": 0, "t2": 0, "score_conf": 0.0}],
            )
        if frame_count > 0 and not final_segments:
            raise RuntimeError("detections.json requires non-empty segments")
        final_rallies = rallies_from_segments(final_segments)
        if frame_count > 0 and not final_rallies:
            raise RuntimeError("detections.json requires non-empty rallies")

        out_fps = json_float(fps)
        if out_fps <= 0 and frame_count > 0:
            # Last resort so Engine gets a number; 30 is common delivery default.
            out_fps = 30.0
            log.warning("video fps missing; defaulting detections.fps=30")
        out_w = max(0, int(width))
        out_h = max(0, int(height))
        if frame_count > 0 and (out_w <= 0 or out_h <= 0):
            probed = probe_video(video_path)
            out_w = max(out_w, int(probed.get("width") or 0))
            out_h = max(out_h, int(probed.get("height") or 0))
            if out_w <= 0 or out_h <= 0:
                log.warning(
                    "video width/height missing after probe; writing %dx%d",
                    out_w,
                    out_h,
                )

        with dest.open("w", encoding="utf-8") as f:
            f.write("{")
            f.write('"job_id":')
            f.write(json.dumps(request_id))
            f.write(',"fps":')
            f.write(json.dumps(out_fps))
            f.write(',"width":')
            f.write(json.dumps(out_w))
            f.write(',"height":')
            f.write(json.dumps(out_h))
            f.write(',"segments":')
            f.write(json.dumps(final_segments, separators=(",", ":")))
            f.write(',"rallies":')
            f.write(json.dumps(final_rallies, separators=(",", ":")))
            f.write(',"frames":[')
            if frame_count > 0:
                with side.open("r", encoding="utf-8") as pf:
                    while True:
                        buf = pf.read(1024 * 1024)
                        if not buf:
                            break
                        f.write(buf)
            f.write("]}")
        return frame_count
    finally:
        side.unlink(missing_ok=True)
