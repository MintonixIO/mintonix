"""Build detections.json ``segments[]`` from preprocess islands + OCR scores.

Preprocess court-visible islands are the ranges encoded into ``normalized.mp4``.
They appear in ``preprocess-log.json`` as ``frame_shifts[]`` with
``new_start`` / ``new_end`` on the **normalized** timeline (0-based, inclusive).

Engine groups consecutive segments with the same ``(t1, t2)`` into rallies —
detect only emits islands + scores.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence


def islands_from_frame_shifts(
    frame_shifts: Sequence[Mapping[str, Any]] | None,
) -> list[tuple[int, int]]:
    """Return sorted unique ``(start_frame, end_frame)`` inclusive ranges.

    Ignores malformed entries. Empty / missing input → ``[]`` (caller supplies
    a full-video fallback).
    """
    if not frame_shifts:
        return []
    out: list[tuple[int, int]] = []
    for raw in frame_shifts:
        if not isinstance(raw, Mapping):
            continue
        try:
            start = int(raw["new_start"])
            end = int(raw["new_end"])
        except (KeyError, TypeError, ValueError):
            continue
        if start < 0 or end < start:
            continue
        out.append((start, end))
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def fallback_island(frame_count: int) -> list[tuple[int, int]]:
    """Single island covering the full normalized video when shifts are absent."""
    if frame_count <= 0:
        return []
    return [(0, frame_count - 1)]


def build_segments(
    islands: Sequence[tuple[int, int]],
    scores: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Zip islands with OCR score dicts into Engine ``segments[]`` entries.

    Each score mapping should provide ``t1``, ``t2``, and optionally
    ``score_conf`` (or ``conf``). Missing conf is omitted (optional field).
    """
    if len(scores) != len(islands):
        raise ValueError(
            f"scores length {len(scores)} != islands length {len(islands)}"
        )
    segments: list[dict[str, Any]] = []
    for (start, end), sc in zip(islands, scores):
        t1 = max(0, int(sc.get("t1", 0)))
        t2 = max(0, int(sc.get("t2", 0)))
        entry: dict[str, Any] = {
            "start_frame": int(start),
            "end_frame": int(end),
            "score": {"t1": t1, "t2": t2},
        }
        conf = sc.get("score_conf", sc.get("conf"))
        if conf is not None:
            try:
                c = float(conf)
            except (TypeError, ValueError):
                c = 0.0
            entry["score_conf"] = max(0.0, min(1.0, c))
        segments.append(entry)
    return segments


def representative_frame(start: int, end: int) -> int:
    """Frame index to OCR for an island (midpoint, inclusive range)."""
    if end < start:
        return max(0, start)
    return start + (end - start) // 2


def clamp_segments_to_frame_count(
    segments: Iterable[Mapping[str, Any]],
    frame_count: int,
) -> list[dict[str, Any]]:
    """Drop/clamp segments that fall outside the decoded frame range."""
    if frame_count <= 0:
        return []
    last = frame_count - 1
    out: list[dict[str, Any]] = []
    for seg in segments:
        try:
            start = int(seg["start_frame"])
            end = int(seg["end_frame"])
        except (KeyError, TypeError, ValueError):
            continue
        if start > last:
            continue
        end = min(end, last)
        start = max(0, start)
        if end < start:
            continue
        entry = dict(seg)
        entry["start_frame"] = start
        entry["end_frame"] = end
        out.append(entry)
    return out
