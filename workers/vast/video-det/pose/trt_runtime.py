"""TensorRT runtime for PoseEngine (product path).

Owns engine deserialize (Ultralytics metadata strip) and a single CUDA-graph
infer path used only by `PoseEngine.run_batch`. Multi-K research rings live
under `tools/ffmpeg_pose_bench/` only.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import torch

from .letterbox import IMGSZ

CHANNELS = 3


def load_engine(path: Path):
    """Deserialize a TensorRT engine, stripping optional Ultralytics JSON header."""
    import tensorrt as trt

    logger = trt.Logger(trt.Logger.WARNING)
    trt.init_libnvinfer_plugins(logger, "")
    data = path.read_bytes()
    engine_bytes = data
    if len(data) >= 4:
        meta_len = struct.unpack_from("<I", data, 0)[0]
        if 0 < meta_len < len(data) - 4:
            try:
                json.loads(data[4 : 4 + meta_len])
                engine_bytes = data[4 + meta_len :]
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
    engine = trt.Runtime(logger).deserialize_cuda_engine(engine_bytes)
    if engine is None:
        raise RuntimeError(f"failed to deserialize TensorRT engine: {path}")
    return engine


class _TrtRunner:
    """Pinned H2D + normalize + CUDA-graph inference for one host batch."""

    def __init__(self, engine, batch: int, *, imgsz: int = IMGSZ) -> None:
        import tensorrt as trt

        self.engine = engine
        self.batch = batch
        self.imgsz = int(imgsz)
        self.context = engine.create_execution_context()

        names = [engine.get_tensor_name(i) for i in range(engine.num_io_tensors)]
        self.in_name = next(
            n
            for n in names
            if engine.get_tensor_mode(n) == trt.TensorIOMode.INPUT
        )
        self.out_name = next(
            n
            for n in names
            if engine.get_tensor_mode(n) == trt.TensorIOMode.OUTPUT
        )
        out_shape = tuple(engine.get_tensor_shape(self.out_name))

        self.stream = torch.cuda.Stream()
        self.pinned = torch.empty(
            (batch, self.imgsz, self.imgsz, CHANNELS),
            dtype=torch.uint8,
            pin_memory=True,
        )
        self.staging = torch.empty(
            (batch, self.imgsz, self.imgsz, CHANNELS),
            dtype=torch.uint8,
            device="cuda",
        )
        self.inp = torch.empty(
            (batch, CHANNELS, self.imgsz, self.imgsz),
            dtype=torch.float32,
            device="cuda",
        )
        self.out = torch.empty(out_shape, dtype=torch.float32, device="cuda")
        self.graph = None
        self._capture()

    def _infer(self) -> None:
        self.context.set_tensor_address(self.in_name, self.inp.data_ptr())
        self.context.set_tensor_address(self.out_name, self.out.data_ptr())
        self.context.execute_async_v3(torch.cuda.current_stream().cuda_stream)

    def _capture(self) -> None:
        with torch.cuda.stream(self.stream):
            for _ in range(20):
                self._infer()
        torch.cuda.synchronize()
        g = torch.cuda.CUDAGraph()
        with torch.cuda.graph(g, stream=self.stream):
            self._infer()
        self.graph = g
        torch.cuda.synchronize()

    def infer(self, host_arr: np.ndarray) -> np.ndarray:
        """Run one full batch: host NHWC uint8 → host float TRT output."""
        self.pinned.copy_(torch.from_numpy(host_arr))
        with torch.cuda.stream(self.stream):
            self.staging.copy_(self.pinned, non_blocking=True)
            self.inp.copy_(self.staging.permute(0, 3, 1, 2))
            self.inp.div_(255.0)
            self.graph.replay()
        self.stream.synchronize()
        return self.out.detach().float().cpu().numpy()


# Back-compat alias for research tools / older imports.
GpuConsumer = _TrtRunner
