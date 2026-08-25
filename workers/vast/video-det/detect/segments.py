"""Build detections.json ``segments[]`` from preprocess islands + OCR scores.

Preprocess court-visible islands are the ranges encoded into ``normalized.mp4``.
They appear in ``preprocess-log.json`` as ``frame_shifts[]`` with
``new_start`` / ``new_end`` on the **normalized** timeline (0-based, inclusive).

Engine groups consecutive segments with the same ``(t1, t2)`` into rallies —
detect only emits islands + scores.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

from .types import json_float


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
            entry["score_conf"] = max(0.0, min(1.0, json_float(conf)))
        segments.append(entry)
    return segments


def representative_frame(start: int, end: int) -> int:
    """Frame index to OCR for an island (midpoint, inclusive range)."""
    if end < start:
        return max(0, start)
    return start + (end - start) // 2


# Island index distance: |i-j| < 3 is "less than 2 islands apart" — at most
# one island between them. Same (t1, t2) islands within that window form one
# rally (mid-rally cutaway included in the span). Farther repeats stay split.
MAX_RALLY_ISLAND_GAP = 2


def _segment_score(seg: Mapping[str, Any]) -> tuple[int, int]:
    raw = seg.get("score")
    if isinstance(raw, Mapping):
        try:
            return max(0, int(raw.get("t1", 0))), max(0, int(raw.get("t2", 0)))
        except (TypeError, ValueError):
            return 0, 0
    return 0, 0


def _segment_conf(seg: Mapping[str, Any]) -> float | None:
    raw = seg.get("score_conf", seg.get("conf"))
    if raw is None:
        return None
    try:
        return max(0.0, min(1.0, float(raw)))
    except (TypeError, ValueError):
        return None


def rallies_from_segments(
    segments: Sequence[Mapping[str, Any]],
    *,
    max_gap: int = MAX_RALLY_ISLAND_GAP,
) -> list[dict[str, Any]]:
    """Group islands into rallies by same score within ``max_gap`` index distance.

    ``max_gap=2`` means |i-j| <= 2: adjacent islands, or one island between.
    The rally span is min(start)…max(end) of the component so a single
    intervening cutaway stays one physics run. Same score farther away is a
    new rally (avoids merging an entire 0–0 OCR-failure match into one run
    across distant islands — adjacent 0–0 islands still chain).
    """
    n = len(segments)
    if n == 0:
        return []
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    scores = [_segment_score(s) for s in segments]
    for i in range(n):
        for j in range(i + 1, min(n, i + max_gap + 1)):
            if scores[i] == scores[j]:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    raw: list[dict[str, Any]] = []
    for idxs in groups.values():
        lo, hi = min(idxs), max(idxs)
        # Absorb islands between the grouped same-score members (the cutaway).
        covered = list(range(lo, hi + 1))
        members = [segments[k] for k in covered]
        try:
            start = min(int(m["start_frame"]) for m in members)
            end = max(int(m["end_frame"]) for m in members)
        except (KeyError, TypeError, ValueError):
            continue
        t1, t2 = scores[idxs[0]]
        entry: dict[str, Any] = {
            "start_frame": start,
            "end_frame": end,
            "score": {"t1": t1, "t2": t2},
            "_lo": lo,
            "_hi": hi,
        }
        confs = [
            c
            for c in (_segment_conf(segments[i]) for i in idxs)
            if c is not None
        ]
        if confs:
            entry["score_conf"] = max(confs)
        raw.append(entry)

    # Drop a component fully inside a wider one (cutaway singleton).
    raw.sort(key=lambda r: (r["_lo"], -(r["_hi"] - r["_lo"])))
    kept: list[dict[str, Any]] = []
    for entry in raw:
        if any(entry["_lo"] >= k["_lo"] and entry["_hi"] <= k["_hi"] for k in kept):
            continue
        kept.append(entry)
    rallies: list[dict[str, Any]] = []
    for entry in kept:
        entry.pop("_lo", None)
        entry.pop("_hi", None)
        rallies.append(entry)
    rallies.sort(key=lambda r: (r["start_frame"], r["end_frame"]))
    return rallies


def clamp_segments_to_frame_count(
    segments: Iterable[Mapping[str, Any]],
    frame_count: int,
) -> list[dict[str, Any]]:
    """Clamp ``end_frame`` to the last decoded index; keep island count.

    Shortens ``end_frame`` when it runs past EOF. A well-formed island that
    starts after the last decoded frame raises ``RuntimeError`` so a
    non-empty ``frame_shifts`` list cannot shrink or become a fallback
    island. Malformed entries are skipped. ``frame_count <= 0`` → ``[]``.
    """
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
            raise RuntimeError(
                f"segment start_frame {start} is past last decoded frame {last}"
            )
        end = min(end, last)
        start = max(0, start)
        if end < start:
            raise RuntimeError(
                f"segment {start}-{end} is empty after clamp to last={last}"
            )
        entry = dict(seg)
        entry["start_frame"] = start
        entry["end_frame"] = end
        out.append(entry)
    return out
