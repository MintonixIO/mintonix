"""Shuttle detection: TrackNetV5 heatmaps → top-K candidates per frame.

Recall-first: low conf floor + multiple peaks. No Kalman / visibility gating —
analyze (or a later stage) chooses the true shuttle among candidates.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import torch

from .shuttle_peaks import MIN_CONF, NMS_RADIUS, TOP_K, top_candidates
from .tracknet import TrackNetV5
from .types import ShuttleCandidate

_INPUT_H = 288
_INPUT_W = 512


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
        self.top_k = top_k
        self.min_conf = min_conf
        self.nms_radius = nms_radius
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = TrackNetV5().to(self.device).eval()
        state = torch.load(ckpt_path, map_location=self.device, weights_only=True)
        sd = state.get("model_state_dict", state.get("state_dict", state))
        self.model.load_state_dict(sd)

    def _preprocess(self, frame: np.ndarray) -> torch.Tensor:
        # INTER_AREA when shrinking preserves a tiny bright shuttle better than
        # linear sampling.
        interp = (
            cv2.INTER_AREA
            if frame.shape[1] >= _INPUT_W and frame.shape[0] >= _INPUT_H
            else cv2.INTER_LINEAR
        )
        rgb = cv2.cvtColor(
            cv2.resize(frame, (_INPUT_W, _INPUT_H), interpolation=interp),
            cv2.COLOR_BGR2RGB,
        )
        return torch.from_numpy(rgb).permute(2, 0, 1).float().div(255.0)

    @torch.inference_mode()
    def process_triplet(
        self, f1: np.ndarray, f2: np.ndarray, f3: np.ndarray
    ) -> list[list[ShuttleCandidate]]:
        """Return top-K candidates for each of the three frames."""
        t1 = self._preprocess(f1)
        t2 = self._preprocess(f2)
        t3 = self._preprocess(f3)
        # TrackNetV5 expects (B, 9, H, W) stacked RGB frames.
        x = torch.cat([t1, t2, t3], dim=0).unsqueeze(0).to(self.device)
        heatmaps = self.model(x)[0].float().cpu().numpy()  # 3×H×W
        return [
            top_candidates(
                heatmaps[i],
                top_k=self.top_k,
                min_conf=self.min_conf,
                nms_radius=self.nms_radius,
            )
            for i in range(3)
        ]
