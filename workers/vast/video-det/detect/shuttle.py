"""Shuttle detection: TrackNetV5 TRT heatmaps → top-K candidates per frame.

Product path is TensorRT-only. There is no PyTorch / ``.pt`` fallback — missing
or unloadable engines fail the job at startup.

Recall-first: low conf floor + multiple peaks. No Kalman / visibility gating —
analyze (or a later stage) chooses the true shuttle among candidates.
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

from .shuttle_peaks import MIN_CONF, NMS_RADIUS, TOP_K, top_candidates
from .types import ShuttleCandidate

_INPUT_H = 288
_INPUT_W = 512
# TrackNet stacks prev/curr/next RGB → 9 channels; center heatmap is frame i.
SHUTTLE_WIN = 3


def _max_triplets() -> int:
    """TrackNet micro-batch size (env ``SHUTTLE_MAX_TRIPLETS``, default 48)."""
    raw = os.environ.get("SHUTTLE_MAX_TRIPLETS", "48")
    try:
        n = int(raw)
    except ValueError:
        n = 48
    return max(1, n)


# Module-level default for tests that patch ``_MAX_TRIPLETS``.
_MAX_TRIPLETS = _max_triplets()


class ShuttleDetector:
    """TrackNet shuttle detector (TRT engine required)."""

    def __init__(
        self,
        engine_path: str | Path,
        *,
        top_k: int = TOP_K,
        min_conf: float = MIN_CONF,
        nms_radius: int = NMS_RADIUS,
        batch: int | None = None,
    ) -> None:
        from .shuttle_trt import TrackNetTrtRunner

        path = Path(engine_path)
        if not path.is_file():
            raise FileNotFoundError(f"shuttle TRT engine missing: {path}")
        if path.suffix.lower() != ".engine":
            raise ValueError(
                f"shuttle weights must be a TensorRT .engine (got {path.name})"
            )

        self.top_k = top_k
        self.min_conf = min_conf
        self.nms_radius = nms_radius
        self.backend = "trt"
        self.device = "cuda"

        trt_batch = batch
        if trt_batch is None:
            env_b = os.environ.get("SHUTTLE_TRT_BATCH")
            trt_batch = int(env_b) if env_b else None
        self.trt = TrackNetTrtRunner(path, batch=trt_batch)
        self.max_triplets = int(self.trt.batch)

    def _resize_one(self, frame: np.ndarray) -> np.ndarray:
        interp = (
            cv2.INTER_AREA
            if frame.shape[1] >= _INPUT_W and frame.shape[0] >= _INPUT_H
            else cv2.INTER_LINEAR
        )
        return cv2.cvtColor(
            cv2.resize(frame, (_INPUT_W, _INPUT_H), interpolation=interp),
            cv2.COLOR_BGR2RGB,
        )

    def _preprocess_stack(self, frames: list[np.ndarray]) -> np.ndarray:
        """Preprocess frames → (N, 3, H, W) float32 CPU array."""
        if not frames:
            return np.empty((0, 3, _INPUT_H, _INPUT_W), dtype=np.float32)
        tiles = np.empty((len(frames), _INPUT_H, _INPUT_W, 3), dtype=np.uint8)
        n = len(frames)
        if n >= 8:
            workers = min(8, n)
            with ThreadPoolExecutor(max_workers=workers) as ex:
                for i, rgb in enumerate(ex.map(self._resize_one, frames)):
                    tiles[i] = rgb
        else:
            for i, frame in enumerate(frames):
                tiles[i] = self._resize_one(frame)
        # NHWC uint8 → NCHW float32
        return (
            tiles.astype(np.float32)
            .transpose(0, 3, 1, 2)
            .copy()
            / 255.0
        )

    def _peaks_from_heatmap(self, heatmap: np.ndarray) -> list[ShuttleCandidate]:
        return top_candidates(
            heatmap,
            top_k=self.top_k,
            min_conf=self.min_conf,
            nms_radius=self.nms_radius,
        )

    def process_frames(
        self,
        frames: list[np.ndarray],
        *,
        prev_frame: np.ndarray | None = None,
        next_frame: np.ndarray | None = None,
    ) -> list[list[ShuttleCandidate]]:
        """Stride-1 sliding TrackNet windows over a frame list.

        For interior frame ``i`` the triplet is ``(i-1, i, i+1)`` and the
        **center** heatmap is used for frame ``i``.

        Optional ``prev_frame`` / ``next_frame`` supply global neighbors beyond
        this list (chunk boundaries). When omitted, edges pad by repeating the
        list edge so every input frame still gets a result.
        """
        n = len(frames)
        if n == 0:
            return []

        inst_cap = int(getattr(self, "max_triplets", _MAX_TRIPLETS) or _MAX_TRIPLETS)
        max_trip = max(1, min(inst_cap, int(_MAX_TRIPLETS)))

        stacked = self._preprocess_stack(frames)
        if prev_frame is not None:
            left = self._preprocess_stack([prev_frame])
        else:
            left = stacked[0:1]
        if next_frame is not None:
            right = self._preprocess_stack([next_frame])
        else:
            right = stacked[-1:]
        # (n+2, 3, H, W)
        ext = np.concatenate([left, stacked, right], axis=0)

        center_parts: list[np.ndarray] = []
        for start in range(0, n, max_trip):
            end = min(n, start + max_trip)
            c0 = start + 1
            c1 = end + 1
            # (B, 9, H, W)
            batch = np.concatenate(
                [ext[c0 - 1 : c1 - 1], ext[c0:c1], ext[c0 + 1 : c1 + 1]],
                axis=1,
            )
            heatmaps = self.trt.forward(batch)
            if heatmaps.ndim != 4 or heatmaps.shape[1] != SHUTTLE_WIN:
                raise RuntimeError(
                    f"TrackNet heatmap shape {heatmaps.shape} expected "
                    f"(B, {SHUTTLE_WIN}, H, W)"
                )
            if heatmaps.shape[0] != batch.shape[0]:
                raise RuntimeError(
                    f"TrackNet batch dim {heatmaps.shape[0]} != {batch.shape[0]}"
                )
            center_parts.append(heatmaps[:, 1].astype(np.float32, copy=False))

        centers = np.concatenate(center_parts, axis=0)
        return [self._peaks_from_heatmap(centers[i]) for i in range(n)]
