"""Shuttle detection: TrackNetV5 heatmaps → top-K candidates per frame.

Recall-first: low conf floor + multiple peaks. No Kalman / visibility gating —
analyze (or a later stage) chooses the true shuttle among candidates.

Product path requires CUDA (GPU worker image). Uses stride-1 sliding
prev/curr/next windows (center heatmap per frame) and micro-batches up to
`_MAX_TRIPLETS` per forward. Callers may pass global ``prev_frame`` /
``next_frame`` so chunk boundaries stay temporally correct.

`import detect.shuttle` is light (no torch at import); torch loads on
ShuttleDetector construction / process_frames.
"""
from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from typing import TYPE_CHECKING

import cv2
import numpy as np

from .shuttle_peaks import MIN_CONF, NMS_RADIUS, TOP_K, top_candidates
from .types import ShuttleCandidate

if TYPE_CHECKING:
    import torch

_INPUT_H = 288
_INPUT_W = 512
# TrackNet stacks prev/curr/next RGB → 9 channels; center heatmap is frame i.
SHUTTLE_WIN = 3
# Cap TrackNet batch dim so a large OpenCV chunk does not OOM the GPU.
_MAX_TRIPLETS = 16


def _torch():
    import torch

    return torch


def _autocast_cuda(device: str):
    """Autocast on CUDA only; prefer torch.amp.autocast when available."""
    if not str(device).startswith("cuda"):
        return nullcontext()
    torch = _torch()
    amp = getattr(torch, "amp", None)
    if amp is not None and hasattr(amp, "autocast"):
        return amp.autocast("cuda", enabled=True)
    return torch.cuda.amp.autocast(enabled=True)


class ShuttleDetector:
    def __init__(
        self,
        ckpt_path: str | Path,
        *,
        top_k: int = TOP_K,
        min_conf: float = MIN_CONF,
        nms_radius: int = NMS_RADIUS,
        device: str | None = None,
    ) -> None:
        torch = _torch()
        self.top_k = top_k
        self.min_conf = min_conf
        self.nms_radius = nms_radius
        # Fail fast on device before importing TrackNet (heavy / torch-dependent).
        if device is None:
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "ShuttleDetector requires CUDA (GPU worker); "
                    "torch.cuda.is_available() is False"
                )
            self.device = "cuda"
        else:
            self.device = device
            if self.device.startswith("cuda") and not torch.cuda.is_available():
                raise RuntimeError(
                    f"ShuttleDetector device={self.device!r} but CUDA is unavailable"
                )
        from .tracknet import TrackNetV5

        self.model = TrackNetV5().to(self.device).eval()
        state = torch.load(ckpt_path, map_location=self.device, weights_only=True)
        sd = state.get("model_state_dict", state.get("state_dict", state))
        self.model.load_state_dict(sd)

    def _preprocess_stack(self, frames: list[np.ndarray]):
        """Preprocess frames → (N, 3, H, W) float CPU tensor."""
        torch = _torch()
        if not frames:
            return torch.empty((0, 3, _INPUT_H, _INPUT_W), dtype=torch.float32)
        tiles = np.empty((len(frames), _INPUT_H, _INPUT_W, 3), dtype=np.uint8)
        for i, frame in enumerate(frames):
            interp = (
                cv2.INTER_AREA
                if frame.shape[1] >= _INPUT_W and frame.shape[0] >= _INPUT_H
                else cv2.INTER_LINEAR
            )
            tiles[i] = cv2.cvtColor(
                cv2.resize(frame, (_INPUT_W, _INPUT_H), interpolation=interp),
                cv2.COLOR_BGR2RGB,
            )
        # NHWC uint8 → NCHW float in one shot (less Python per-frame overhead).
        return torch.from_numpy(tiles).permute(0, 3, 1, 2).float().div_(255.0)

    def _peaks_from_heatmap(self, heatmap: np.ndarray) -> list[ShuttleCandidate]:
        """Single (H, W) heatmap → top-K candidates."""
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

        Micro-batches up to ``_MAX_TRIPLETS`` triplets per forward; host triplet
        tensors are built per micro-batch (not a full N×9 buffer).
        """
        torch = _torch()
        n = len(frames)
        if n == 0:
            return []

        with torch.inference_mode():
            # Batched preprocess → (N, 3, H, W). Tests may patch `_preprocess_stack`.
            stacked = self._preprocess_stack(frames)
            # Extended strip: [left_ctx, f0..f{n-1}, right_ctx] for O(1) window index.
            if prev_frame is not None:
                left = self._preprocess_stack([prev_frame])
            else:
                left = stacked[0:1]
            if next_frame is not None:
                right = self._preprocess_stack([next_frame])
            else:
                right = stacked[-1:]
            # (n+2, 3, H, W) — center of frame i lives at ext[i+1].
            ext = torch.cat([left, stacked, right], dim=0)

            out: list[list[ShuttleCandidate]] = []
            use_cuda = str(self.device).startswith("cuda")
            for start in range(0, n, _MAX_TRIPLETS):
                end = min(n, start + _MAX_TRIPLETS)
                # ext indices for centers in this micro-batch
                c0 = start + 1
                c1 = end + 1
                batch = torch.cat(
                    [ext[c0 - 1 : c1 - 1], ext[c0:c1], ext[c0 + 1 : c1 + 1]],
                    dim=1,
                ).to(self.device, non_blocking=use_cuda)
                with _autocast_cuda(self.device):
                    heatmaps = self.model(batch)
                heatmaps = heatmaps.float().cpu().numpy()
                if heatmaps.ndim != 4 or heatmaps.shape[1] != SHUTTLE_WIN:
                    raise RuntimeError(
                        f"TrackNet heatmap shape {heatmaps.shape} expected "
                        f"(B, {SHUTTLE_WIN}, H, W)"
                    )
                if heatmaps.shape[0] != batch.shape[0]:
                    raise RuntimeError(
                        f"TrackNet batch dim {heatmaps.shape[0]} != {batch.shape[0]}"
                    )
                # Center channel is the prediction for the current frame.
                for b in range(heatmaps.shape[0]):
                    out.append(self._peaks_from_heatmap(heatmaps[b, 1]))
        return out
