"""Shared TensorRT host I/O: CUDA context, binding dtypes, GPU lock.

Used by both pose and shuttle runners. Product engines keep FP32 I/O with
FP16 compute when exported with ``keep_io_types=True``; some stacks bind
FP16. We size buffers from the engine dtype instead of assuming float32.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Iterator

import numpy as np

# One GPU / one TRT context: pose and shuttle must not execute concurrently
# (PARALLEL_DETECT worker threads, or FastAPI threadpool ≠ lifespan thread).
_gpu_lock = threading.Lock()

_DTYPE_BY_NAME = {
    "FLOAT": np.float32,
    "FP32": np.float32,
    "HALF": np.float16,
    "FP16": np.float16,
}


def host_dtype(trt_dtype: Any) -> np.dtype:
    """Map a TensorRT ``DataType`` (or name) to a numpy dtype.

    Supports FLOAT and HALF only. Other bindings fail loud — INT8 I/O needs
    scales we do not have on the product path.
    """
    name = str(trt_dtype).split(".")[-1].upper()
    try:
        return np.dtype(_DTYPE_BY_NAME[name])
    except KeyError as e:
        raise RuntimeError(
            f"unsupported TRT binding dtype {trt_dtype!r}; "
            "product runners expect FLOAT or HALF I/O"
        ) from e


def nbytes(shape: tuple[int, ...], dtype: np.dtype) -> int:
    return int(np.prod(shape)) * int(np.dtype(dtype).itemsize)


def acquire_device_context():
    """Return the CUDA-runtime primary context, pushed on this thread if needed.

    TensorRT deserialize uses the primary context. A second pycuda context
    (make_context) can be left un-current by TRT APIs, after which pycuda
    ``mem_alloc`` fails with "no currently active context".
    """
    import pycuda.driver as cuda

    try:
        cuda.init()
    except Exception:  # noqa: BLE001
        pass
    if not cuda.Device.count():
        raise RuntimeError("TensorRT runner requires a CUDA device")
    ctx = cuda.Device(0).retain_primary_context()
    try:
        current = cuda.Context.get_current()
    except cuda.LogicError:
        current = None
    if current is None:
        ctx.push()
    return ctx


def detach_current_context() -> None:
    """Pop the current CUDA context so another thread can push it.

    Engines load on the FastAPI lifespan thread; jobs run on a threadpool
    thread. Leaving the context current on the load thread makes
    ``ctx.push()`` on the job thread fail.
    """
    import pycuda.driver as cuda

    try:
        cuda.Context.get_current()
    except cuda.LogicError:
        return
    cuda.Context.pop()


@contextmanager
def gpu_execute(ctx) -> Iterator[None]:
    """Push ``ctx`` on this thread, serialize GPU work, then pop.

    Safe when the job runs on a different thread than engine load, and when
    pose and shuttle share one context.
    """
    with _gpu_lock:
        ctx.push()
        try:
            yield
        finally:
            ctx.pop()
