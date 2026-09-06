"""Ultralytics PyTorch pose backend for bench / first timing (no TRT).

Same surface as `PoseEngine`: `batch_size` + `run_batch` → original-pixel
`EngineDetection`s. Product path remains TensorRT via `PoseEngine`.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from .engine import DEFAULT_CONF, EngineDetection
from .letterbox import IMGSZ

_N_KP = 17


class TorchPoseEngine:
    """YOLO pose via Ultralytics PyTorch (weights ``.pt``)."""

    def __init__(
        self,
        weights_path: str | Path,
        *,
        conf: float = DEFAULT_CONF,
        batch_size: int | None = None,
        imgsz: int | None = None,
    ) -> None:
        from ultralytics import YOLO

        path = Path(weights_path)
        if not path.is_file():
            raise FileNotFoundError(f"pose weights missing: {path}")

        self.conf = conf
        self.batch_size = int(
            batch_size
            if batch_size is not None
            else os.environ.get("POSE_TORCH_BATCH", "16")
        )
        if self.batch_size <= 0:
            raise ValueError(f"invalid batch_size={self.batch_size}")
        self.imgsz = int(imgsz if imgsz is not None else os.environ.get("POSE_IMGSZ", IMGSZ))
        self.model = YOLO(str(path))
        # Force GPU when available. FP16 via model weights (avoid per-call half=).
        try:
            import torch

            if torch.cuda.is_available():
                self.model.to("cuda")
                torch.backends.cudnn.benchmark = True
                if os.environ.get("POSE_TORCH_HALF", "1") not in (
                    "0",
                    "false",
                    "False",
                ):
                    try:
                        self.model.model.half()
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            pass

    def run_batch(self, frames_bgr: list[np.ndarray]) -> list[list[EngineDetection]]:
        if len(frames_bgr) != self.batch_size:
            raise ValueError(
                f"Expected {self.batch_size} frames, got {len(frames_bgr)}"
            )
        results = self.model.predict(
            frames_bgr,
            conf=self.conf,
            imgsz=self.imgsz,
            verbose=False,
            device=0,
        )
        out: list[list[EngineDetection]] = []
        for r in results:
            out.append(_detections_from_ultralytics(r))
        if len(out) != self.batch_size:
            # Ultralytics should return one result per image; pad empty if not.
            while len(out) < self.batch_size:
                out.append([])
            out = out[: self.batch_size]
        return out


def _detections_from_ultralytics(result) -> list[EngineDetection]:
    """Map one Ultralytics Results object to EngineDetection list (pixels)."""
    if result.boxes is None or len(result.boxes) == 0:
        return []
    boxes = result.boxes
    xyxy = boxes.xyxy.detach().cpu().numpy()
    confs = boxes.conf.detach().cpu().numpy()
    kpts_obj = result.keypoints
    if kpts_obj is None or kpts_obj.data is None:
        return []
    # data: (N, 17, 3) xy + conf
    kdata = kpts_obj.data.detach().cpu().numpy()
    dets: list[EngineDetection] = []
    n = min(len(xyxy), len(kdata), len(confs))
    for i in range(n):
        kp = np.asarray(kdata[i], dtype=np.float32)
        if kp.ndim != 2 or kp.shape[0] < _N_KP:
            continue
        if kp.shape[1] == 2:
            # no conf channel
            full = np.zeros((_N_KP, 3), dtype=np.float32)
            full[:, :2] = kp[:_N_KP]
            full[:, 2] = 1.0
            kp = full
        else:
            kp = kp[:_N_KP, :3].astype(np.float32, copy=False)
        x1, y1, x2, y2 = (float(v) for v in xyxy[i][:4])
        dets.append(
            EngineDetection(
                bbox=(x1, y1, x2, y2),
                conf=float(confs[i]),
                keypoints=kp,
            )
        )
    return dets
