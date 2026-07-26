"""Multi-K CUDA-graph consumer for research ffmpeg pose benches only.

Product ``pose.trt_runtime.GpuConsumer`` is K=1 (stage → run → sync). This
module owns the decode-ring depth, zero-copy ``feed``, and slot eviction that
multi-ffmpeg throughput experiments need.
"""
from __future__ import annotations

import numpy as np
import torch

from pose.letterbox import IMGSZ
from pose.trt_runtime import CHANNELS, load_engine  # noqa: F401 — re-export helper

__all__ = ["RingGpuConsumer", "load_engine"]


class RingGpuConsumer:
    """K-deep buffer pool: pinned H2D / SHM feed + uint8→fp32 + CUDA graph.

    Spatial size defaults to ``IMGSZ`` but must match the TRT engine input.
    """

    def __init__(
        self, engine, batch: int, K: int = 4, *, imgsz: int = IMGSZ
    ) -> None:
        import tensorrt as trt

        if K < 1:
            raise ValueError(f"K must be >= 1, got {K}")
        self.engine = engine
        self.batch = batch
        self.K = K
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
        self.pinned = [
            torch.empty(
                (batch, self.imgsz, self.imgsz, CHANNELS),
                dtype=torch.uint8,
                pin_memory=True,
            )
            for _ in range(K)
        ]
        self.staging = [
            torch.empty(
                (batch, self.imgsz, self.imgsz, CHANNELS),
                dtype=torch.uint8,
                device="cuda",
            )
            for _ in range(K)
        ]
        self.inp = [
            torch.empty(
                (batch, CHANNELS, self.imgsz, self.imgsz),
                dtype=torch.float32,
                device="cuda",
            )
            for _ in range(K)
        ]
        self.out = [
            torch.empty(out_shape, dtype=torch.float32, device="cuda")
            for _ in range(K)
        ]
        self.ev = [torch.cuda.Event() for _ in range(K)]
        self.graphs: list = [None] * K
        self.slot_in: list = [None] * K  # decode-ring slot held by each buffer
        self._capture()
        self.k = 0

    def _infer(self, b: int) -> None:
        self.context.set_tensor_address(self.in_name, self.inp[b].data_ptr())
        self.context.set_tensor_address(self.out_name, self.out[b].data_ptr())
        self.context.execute_async_v3(torch.cuda.current_stream().cuda_stream)

    def _capture(self) -> None:
        with torch.cuda.stream(self.stream):
            for b in range(self.K):
                for _ in range(20):
                    self._infer(b)
        torch.cuda.synchronize()
        for b in range(self.K):
            g = torch.cuda.CUDAGraph()
            with torch.cuda.graph(g, stream=self.stream):
                self._infer(b)
            self.graphs[b] = g
        torch.cuda.synchronize()

    def stage_host(self, host_arr: np.ndarray) -> int:
        """Copy a host batch into the next pinned buffer; return buffer index."""
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()
        self.pinned[b].copy_(torch.from_numpy(host_arr))
        return b

    def run_gpu(self, b: int) -> None:
        """Async H2D + normalize + CUDA-graph inference on one ordered stream."""
        with torch.cuda.stream(self.stream):
            self.staging[b].copy_(self.pinned[b], non_blocking=True)
            self.inp[b].copy_(self.staging[b].permute(0, 3, 1, 2))
            self.inp[b].div_(255.0)
            self.graphs[b].replay()
            self.ev[b].record(self.stream)

    def feed(self, slot_tensor, slot: int):
        """Zero-copy: DMA from pinned-shm slot → normalize → graph.replay.

        Returns the decode slot evicted from this buffer (safe to recycle), or
        None on first use of the buffer.
        """
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()
        evicted = self.slot_in[b]
        self.slot_in[b] = slot
        with torch.cuda.stream(self.stream):
            self.staging[b].copy_(slot_tensor, non_blocking=True)
            self.inp[b].copy_(self.staging[b].permute(0, 3, 1, 2))
            self.inp[b].div_(255.0)
            self.graphs[b].replay()
            self.ev[b].record(self.stream)
        return evicted

    def sync(self) -> None:
        self.stream.synchronize()
