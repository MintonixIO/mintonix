"""TrackNetV5 TensorRT runtime for product shuttle path.

Loads a fixed-batch FP16 (or FP32) engine produced by tools/export_tracknet_trt.py.
Critical correctness notes from the 5090 campaign:
  - Run on the default CUDA stream after H2D completes (no private-stream race).
  - Clone TRT output buffers before reuse (persistent binding views corrupt prior batches).
  - Do not wrap TRT execute in torch autocast.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import torch

log = logging.getLogger("video-det.shuttle_trt")

_INPUT_H = 288
_INPUT_W = 512
_IN_CH = 9
_OUT_CH = 3


class TrackNetTrtRunner:
    """Fixed-batch TrackNet TRT: (B, 9, 288, 512) float → (B, 3, 288, 512) float."""

    def __init__(self, engine_path: str | Path, *, batch: int | None = None) -> None:
        import tensorrt as trt

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
        # Resolve dynamic dims from engine or explicit batch.
        eng_b = int(in_shape[0]) if in_shape[0] > 0 else None
        self.batch = int(batch) if batch and batch > 0 else (eng_b or 48)
        if eng_b is not None and eng_b != self.batch:
            # Fixed engine — honor engine batch.
            self.batch = eng_b

        # Set concrete shapes for strongly-typed / explicit-batch engines.
        concrete_in = (self.batch, _IN_CH, _INPUT_H, _INPUT_W)
        try:
            self.context.set_input_shape(self.in_name, concrete_in)
        except Exception:  # noqa: BLE001 — older APIs / already fixed
            pass

        out_shape = tuple(self.context.get_tensor_shape(self.out_name))
        if any(d < 0 for d in out_shape):
            out_shape = (self.batch, _OUT_CH, _INPUT_H, _INPUT_W)

        # Device buffers (float32 I/O — AutoCast engines still often expose FP32 bindings).
        self.inp = torch.empty(concrete_in, dtype=torch.float32, device="cuda")
        self.out = torch.empty(out_shape, dtype=torch.float32, device="cuda")
        self.context.set_tensor_address(self.in_name, self.inp.data_ptr())
        self.context.set_tensor_address(self.out_name, self.out.data_ptr())
        # Dedicated stream so pose∥shuttle can overlap (avoid default-stream global syncs).
        self.stream = torch.cuda.Stream()

        log.info(
            "TrackNetTrtRunner: %s batch=%d in=%s out=%s",
            path.name,
            self.batch,
            concrete_in,
            out_shape,
        )

    def forward(self, batch: torch.Tensor) -> torch.Tensor:
        """Run up to ``self.batch`` triplets. Pads short batches by repeating last.

        Args:
            batch: (N, 9, 288, 512) float32/float16 on CUDA (or CPU — will copy).

        Returns:
            (N, 3, 288, 512) float32 CUDA tensor (cloned, safe to hold across calls).
        """
        if batch.ndim != 4 or batch.shape[1] != _IN_CH:
            raise RuntimeError(f"expected (N, 9, H, W), got {tuple(batch.shape)}")
        n = int(batch.shape[0])
        if n == 0:
            return torch.empty(
                (0, _OUT_CH, _INPUT_H, _INPUT_W), dtype=torch.float32, device="cuda"
            )
        if n > self.batch:
            raise RuntimeError(f"batch {n} > engine batch {self.batch}")

        # Pad to fixed engine batch on the same stream as execute.
        if batch.device.type != "cuda":
            batch = batch.to("cuda", non_blocking=True)
        batch = batch.float().contiguous()
        if n < self.batch:
            pad = batch[-1:].expand(self.batch - n, -1, -1, -1)
            batch = torch.cat([batch, pad], dim=0)

        # Ordered on dedicated stream: H2D/device-copy → execute → stream sync.
        # Do NOT torch.cuda.synchronize() (device-wide) — that kills pose∥shuttle overlap.
        with torch.cuda.stream(self.stream):
            self.inp.copy_(batch, non_blocking=True)
            ok = self.context.execute_async_v3(self.stream.cuda_stream)
            if not ok:
                raise RuntimeError("TrackNet TRT execute_async_v3 failed")
        self.stream.synchronize()
        # Clone so the next forward does not overwrite returned views.
        return self.out[:n].detach().clone()
