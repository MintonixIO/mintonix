"""TensorRT runtime for PoseEngine (product path, no PyTorch).

Owns engine deserialize (Ultralytics metadata strip) and a single-batch TRT
infer path used by `PoseEngine.run_batch`. Uses pycuda for device buffers.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

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
    """Host NHWC uint8 → TRT NCHW float → host float output (pycuda)."""

    def __init__(self, engine, batch: int, *, imgsz: int = IMGSZ) -> None:
        import pycuda.driver as cuda
        import tensorrt as trt

        try:
            cuda.init()
        except Exception:  # noqa: BLE001
            pass
        if not cuda.Device.count():
            raise RuntimeError("PoseEngine requires a CUDA device")
        try:
            cuda.Context.get_current()
        except cuda.LogicError:
            cuda.Device(0).make_context()

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
        # Fixed batch engines: set concrete input shape if needed.
        try:
            self.context.set_input_shape(
                self.in_name, (batch, CHANNELS, self.imgsz, self.imgsz)
            )
        except Exception:  # noqa: BLE001
            pass
        out_shape = tuple(self.context.get_tensor_shape(self.out_name))
        if any(d < 0 for d in out_shape):
            raise RuntimeError(f"unresolved TRT output shape: {out_shape}")
        self.out_shape = out_shape

        in_shape = (batch, CHANNELS, self.imgsz, self.imgsz)
        self._in_nbytes = int(np.prod(in_shape)) * 4
        self._out_nbytes = int(np.prod(out_shape)) * 4
        self.d_in = cuda.mem_alloc(self._in_nbytes)
        self.d_out = cuda.mem_alloc(self._out_nbytes)
        self.stream = cuda.Stream()
        self.context.set_tensor_address(self.in_name, int(self.d_in))
        self.context.set_tensor_address(self.out_name, int(self.d_out))

        self.h_in = cuda.pagelocked_empty(in_shape, dtype=np.float32)
        self.h_out = cuda.pagelocked_empty(out_shape, dtype=np.float32)

    def infer(self, host_arr: np.ndarray) -> np.ndarray:
        """Run one full batch: host NHWC uint8 → host float TRT output."""
        import pycuda.driver as cuda

        arr = np.asarray(host_arr)
        if arr.shape != (self.batch, self.imgsz, self.imgsz, CHANNELS):
            raise ValueError(
                f"expected host NHWC ({self.batch},{self.imgsz},{self.imgsz},3), "
                f"got {arr.shape}"
            )
        # NHWC uint8 → NCHW float32 on host (letterbox already applied).
        nchw = (
            arr.astype(np.float32)
            .transpose(0, 3, 1, 2)
            .copy()
            / 255.0
        )
        np.copyto(self.h_in, nchw)
        cuda.memcpy_htod_async(self.d_in, self.h_in, self.stream)
        ok = self.context.execute_async_v3(self.stream.handle)
        if not ok:
            raise RuntimeError("Pose TRT execute_async_v3 failed")
        cuda.memcpy_dtoh_async(self.h_out, self.d_out, self.stream)
        self.stream.synchronize()
        return np.array(self.h_out, copy=True)


# Back-compat alias for research tools / older imports.
GpuConsumer = _TrtRunner
