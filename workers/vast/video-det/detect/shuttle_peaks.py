"""Heatmap → top-K shuttle candidates (no torch / model deps)."""
from __future__ import annotations

import numpy as np

from .types import ShuttleCandidate

# Recall-first defaults. Raise min_conf / lower top_k only if payload is too fat.
TOP_K = 8
MIN_CONF = 0.05          # keep almost everything the heatmap lights up
NMS_RADIUS = 3           # heatmap pixels; collapse a single blob into one peak


def top_candidates(
    heatmap: np.ndarray,
    *,
    top_k: int = TOP_K,
    min_conf: float = MIN_CONF,
    nms_radius: int = NMS_RADIUS,
) -> list[ShuttleCandidate]:
    """Greedy top-K peaks with local NMS. Sorted by conf descending.

    Designed for high recall: a low floor + multiple spatial peaks so the true
    shuttle is almost always among the candidates (analyze picks later).
    """
    hm = np.asarray(heatmap, dtype=np.float32).copy()
    h, w = hm.shape
    out: list[ShuttleCandidate] = []
    for _ in range(top_k):
        conf = float(hm.max())
        if conf < min_conf:
            break
        peak = int(hm.argmax())
        py, px = divmod(peak, w)
        out.append(
            ShuttleCandidate(
                x=(px + 0.5) / w,
                y=(py + 0.5) / h,
                conf=conf,
            )
        )
        y0, y1 = max(0, py - nms_radius), min(h, py + nms_radius + 1)
        x0, x1 = max(0, px - nms_radius), min(w, px + nms_radius + 1)
        hm[y0:y1, x0:x1] = 0.0
    return out
