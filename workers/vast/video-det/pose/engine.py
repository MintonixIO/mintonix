"""Pose engine: YOLO26x-pose TensorRT INT8 + letterbox geometry.

Product code (detect/pose.py) must not reimplement preprocess, TRT I/O, or
postprocess — it only adapts engine outputs into the job/JSON types.

Pure postprocess helpers (`coerce_ultralytics_pose`, `decode_pose_frame`,
`decode_pose_batch`) decode TRT output to original-pixel `EngineDetection`s.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .letterbox import IMGSZ, LetterboxMeta, letterbox_bgr, unletterbox_xy

# INT8 scores run ~0.2 below FP32; far court players are faint.
DEFAULT_CONF = 0.15
_N_KP = 17


@dataclass
class EngineDetection:
    """One person in original-resolution pixel coordinates."""

    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    conf: float
    keypoints: np.ndarray  # (17, 3) float32: x, y, conf in original pixels


# ------------------------------------------------------------------
# Postprocess — Ultralytics pose TRT: (300, 56|57) xyxy in letterbox space
# ------------------------------------------------------------------


def coerce_ultralytics_pose(preds: np.ndarray) -> np.ndarray:
    """Normalize TRT output to (N, C) with C >= 5 + 17*3.

    Accepts (300, 56|57), (56|57, 300), or a leading batch dim already stripped.
    """
    p = np.asarray(preds)
    if p.ndim == 3:
        p = p[0]
    if p.ndim != 2:
        return np.zeros((0, 5 + _N_KP * 3), dtype=np.float32)

    # Features-first layout → transpose to (N, C)
    if p.shape[0] in (56, 57) and p.shape[0] < p.shape[1]:
        p = p.T
    if p.shape[1] < 5 + _N_KP * 3:
        return np.zeros((0, 5 + _N_KP * 3), dtype=np.float32)
    return p.astype(np.float32, copy=False)


def decode_pose_frame(
    preds: np.ndarray, meta: LetterboxMeta, conf: float
) -> list[EngineDetection]:
    """Decode one frame of Ultralytics pose TRT output to original pixels.

    Args:
        preds: Raw TRT slice for one image — (300, C), (C, 300), or similar.
        meta: Letterbox geometry used for that frame's preprocess.
        conf: Keep detections with score > conf (strict).
    """
    dets = coerce_ultralytics_pose(preds)
    if dets.size == 0:
        return []

    scores = dets[:, 4]
    keep = scores > conf
    if not keep.any():
        return []
    dets = dets[keep]

    x1, y1 = unletterbox_xy(dets[:, 0], dets[:, 1], meta)
    x2, y2 = unletterbox_xy(dets[:, 2], dets[:, 3], meta)
    # Clip to original frame
    x1 = np.clip(x1, 0, meta.orig_w)
    x2 = np.clip(x2, 0, meta.orig_w)
    y1 = np.clip(y1, 0, meta.orig_h)
    y2 = np.clip(y2, 0, meta.orig_h)

    # keypoints start after conf (+ optional cls): 5 or 6
    kp_off = 6 if dets.shape[1] >= 6 + _N_KP * 3 else 5
    kpts = dets[:, kp_off : kp_off + _N_KP * 3].reshape(-1, _N_KP, 3).copy()
    kx, ky = unletterbox_xy(kpts[:, :, 0], kpts[:, :, 1], meta)
    kpts[:, :, 0] = np.clip(kx, 0, meta.orig_w)
    kpts[:, :, 1] = np.clip(ky, 0, meta.orig_h)

    out: list[EngineDetection] = []
    for i in range(dets.shape[0]):
        out.append(
            EngineDetection(
                bbox=(float(x1[i]), float(y1[i]), float(x2[i]), float(y2[i])),
                conf=float(dets[i, 4]),
                keypoints=kpts[i].astype(np.float32),
            )
        )
    return out


def decode_pose_batch(
    raw_batch: np.ndarray,
    metas: list[LetterboxMeta],
    conf: float,
) -> list[list[EngineDetection]]:
    """Decode a TRT batch output to per-frame detections.

    Args:
        raw_batch: (B, ...) host numpy TRT output.
        metas: Length-B letterbox metas (one per batch slot).
        conf: Score threshold (strict >).
    """
    raw = np.asarray(raw_batch)
    if raw.ndim < 1:
        raise ValueError(f"expected batched TRT output, got shape {raw.shape}")
    b = int(raw.shape[0])
    if len(metas) != b:
        raise ValueError(f"metas length {len(metas)} != batch dim {b}")
    return [decode_pose_frame(raw[i], metas[i], conf) for i in range(b)]


class PoseEngine:
    """Synchronous batch pose engine for already-decoded BGR frames.

    Uses Ultralytics TRT engines, letterbox geometry, and conf policy.
    GPU work is the single-buffer product ``GpuConsumer`` (stage → run → sync)
    so the same GPU can run shuttle/ReID next without a multi-K research ring.
    """

    def __init__(
        self,
        engine_path: str | Path,
        *,
        conf: float = DEFAULT_CONF,
        batch_size: int | None = None,
    ) -> None:
        # Defer CUDA/TRT until construction so `import pose` works on CI without
        # a driver (same contract as detect.reid).
        import torch

        from .trt_runtime import GpuConsumer, load_engine

        self.conf = conf
        self.engine = load_engine(Path(engine_path))
        in_name = self.engine.get_tensor_name(0)
        in_shape = tuple(self.engine.get_tensor_shape(in_name))
        engine_batch = int(in_shape[0])
        if batch_size is not None and batch_size != engine_batch:
            raise ValueError(
                f"PoseEngine batch_size={batch_size} does not match engine "
                f"batch={engine_batch}; rebuild the engine or pass batch_size=None"
            )
        self.batch_size = engine_batch
        # NCHW: (B, 3, H, W) — spatial size must match letterbox / GpuConsumer.
        if len(in_shape) == 4:
            h, w = int(in_shape[2]), int(in_shape[3])
            if h != w:
                raise ValueError(
                    f"PoseEngine expects square input, got HxW={h}x{w} from {in_shape}"
                )
            self.imgsz = h
        else:
            self.imgsz = IMGSZ
        self._consumer = GpuConsumer(self.engine, self.batch_size, imgsz=self.imgsz)
        self._torch = torch

    def run_batch(self, frames_bgr: list[np.ndarray]) -> list[list[EngineDetection]]:
        """Run pose on exactly `batch_size` BGR frames.

        Returns per-frame lists of detections in **original pixel** coordinates.
        """
        if len(frames_bgr) != self.batch_size:
            raise ValueError(
                f"Expected {self.batch_size} frames, got {len(frames_bgr)}"
            )

        rgb = np.empty((self.batch_size, self.imgsz, self.imgsz, 3), dtype=np.uint8)
        metas: list[LetterboxMeta] = []
        for i, frame in enumerate(frames_bgr):
            tile, meta = letterbox_bgr(frame, self.imgsz)
            rgb[i] = tile
            metas.append(meta)

        c = self._consumer
        c.stage_host(rgb)
        c.run_gpu(0)
        c.sync()
        raw = c.out.detach().float().cpu().numpy()
        return decode_pose_batch(raw, metas, self.conf)


# Back-compat aliases (private names used in older call sites / tests).
_coerce_ultralytics_pose = coerce_ultralytics_pose
