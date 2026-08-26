"""TrackNetV5 TensorRT runtime for product shuttle path (no PyTorch).

Loads a fixed-batch FP16/FP32 engine produced by tools/export_tracknet_trt.py.
Uses pycuda for device buffers so the product image does not need torch wheels.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from trt_io import acquire_device_context, gpu_execute, host_dtype, nbytes

log = logging.getLogger("video-det.shuttle_trt")

_INPUT_H = 288
_INPUT_W = 512
_IN_CH = 9
_OUT_CH = 3


class TrackNetTrtRunner:
    """Fixed-batch TrackNet TRT: (B, 9, 288, 512) float → (B, 3, 288, 512) float."""

    def __init__(self, engine_path: str | Path, *, batch: int | None = None) -> None:
        import pycuda.driver as cuda
        import tensorrt as trt

        self.cuda_ctx = acquire_device_context()

        path = Path(engine_path)
        if not path.is_file():
            raise FileNotFoundError(f"shuttle TRT engine missing: {path}")

        logger = trt.Logger(trt.Logger.WARNING)
        trt.init_libnvinfer_plugins(logger, "")
        runtime = trt.Runtime(logger)
        engine = runtime.deserialize_cuda_engine(path.read_bytes())
        if engine is None:
            raise RuntimeError(f"failed to deserialize shuttle engine: {path}")

        self.engine = engine
        self.context = engine.create_execution_context()
        names = [engine.get_tensor_name(i) for i in range(engine.num_io_tensors)]
        self.in_name = next(
            n for n in names if engine.get_tensor_mode(n) == trt.TensorIOMode.INPUT
        )
        self.out_name = next(
            n for n in names if engine.get_tensor_mode(n) == trt.TensorIOMode.OUTPUT
        )

        in_shape = tuple(engine.get_tensor_shape(self.in_name))
        eng_b = int(in_shape[0]) if in_shape[0] > 0 else None
        self.batch = int(batch) if batch and batch > 0 else (eng_b or 48)
        if eng_b is not None and eng_b != self.batch:
            self.batch = eng_b

        concrete_in = (self.batch, _IN_CH, _INPUT_H, _INPUT_W)
        try:
            self.context.set_input_shape(self.in_name, concrete_in)
        except Exception:  # noqa: BLE001
            pass

        out_shape = tuple(self.context.get_tensor_shape(self.out_name))
        if any(d < 0 for d in out_shape):
            out_shape = (self.batch, _OUT_CH, _INPUT_H, _INPUT_W)
        self.out_shape = out_shape

        self.in_np_dtype = host_dtype(engine.get_tensor_dtype(self.in_name))
        self.out_np_dtype = host_dtype(engine.get_tensor_dtype(self.out_name))
        self._in_nbytes = nbytes(concrete_in, self.in_np_dtype)
        self._out_nbytes = nbytes(out_shape, self.out_np_dtype)
        with gpu_execute(self.cuda_ctx):
            self.d_in = cuda.mem_alloc(self._in_nbytes)
            self.d_out = cuda.mem_alloc(self._out_nbytes)
            self.stream = cuda.Stream()
            self.context.set_tensor_address(self.in_name, int(self.d_in))
            self.context.set_tensor_address(self.out_name, int(self.d_out))
            self.h_in = cuda.pagelocked_empty(concrete_in, dtype=self.in_np_dtype)
            self.h_out = cuda.pagelocked_empty(out_shape, dtype=self.out_np_dtype)

        log.info(
            "TrackNetTrtRunner: %s batch=%d in=%s/%s out=%s/%s",
            path.name,
            self.batch,
            concrete_in,
            self.in_np_dtype,
            out_shape,
            self.out_np_dtype,
        )

    def forward(self, batch: np.ndarray) -> np.ndarray:
        """Run up to ``self.batch`` triplets. Pads short batches by repeating last.

        Args:
            batch: (N, 9, 288, 512) float32/float16 array (CPU).

        Returns:
            (N, 3, 288, 512) float32 numpy array.
        """
        import pycuda.driver as cuda

        arr = np.asarray(batch)
        if arr.ndim != 4 or arr.shape[1] != _IN_CH:
            raise RuntimeError(f"expected (N, 9, H, W), got {tuple(arr.shape)}")
        n = int(arr.shape[0])
        if n == 0:
            return np.empty((0, _OUT_CH, _INPUT_H, _INPUT_W), dtype=np.float32)
        if n > self.batch:
            raise RuntimeError(f"batch {n} > engine batch {self.batch}")

        arr = np.ascontiguousarray(arr, dtype=self.in_np_dtype)
        if n < self.batch:
            pad = np.repeat(arr[-1:], self.batch - n, axis=0)
            arr = np.concatenate([arr, pad], axis=0)

        with gpu_execute(self.cuda_ctx):
            np.copyto(self.h_in, arr)
            cuda.memcpy_htod_async(self.d_in, self.h_in, self.stream)
            ok = self.context.execute_async_v3(self.stream.handle)
            if not ok:
                raise RuntimeError("TrackNet TRT execute_async_v3 failed")
            cuda.memcpy_dtoh_async(self.h_out, self.d_out, self.stream)
            self.stream.synchronize()
            return np.array(self.h_out[:n], copy=True).astype(np.float32, copy=False)
