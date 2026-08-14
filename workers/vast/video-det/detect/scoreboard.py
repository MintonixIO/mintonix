"""Scoreboard crop geometry + lightweight digit OCR for detect segments.

Annotation shape (optional fields under ``court``)::

    scoreboard_crop: {x, y, w, h}   # pixels in source/annotation frame space
    score_sub_crop:  {x, y, w, h}   # optional tighter score digits crop
    row_split_y: int                # absolute y or relative to crop top

OCR is **best-effort**. Prefer low ``score_conf`` over inventing confident
digits when the crop is missing or unreadable. Required ints still ship as
``t1``/``t2`` (0 when unknown) so Engine can group segments.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Mapping

import cv2
import numpy as np

log = logging.getLogger("video-det.scoreboard")

# Generated templates for digits 0–9 (OpenCV Hershey font).
_DIGIT_TEMPLATES: dict[str, np.ndarray] | None = None
_TEMPLATE_H = 40
_TEMPLATE_W = 28


def _digit_templates() -> dict[str, np.ndarray]:
    global _DIGIT_TEMPLATES
    if _DIGIT_TEMPLATES is not None:
        return _DIGIT_TEMPLATES
    fonts = (
        cv2.FONT_HERSHEY_SIMPLEX,
        cv2.FONT_HERSHEY_DUPLEX,
        cv2.FONT_HERSHEY_PLAIN,
    )
    templates: dict[str, np.ndarray] = {}
    for d in "0123456789":
        best = None
        for font in fonts:
            img = np.zeros((_TEMPLATE_H, _TEMPLATE_W), dtype=np.uint8)
            # Center-ish glyph.
            cv2.putText(
                img,
                d,
                (4, _TEMPLATE_H - 8),
                font,
                1.2 if font != cv2.FONT_HERSHEY_PLAIN else 2.0,
                255,
                2,
                cv2.LINE_AA,
            )
            if best is None or int(img.sum()) > int(best.sum()):
                best = img
        assert best is not None
        templates[d] = best
    _DIGIT_TEMPLATES = templates
    return templates


def parse_crop(raw: Any) -> tuple[int, int, int, int] | None:
    """Parse ``{x,y,w,h}`` to ints; return None if unusable."""
    if not isinstance(raw, Mapping):
        return None
    try:
        x = int(raw["x"])
        y = int(raw["y"])
        w = int(raw["w"])
        h = int(raw["h"])
    except (KeyError, TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    return x, y, w, h


def scoreboard_geometry(annotation: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Extract crop + row split from annotation.json (court block)."""
    if not annotation or not isinstance(annotation, Mapping):
        return None
    court = annotation.get("court")
    if not isinstance(court, Mapping):
        return None
    crop = parse_crop(court.get("score_sub_crop")) or parse_crop(
        court.get("scoreboard_crop")
    )
    if crop is None:
        return None
    x, y, w, h = crop
    row_split: int | None
    raw_split = court.get("row_split_y")
    try:
        row_split = int(raw_split) if raw_split is not None else None
    except (TypeError, ValueError):
        row_split = None
    # row_split_y may be absolute frame y or relative to crop top.
    if row_split is not None:
        if row_split >= y:
            rel = row_split - y
        else:
            rel = row_split
        rel = max(1, min(h - 1, rel))
    else:
        rel = h // 2
    return {"x": x, "y": y, "w": w, "h": h, "row_split_rel": rel}


def _clamp_roi(
    frame: np.ndarray, x: int, y: int, w: int, h: int
) -> np.ndarray | None:
    fh, fw = frame.shape[:2]
    x0 = max(0, min(fw - 1, x))
    y0 = max(0, min(fh - 1, y))
    x1 = max(x0 + 1, min(fw, x + w))
    y1 = max(y0 + 1, min(fh, y + h))
    if x1 <= x0 or y1 <= y0:
        return None
    return frame[y0:y1, x0:x1]


def _binarize_row(row_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(row_bgr, cv2.COLOR_BGR2GRAY)
    # Bright overlay digits on dark bar — also invert if needed.
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Prefer white digits on black: if mostly white, invert.
    if float(np.mean(th)) > 127:
        th = 255 - th
    return th


def _extract_digit_rois(binary: np.ndarray) -> list[np.ndarray]:
    """Connected components left→right, filtered as digit-like blobs."""
    h, w = binary.shape[:2]
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    boxes: list[tuple[int, int, int, int]] = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < 12 or bw < 2 or bh < h * 0.25:
            continue
        if bh > h * 0.95 and bw > w * 0.5:
            continue  # full-row bar noise
        if bw > w * 0.45:
            continue
        boxes.append((x, y, bw, bh))
    boxes.sort(key=lambda b: b[0])
    rois: list[np.ndarray] = []
    for x, y, bw, bh in boxes:
        pad = 1
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(w, x + bw + pad)
        y1 = min(h, y + bh + pad)
        rois.append(binary[y0:y1, x0:x1])
    return rois


def _match_digit(roi: np.ndarray) -> tuple[str, float]:
    templates = _digit_templates()
    resized = cv2.resize(roi, (_TEMPLATE_W, _TEMPLATE_H), interpolation=cv2.INTER_AREA)
    _, resized = cv2.threshold(resized, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    best_d, best_s = "0", -1.0
    for d, tmpl in templates.items():
        # Normalized cross-correlation style score via matchTemplate.
        res = cv2.matchTemplate(
            resized.astype(np.float32),
            tmpl.astype(np.float32),
            cv2.TM_CCOEFF_NORMED,
        )
        score = float(res.max()) if res.size else -1.0
        if score > best_s:
            best_s = score
            best_d = d
    return best_d, best_s


def _ocr_row(row_bgr: np.ndarray) -> tuple[int | None, float]:
    if row_bgr.size == 0 or row_bgr.shape[0] < 4 or row_bgr.shape[1] < 4:
        return None, 0.0
    binary = _binarize_row(row_bgr)
    rois = _extract_digit_rois(binary)
    if not rois:
        # Fallback: whole-row as one blob (single-digit scores).
        rois = [binary]
    digits: list[str] = []
    scores: list[float] = []
    for roi in rois[:3]:  # badminton game scores stay small
        d, s = _match_digit(roi)
        if s < 0.35:
            continue
        digits.append(d)
        scores.append(s)
    if not digits:
        return None, 0.0
    try:
        value = int("".join(digits))
    except ValueError:
        return None, 0.0
    # Cap absurd OCR (BWF games rarely need 3+ digits beyond 30).
    if value > 99:
        return None, 0.0
    conf = float(sum(scores) / len(scores))
    return value, conf


def ocr_score_from_frame(
    frame_bgr: np.ndarray,
    geometry: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """OCR ``t1`` (top row) / ``t2`` (bottom row) from one BGR frame.

    Returns ``{"t1", "t2", "score_conf"}``. Unknown digits → 0 with low conf.
    """
    if geometry is None or frame_bgr is None or frame_bgr.size == 0:
        return {"t1": 0, "t2": 0, "score_conf": 0.0}

    x, y, w, h = (
        int(geometry["x"]),
        int(geometry["y"]),
        int(geometry["w"]),
        int(geometry["h"]),
    )
    roi = _clamp_roi(frame_bgr, x, y, w, h)
    if roi is None:
        return {"t1": 0, "t2": 0, "score_conf": 0.0}

    split = int(geometry.get("row_split_rel") or roi.shape[0] // 2)
    split = max(1, min(roi.shape[0] - 1, split))
    top = roi[:split]
    bot = roi[split:]

    t1, c1 = _ocr_row(top)
    t2, c2 = _ocr_row(bot)

    if t1 is None and t2 is None:
        return {"t1": 0, "t2": 0, "score_conf": 0.0}
    if t1 is None:
        t1, c1 = 0, 0.0
    if t2 is None:
        t2, c2 = 0, 0.0

    confs = [c for c in (c1, c2) if c > 0]
    conf = float(sum(confs) / len(confs)) if confs else 0.0
    # Soften if only one side read.
    if c1 <= 0 or c2 <= 0:
        conf = min(conf, 0.35)

    return {"t1": int(t1), "t2": int(t2), "score_conf": round(conf, 4)}


_INT_RE = re.compile(r"(\d{1,2})")


def parse_preprocess_log(raw: Any) -> list[dict[str, Any]]:
    """Extract ``frame_shifts`` list from preprocess-log.json body."""
    if not isinstance(raw, Mapping):
        return []
    shifts = raw.get("frame_shifts")
    if not isinstance(shifts, list):
        return []
    return [s for s in shifts if isinstance(s, Mapping)]
