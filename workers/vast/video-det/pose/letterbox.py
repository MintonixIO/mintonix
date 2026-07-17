"""Letterbox geometry for yolo26x-pose.

Matches Ultralytics letterbox:
  scale=imgsz:imgsz:force_original_aspect_ratio=decrease,
  pad=imgsz:imgsz:(ow-iw)/2:(oh-ih)/2

Module `IMGSZ` is the default (env `POSE_IMGSZ`, else 640). Runtime paths that
know the engine input shape should pass `imgsz` explicitly rather than relying
only on import-time env.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np

# Default spatial size; override with POSE_IMGSZ for non-640 engines (e.g. 960).
# Prefer passing imgsz from the TRT engine shape at call sites.
IMGSZ = int(os.environ.get("POSE_IMGSZ", "640"))


@dataclass(frozen=True)
class LetterboxMeta:
    """Maps between original-frame pixels and letterbox space."""

    orig_h: int
    orig_w: int
    scale: float
    pad_x: float
    pad_y: float
    imgsz: int = IMGSZ


def letterbox_params(orig_h: int, orig_w: int, imgsz: int = IMGSZ) -> LetterboxMeta:
    """Compute letterbox scale/pad for an original frame size.

    `imgsz` defaults to module `IMGSZ` (env `POSE_IMGSZ`) but callers that know
    the engine spatial size should pass it explicitly.
    """
    scale = min(imgsz / orig_w, imgsz / orig_h)
    pad_x = (imgsz - orig_w * scale) / 2.0
    pad_y = (imgsz - orig_h * scale) / 2.0
    return LetterboxMeta(
        orig_h=orig_h,
        orig_w=orig_w,
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
        imgsz=imgsz,
    )


def letterbox_bgr(frame_bgr: np.ndarray, imgsz: int = IMGSZ) -> tuple[np.ndarray, LetterboxMeta]:
    """Return (rgb_uint8 HxWx3 letterboxed, meta) for a BGR OpenCV frame."""
    h, w = frame_bgr.shape[:2]
    meta = letterbox_params(h, w, imgsz)
    nw = max(1, int(round(w * meta.scale)))
    nh = max(1, int(round(h * meta.scale)))
    resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
    x0 = int(round(meta.pad_x))
    y0 = int(round(meta.pad_y))
    canvas[y0 : y0 + nh, x0 : x0 + nw] = resized
    # Recompute pads from integer placement so unletterbox matches pixels placed.
    meta = LetterboxMeta(
        orig_h=h,
        orig_w=w,
        scale=meta.scale,
        pad_x=float(x0),
        pad_y=float(y0),
        imgsz=imgsz,
    )
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    return rgb, meta


def unletterbox_xy(x: np.ndarray, y: np.ndarray, meta: LetterboxMeta) -> tuple[np.ndarray, np.ndarray]:
    """Map letterbox-space coordinates to original-frame pixels."""
    return (x - meta.pad_x) / meta.scale, (y - meta.pad_y) / meta.scale
