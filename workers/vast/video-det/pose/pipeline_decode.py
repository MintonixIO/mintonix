"""
Fast CPU-decode → GPU-inference pipeline for yolo26x-pose TensorRT engine.

Decoders run as separate PROCESSES (own GIL each) and write decoded 640×640
rgb24 frames straight into a shared-memory ring; only small integer slot
indices cross the process queues (no frame pickling). The GPU consumer pulls
slots, does pinned H2D + fused uint8→fp32 CHW /255 normalize, and CUDA-graph
inference over a K-deep buffer pool on one ordered stream so CPU work overlaps
GPU compute.

Reports four throughputs so the bottleneck is unambiguous:
  • inference-only : pure graph.replay()                 (GPU compute ceiling)
  • consumer-only  : stage+infer from an in-RAM ring      (consumer path ceiling)
  • decode-only    : drain the ring, no GPU work          (CPU decode ceiling)
  • combined       : the full overlapped pipeline         (end-to-end)

Pure throughput harness: frames are real decoded pixels, but detection
correctness is not checked (timing is value-independent).

Usage:
  python pipeline_decode.py [engine] [--video V] [--workers N] [--batches M] [--bufs K]
"""
import argparse
import fcntl
import multiprocessing as mp
import os
import struct
import subprocess
import sys
import threading
import time
from multiprocessing import shared_memory
from pathlib import Path
from queue import Empty, Queue

import numpy as np
import torch

IMGSZ = 640
CHANNELS = 3
FRAME_BYTES = IMGSZ * IMGSZ * CHANNELS  # rgb24
F_SETPIPE_SZ = 1031
PIPE_SZ = 1 << 20  # 1 MiB pipe → fewer syscalls per frame


# ── CPU decode: one ffmpeg subprocess per video segment ────────────────────────
def spawn_ffmpeg(video: str, start_s: float, dur_s: float, threads: int = 0) -> subprocess.Popen:
    vf = (
        f"scale={IMGSZ}:{IMGSZ}:force_original_aspect_ratio=decrease,"
        f"pad={IMGSZ}:{IMGSZ}:(ow-iw)/2:(oh-ih)/2"
    )
    cmd = ["ffmpeg", "-loglevel", "error"]
    if threads > 0:
        cmd += ["-threads", str(threads)]   # decoder threads (before -i)
    cmd += [
        "-ss", f"{start_s:.3f}", "-t", f"{dur_s:.3f}",
        "-i", video, "-an", "-sn",
        "-vf", vf, "-pix_fmt", "rgb24",
        "-f", "rawvideo", "-",
    ]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         bufsize=FRAME_BYTES * 8)
    try:
        fcntl.fcntl(p.stdout.fileno(), F_SETPIPE_SZ, PIPE_SZ)
    except OSError:
        pass
    return p


def decode_worker(video, start_s, dur_s, shm_name, n_slots, batch,
                  free_q, ready_q, stop_evt, threads=0):
    """Process: decode a segment, fill shared-memory slots with uint8 batches."""
    shm = shared_memory.SharedMemory(name=shm_name)
    arr = np.ndarray((n_slots, batch, IMGSZ, IMGSZ, CHANNELS),
                     dtype=np.uint8, buffer=shm.buf)
    proc = spawn_ffmpeg(video, start_s, dur_s, threads=threads)
    stdout = proc.stdout
    nbytes = batch * FRAME_BYTES
    try:
        while not stop_evt.is_set():
            try:
                slot = free_q.get(timeout=0.5)
            except Exception:
                continue
            flat = memoryview(arr[slot]).cast("B")  # one big read, no copy
            got = 0
            while got < nbytes:
                r = stdout.readinto(flat[got:])
                if not r:
                    break
                got += r
            if got < nbytes:
                free_q.put(slot)
                break  # segment exhausted
            ready_q.put(slot)
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        shm.close()


class DecodePool:
    def __init__(self, video, duration, workers, batch, n_slots=64, register=False,
                 threads=0):
        self.batch = batch
        self.n_slots = n_slots
        self.threads = threads
        self.ctx = mp.get_context("spawn")  # children never inherit CUDA ctx
        self.shm = shared_memory.SharedMemory(
            create=True, size=n_slots * batch * FRAME_BYTES)
        self.arr = np.ndarray((n_slots, batch, IMGSZ, IMGSZ, CHANNELS),
                              dtype=np.uint8, buffer=self.shm.buf)
        # Register the shm as CUDA-pinned so the GPU can DMA frames directly out
        # of it — no per-batch host memcpy (which CFS-throttles under decoder load).
        self.tensor = None
        self._registered = False
        if register:
            t = torch.frombuffer(self.shm.buf, dtype=torch.uint8)
            import ctypes
            cudart = ctypes.CDLL("libcudart.so")
            rc = cudart.cudaHostRegister(ctypes.c_void_p(t.data_ptr()),
                                         ctypes.c_size_t(t.numel()), ctypes.c_uint(0))
            if rc == 0:
                self._registered = True
                self.tensor = t.view(n_slots, batch, IMGSZ, IMGSZ, CHANNELS)
            else:
                print(f"  WARNING: cudaHostRegister failed (rc={rc}); falling back to memcpy")
        self.free_q = self.ctx.Queue()
        self.ready_q = self.ctx.Queue()
        for s in range(n_slots):
            self.free_q.put(s)
        self.stop = self.ctx.Event()
        self.procs = []
        seg = duration / workers
        for w in range(workers):
            p = self.ctx.Process(
                target=decode_worker,
                args=(video, w * seg, seg, self.shm.name, n_slots, batch,
                      self.free_q, self.ready_q, self.stop, threads),
                daemon=True)
            p.start()
            self.procs.append(p)

    def get(self, timeout):
        return self.ready_q.get(timeout=timeout)

    def release(self, slot):
        self.free_q.put(slot)

    def view(self, slot):
        return self.arr[slot]

    def qsize(self):
        try:
            return self.ready_q.qsize()
        except Exception:
            return -1

    def slot_tensor(self, slot):
        return self.tensor[slot]

    def close(self):
        self.stop.set()
        for p in self.procs:
            try:
                p.terminate()
            except Exception:
                pass
        if self._registered:
            try:
                import ctypes
                t = torch.frombuffer(self.shm.buf, dtype=torch.uint8)
                ctypes.CDLL("libcudart.so").cudaHostUnregister(
                    ctypes.c_void_p(t.data_ptr()))
            except Exception:
                pass
        try:
            self.shm.close()
            self.shm.unlink()
        except Exception:
            pass


def _reader_thread(proc, batch, q, stop):
    """Thread: read big-batch chunks off one ffmpeg pipe into fresh numpy arrays."""
    stdout = proc.stdout
    nbytes = batch * FRAME_BYTES
    while not stop.is_set():
        buf = np.empty((batch, IMGSZ, IMGSZ, CHANNELS), dtype=np.uint8)
        flat = memoryview(buf).cast("B")
        got = 0
        while got < nbytes:
            r = stdout.readinto(flat[got:])
            if not r:
                break
            got += r
        if got < nbytes:
            break
        q.put(buf)
    try:
        proc.kill()
    except Exception:
        pass


class ThreadDecodePool:
    """Decoders as threads; frames handed over as numpy arrays (in-process)."""
    def __init__(self, video, duration, workers, batch, maxsize=64):
        self.batch = batch
        self.q = Queue(maxsize=maxsize)
        self.stop = threading.Event()
        self.procs, self.threads = [], []
        seg = duration / workers
        for w in range(workers):
            p = spawn_ffmpeg(video, w * seg, seg)
            t = threading.Thread(target=_reader_thread,
                                 args=(p, batch, self.q, self.stop), daemon=True)
            t.start()
            self.procs.append(p)
            self.threads.append(t)

    def get(self, timeout):
        return self.q.get(timeout=timeout)

    def view(self, tok):
        return tok

    def release(self, tok):
        pass

    def qsize(self):
        return self.q.qsize()

    def close(self):
        self.stop.set()
        for p in self.procs:
            try:
                p.kill()
            except Exception:
                pass


def make_pool(kind, video, duration, workers, batch, register=False, threads=0):
    if kind == "thread":
        return ThreadDecodePool(video, duration, workers, batch)
    return DecodePool(video, duration, workers, batch, register=register, threads=threads)


# ── Engine loading (strip ultralytics JSON metadata header) ────────────────────
def load_engine(path: Path):
    import tensorrt as trt
    logger = trt.Logger(trt.Logger.WARNING)
    trt.init_libnvinfer_plugins(logger, "")
    data = path.read_bytes()
    meta_len = struct.unpack_from("<I", data, 0)[0]
    engine_bytes = data
    if 0 < meta_len < len(data) - 4:
        try:
            import json
            meta = json.loads(data[4 : 4 + meta_len])
            print(f"  Engine metadata: {meta.get('description', '(none)')}")
            engine_bytes = data[4 + meta_len :]
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    engine = trt.Runtime(logger).deserialize_cuda_engine(engine_bytes)
    if engine is None:
        sys.exit(f"ERROR: failed to deserialize {path}")
    return engine


# ── GPU consumer: K-deep buffer pool on one ordered stream ─────────────────────
class GpuConsumer:
    def __init__(self, engine, batch: int, K: int = 4):
        import tensorrt as trt
        self.engine = engine
        self.batch = batch
        self.K = K
        self.context = engine.create_execution_context()

        names = [engine.get_tensor_name(i) for i in range(engine.num_io_tensors)]
        self.in_name = next(n for n in names
                            if engine.get_tensor_mode(n) == trt.TensorIOMode.INPUT)
        self.out_name = next(n for n in names
                             if engine.get_tensor_mode(n) == trt.TensorIOMode.OUTPUT)
        out_shape = tuple(engine.get_tensor_shape(self.out_name))

        self.stream = torch.cuda.Stream()
        self.pinned = [torch.empty((batch, IMGSZ, IMGSZ, CHANNELS),
                                   dtype=torch.uint8, pin_memory=True) for _ in range(K)]
        self.staging = [torch.empty((batch, IMGSZ, IMGSZ, CHANNELS),
                                    dtype=torch.uint8, device="cuda") for _ in range(K)]
        self.inp = [torch.empty((batch, CHANNELS, IMGSZ, IMGSZ),
                                dtype=torch.float32, device="cuda") for _ in range(K)]
        self.out = [torch.empty(out_shape, dtype=torch.float32, device="cuda")
                    for _ in range(K)]
        self.ev = [torch.cuda.Event() for _ in range(K)]
        self.graphs = [None] * K
        self._capture()
        self.k = 0
        self.slot_in = [None] * K  # which decode slot currently occupies each buffer

    def _infer(self, b):
        self.context.set_tensor_address(self.in_name, self.inp[b].data_ptr())
        self.context.set_tensor_address(self.out_name, self.out[b].data_ptr())
        self.context.execute_async_v3(torch.cuda.current_stream().cuda_stream)

    def _capture(self):
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
        """Copy a source batch into the next pinned buffer (host memcpy only).
        After this returns, the source (shm slot) is free to recycle."""
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()  # buffer b's prior compute done → safe to reuse
        self.pinned[b].copy_(torch.from_numpy(host_arr))  # host→pinned (CPU)
        return b

    def run_gpu(self, b: int):
        """Async H2D + normalize + CUDA-graph inference on one ordered stream."""
        with torch.cuda.stream(self.stream):
            self.staging[b].copy_(self.pinned[b], non_blocking=True)   # H2D
            self.inp[b].copy_(self.staging[b].permute(0, 3, 1, 2))     # uint8→fp32 CHW
            self.inp[b].div_(255.0)                                    # normalize
            self.graphs[b].replay()                                    # inference
            self.ev[b].record(self.stream)

    def submit(self, host_arr: np.ndarray):
        self.run_gpu(self.stage_host(host_arr))

    def feed(self, slot_tensor, slot):
        """Zero-host-copy path: DMA directly from pinned-shm slot to GPU, normalize,
        infer. Returns the decode slot evicted from this buffer (safe to recycle
        because ev[b] guards that its H2D already completed), or None."""
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()           # buffer b's prior H2D+compute done
        evicted = self.slot_in[b]
        self.slot_in[b] = slot
        with torch.cuda.stream(self.stream):
            self.staging[b].copy_(slot_tensor, non_blocking=True)   # DMA from pinned shm
            self.inp[b].copy_(self.staging[b].permute(0, 3, 1, 2))
            self.inp[b].div_(255.0)
            self.graphs[b].replay()
            self.ev[b].record(self.stream)
        return evicted

    def sync(self):
        self.stream.synchronize()


# ── Benchmarks ─────────────────────────────────────────────────────────────────
def bench_inference_only(c: GpuConsumer, iters: int) -> float:
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.cuda.stream(c.stream):
        for _ in range(iters):
            c.graphs[0].replay()
    torch.cuda.synchronize()
    return iters * c.batch / (time.perf_counter() - t0)


def bench_consumer_ring(c: GpuConsumer, batch: int, iters: int, warmup=50) -> float:
    ring = [np.random.randint(0, 255, (batch, IMGSZ, IMGSZ, CHANNELS), dtype=np.uint8)
            for _ in range(32)]
    t0 = None
    for i in range(warmup + iters):
        c.submit(ring[i % len(ring)])
        if i == warmup:
            c.sync()
            t0 = time.perf_counter()
    c.sync()
    return iters * batch / (time.perf_counter() - t0)


def bench_decode_only(kind, video, duration, workers, batch, max_batches, threads=0) -> tuple:
    pool = make_pool(kind, video, duration, workers, batch, threads=threads)
    got = 0
    t_first = t_last = None
    try:
        while got < max_batches:
            try:
                slot = pool.get(timeout=10)
            except Exception:
                break
            now = time.perf_counter()
            if t_first is None:
                t_first = now
            t_last = now
            pool.release(slot)
            got += 1
    finally:
        pool.close()
    dt = (t_last - t_first) if (t_first and got > 1) else 1e9
    return (got - 1) * batch / dt, got


def bench_combined(kind, c, video, duration, workers, batch, max_batches, warmup,
                   threads=0) -> tuple:
    # proc pool: register shm as pinned so the consumer DMAs directly (no host memcpy)
    pool = make_pool(kind, video, duration, workers, batch, register=(kind == "proc"),
                     threads=threads)
    zero_copy = (kind == "proc" and pool._registered)
    processed = 0
    t0 = None
    qsum = qn = 0
    t_get = t_sub = 0.0
    try:
        while processed < warmup + max_batches:
            ta = time.perf_counter()
            try:
                slot = pool.get(timeout=10)
            except Exception:
                break
            tb = time.perf_counter()
            if zero_copy:
                evicted = c.feed(pool.slot_tensor(slot), slot)  # DMA from pinned shm
                if evicted is not None:
                    pool.release(evicted)
            else:
                buf = c.stage_host(pool.view(slot)); pool.release(slot); c.run_gpu(buf)
            tc = time.perf_counter()
            if processed >= warmup:
                qsum += pool.qsize(); qn += 1
                t_get += tb - ta; t_sub += tc - tb
            processed += 1
            if processed == warmup:
                c.sync()
                t0 = time.perf_counter()
        c.sync()
    finally:
        dt = (time.perf_counter() - t0) if t0 else 0.0
        pool.close()
    measured = processed - warmup
    thr = measured * batch / dt if dt > 0 else 0.0
    avgq = qsum / qn if qn else -1
    if measured > 0:
        print(f"    [breakdown] wait-for-frame {1000*t_get/measured:.2f} ms/batch | "
              f"submit {1000*t_sub/measured:.2f} ms/batch")
    return thr, measured, avgq


def banner(t):
    print(f"\n{'=' * 60}\n  {t}\n{'=' * 60}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("engine", nargs="?", default="yolo26x-pose-int8-b16.engine")
    ap.add_argument("--video", default="/root/long.mp4")
    ap.add_argument("--workers", type=int, default=int(os.environ.get("DECODE_WORKERS", "16")))
    ap.add_argument("--batches", type=int, default=600)
    ap.add_argument("--warmup", type=int, default=50)
    ap.add_argument("--bufs", type=int, default=4)
    ap.add_argument("--decode", choices=["thread", "proc"], default="thread")
    args = ap.parse_args()

    banner("Environment")
    import tensorrt as trt
    props = torch.cuda.get_device_properties(0)
    print(f"  GPU:          {props.name}  (sm_{props.major}{props.minor})")
    print(f"  TensorRT:     {trt.__version__}   PyTorch: {torch.__version__}")
    print(f"  CPU cores:    {os.cpu_count()}   decode workers: {args.workers} "
          f"({args.decode})   consumer bufs: {args.bufs}")
    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nokey=1:noprint_wrappers=1", args.video]).decode().strip())
    print(f"  Video:        {args.video}  ({dur:.0f}s)")

    engine = load_engine(Path(args.engine))
    eb = int(engine.get_tensor_shape(engine.get_tensor_name(0))[0])
    print(f"  Engine batch: {eb}")
    c = GpuConsumer(engine, eb, K=args.bufs)

    banner(f"Pipeline benchmark  batch={eb}  imgsz={IMGSZ}")
    inf = bench_inference_only(c, args.batches)
    print(f"  inference-only (GPU ceiling):   {inf:8.1f} img/s")
    cons = bench_consumer_ring(c, eb, args.batches)
    print(f"  consumer-only (stage+infer):    {cons:8.1f} img/s   (no decoders)")
    dec, ndec = bench_decode_only(args.decode, args.video, dur, args.workers, eb,
                                  args.batches)
    print(f"  decode-only  ({args.workers}w/{args.decode}):        {dec:8.1f} img/s")
    comb, nmeas, avgq = bench_combined(args.decode, c, args.video, dur, args.workers,
                                       eb, args.batches, args.warmup)
    print(f"  combined (end-to-end):          {comb:8.1f} img/s   "
          f"(avg ready-queue depth {avgq:.1f})")

    banner("Summary")
    ceil = min(cons, dec)
    eff = 100 * comb / inf if inf else 0
    if comb >= ceil * 0.95:
        verdict = f"pipeline near its {('consumer' if cons < dec else 'decode')} ceiling ✅"
    elif avgq < 2:
        verdict = "DECODE-BOUND ⚠️ (ready queue starved)"
    else:
        verdict = "CONSUMER-BOUND ⚠️ (queue full, GPU-feed path is the cap)"
    print(f"  decode ceiling:     {dec:8.1f} img/s")
    print(f"  consumer ceiling:   {cons:8.1f} img/s")
    print(f"  inference ceiling:  {inf:8.1f} img/s")
    print(f"  combined:           {comb:8.1f} img/s   ({eff:.0f}% of GPU ceiling)")
    print(f"  bottleneck:         {verdict}")
    print(f"  peak VRAM:          {torch.cuda.max_memory_allocated()/2**30:.2f} GB")
    print("=" * 60)


if __name__ == "__main__":
    main()
