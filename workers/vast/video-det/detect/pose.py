from pathlib import Path

import cv2
import numpy as np
import tensorrt as trt
import pycuda.driver as cuda
import torch
import torchvision

from .types import Keypoint, PoseResult

_LOGGER = trt.Logger(trt.Logger.WARNING)
_CONF_THRESH = 0.25
_NMS_IOU = 0.45
_N_KP = 17
_INPUT_SIZE = 640


class PoseEstimator:
    def __init__(self, engine_path: str | Path, batch_size: int = 16) -> None:
        # Initialize the CUDA driver on first construction, not module import:
        # the CI smoke test imports this module on a driverless runner (against
        # the toolkit's stub libcuda), where cuInit would fail.
        import pycuda.autoinit  # noqa: F401

        self.batch_size = batch_size

        with open(engine_path, "rb") as f:
            runtime = trt.Runtime(_LOGGER)
            self.engine = runtime.deserialize_cuda_engine(f.read())

        self.context = self.engine.create_execution_context()
        self._alloc_buffers()

    # ------------------------------------------------------------------
    # Buffer management
    # ------------------------------------------------------------------

    def _alloc_buffers(self) -> None:
        self._bufs: dict[str, dict] = {}
        self._input_name: str = ""
        self._output_name: str = ""

        for i in range(self.engine.num_io_tensors):
            name = self.engine.get_tensor_name(i)
            dtype = trt.nptype(self.engine.get_tensor_dtype(name))
            shape = list(self.engine.get_tensor_shape(name))

            # replace dynamic batch dim (-1) with the configured batch size
            shape = [self.batch_size if s == -1 else s for s in shape]

            host = cuda.pagelocked_empty(int(np.prod(shape)), dtype)
            dev = cuda.mem_alloc(host.nbytes)
            self._bufs[name] = {"host": host, "device": dev, "shape": shape}

            if self.engine.get_tensor_mode(name) == trt.TensorIOMode.INPUT:
                self._input_name = name
            else:
                self._output_name = name

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def run_batch(self, frames: list[np.ndarray]) -> list[list[PoseResult]]:
        assert len(frames) == self.batch_size, (
            f"Expected {self.batch_size} frames, got {len(frames)}"
        )

        x = self._preprocess(frames)
        in_buf = self._bufs[self._input_name]
        out_buf = self._bufs[self._output_name]

        np.copyto(in_buf["host"], x.ravel())
        cuda.memcpy_htod(in_buf["device"], in_buf["host"])

        bindings = [int(self._bufs[self.engine.get_tensor_name(i)]["device"])
                    for i in range(self.engine.num_io_tensors)]
        self.context.execute_v2(bindings)

        cuda.memcpy_dtoh(out_buf["host"], out_buf["device"])
        raw = out_buf["host"].reshape(out_buf["shape"])

        orig_shapes = [f.shape[:2] for f in frames]
        return [self._decode(raw[b], orig_shapes[b]) for b in range(self.batch_size)]

    def _preprocess(self, frames: list[np.ndarray]) -> np.ndarray:
        out = np.zeros((len(frames), 3, _INPUT_SIZE, _INPUT_SIZE), dtype=np.float32)
        for i, frame in enumerate(frames):
            resized = cv2.resize(frame, (_INPUT_SIZE, _INPUT_SIZE))
            out[i] = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).transpose(2, 0, 1) / 255.0
        return out

    def _decode(self, preds: np.ndarray, orig_hw: tuple[int, int]) -> list[PoseResult]:
        # preds may be [n_anchors, 56] or [56, n_anchors] depending on export
        if preds.ndim == 2 and preds.shape[0] == 4 + 1 + _N_KP * 3:
            preds = preds.T  # → [n_anchors, 56]

        scores = preds[:, 4]
        mask = scores > _CONF_THRESH
        if not mask.any():
            return []

        boxes = preds[mask, :4]             # cx, cy, w, h in 640-space
        scores = scores[mask]
        kpts = preds[mask, 5:].reshape(-1, _N_KP, 3)

        x1 = (boxes[:, 0] - boxes[:, 2] / 2) / _INPUT_SIZE
        y1 = (boxes[:, 1] - boxes[:, 3] / 2) / _INPUT_SIZE
        x2 = (boxes[:, 0] + boxes[:, 2] / 2) / _INPUT_SIZE
        y2 = (boxes[:, 1] + boxes[:, 3] / 2) / _INPUT_SIZE
        xyxy = np.stack([x1, y1, x2, y2], axis=1)

        keep = torchvision.ops.nms(
            torch.from_numpy(xyxy.astype(np.float32)),
            torch.from_numpy(scores.astype(np.float32)),
            _NMS_IOU,
        ).numpy()

        results = []
        for idx in keep:
            keypoints = [
                Keypoint(
                    x=float(kpts[idx, k, 0] / _INPUT_SIZE),
                    y=float(kpts[idx, k, 1] / _INPUT_SIZE),
                    conf=float(kpts[idx, k, 2]),
                )
                for k in range(_N_KP)
            ]
            results.append(PoseResult(
                keypoints=keypoints,
                bbox=(float(xyxy[idx, 0]), float(xyxy[idx, 1]),
                      float(xyxy[idx, 2]), float(xyxy[idx, 3])),
                conf=float(scores[idx]),
            ))
        return results

    def __del__(self) -> None:
        if hasattr(self, "context"):
            del self.context
        if hasattr(self, "engine"):
            del self.engine
