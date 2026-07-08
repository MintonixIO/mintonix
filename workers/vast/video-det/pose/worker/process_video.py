"""
Serverless pose-estimation worker: decode an entire video on the CPU, run the
INT8 yolo26x-pose TensorRT engine on the GPU, and write every detection to a
single results file.

Pipeline (reuses the proven fast path from pipeline_decode.py):
  1. CALIBRATE  — detect the container's real vCPU budget (cgroup-aware) and
     pick the decoder-worker count from a sub-second single-stream probe so CPU
     decode just clears the GPU ceiling. No N-point sweep.
  2. DECODE     — `workers` ffmpeg processes, each owning a contiguous time
     segment, letterbox to 640x640 and stream frames into a shared-memory ring
     registered as CUDA-pinned (zero host memcpy → DMA straight to the GPU).
  3. INFER      — one ordered CUDA stream, K-deep CUDA-graph buffer pool.
  4. CAPTURE    — every batch's output is copied back, un-letterboxed to the
     ORIGINAL resolution, conf-thresholded, and appended as detection rows.
  5. SAVE       — a compressed .npz (+ .json summary sidecar).

Output .npz:
  dets   : (N, 57) float32 rows = [frame_idx, x1,y1,x2,y2, conf, 17*(kx,ky,kconf)]
           in ORIGINAL pixel coords. Only detections above --conf are kept.
  meta   : JSON string (orig HxW, fps, conf, source frame count, throughput …)

Usage:
  python process_video.py --video V --out poses.npz [--engine E]
        [--ceiling 1040] [--conf 0.25] [--workers N] [--vcpus N] [--threads 1]
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time
from multiprocessing import shared_memory
from pathlib import Path
from queue import Empty

import numpy as np
import torch

# Proven primitives — single source of truth, no drift.
from pipeline_decode import (CHANNELS, FRAME_BYTES, IMGSZ, GpuConsumer,
                             bench_inference_only, load_engine, spawn_ffmpeg)
from calibrate_workers import POOL_EFF, effective_cpus, probe_single_stream

import multiprocessing as mp


# ── frame-indexed decode worker / pool ─────────────────────────────────────────
# Like pipeline_decode.DecodePool but each ready item carries the global frame
# index of the batch's first frame, and every worker emits a (-1, wid) sentinel
# on exit so the consumer knows when all producers are done. Kept separate to
# leave the benchmark's queue contract (bare slot ints) untouched.
def decode_worker_indexed(video, start_s, dur_s, base_frame, shm_name, n_slots,
                          batch, free_q, ready_q, stop_evt, wid, threads=1):
    shm = shared_memory.SharedMemory(name=shm_name)
    arr = np.ndarray((n_slots, batch, IMGSZ, IMGSZ, CHANNELS), np.uint8, buffer=shm.buf)
    proc = spawn_ffmpeg(video, start_s, dur_s, threads=threads)
    stdout = proc.stdout
    nbytes = batch * FRAME_BYTES
    emitted = 0
    try:
        while not stop_evt.is_set():
            try:
                slot = free_q.get(timeout=0.5)
            except Exception:
                continue
            flat = memoryview(arr[slot]).cast("B")
            got = 0
            while got < nbytes:
                r = stdout.readinto(flat[got:])
                if not r:
                    break
                got += r
            if got < nbytes:           # segment exhausted (partial tail dropped)
                free_q.put(slot)
                break
            ready_q.put((slot, base_frame + emitted * batch))
            emitted += 1
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        shm.close()
        try:
            ready_q.put((-1, wid))     # sentinel: this producer is done
        except Exception:
            pass


class IndexedDecodePool:
    def __init__(self, video, duration, workers, batch, fps, n_slots=32,
                 register=True, threads=1):
        self.batch = batch
        self.n_slots = n_slots
        self.ctx = mp.get_context("spawn")
        self.shm = shared_memory.SharedMemory(
            create=True, size=n_slots * batch * FRAME_BYTES)
        self.arr = np.ndarray((n_slots, batch, IMGSZ, IMGSZ, CHANNELS),
                              dtype=np.uint8, buffer=self.shm.buf)
        # Register the ring as CUDA-pinned → GPU DMAs frames directly out of it
        # (no per-batch host memcpy, which CFS-throttles under decoder load).
        self.tensor = None
        self._registered = False
        if register:
            import ctypes
            t = torch.frombuffer(self.shm.buf, dtype=torch.uint8)
            rc = ctypes.CDLL("libcudart.so").cudaHostRegister(
                ctypes.c_void_p(t.data_ptr()), ctypes.c_size_t(t.numel()),
                ctypes.c_uint(0))
            if rc == 0:
                self._registered = True
                self.tensor = t.view(n_slots, batch, IMGSZ, IMGSZ, CHANNELS)
            else:
                print(f"  WARNING: cudaHostRegister failed (rc={rc}); "
                      f"using host-copy path")
        self.free_q = self.ctx.Queue()
        self.ready_q = self.ctx.Queue()
        for s in range(n_slots):
            self.free_q.put(s)
        self.stop = self.ctx.Event()
        self.procs = []
        seg = duration / workers
        for w in range(workers):
            base = int(round(w * seg * fps))
            p = self.ctx.Process(
                target=decode_worker_indexed,
                args=(video, w * seg, seg, base, self.shm.name, n_slots, batch,
                      self.free_q, self.ready_q, self.stop, w, threads),
                daemon=True)
            p.start()
            self.procs.append(p)

    def get(self, timeout):
        return self.ready_q.get(timeout=timeout)

    def release(self, slot):
        self.free_q.put(slot)

    def view(self, slot):
        return self.arr[slot]

    def slot_tensor(self, slot):
        return self.tensor[slot]

    def any_alive(self):
        return any(p.is_alive() for p in self.procs)

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


# ── consumer that captures + un-letterboxes every output ───────────────────────
class CaptureConsumer(GpuConsumer):
    """GpuConsumer that, before reusing a buffer, copies its (now-complete)
    output back to the host, un-letterboxes to original coords, conf-thresholds,
    and appends detection rows. Each buffer's result is emitted exactly once:
    at its next reuse, or at flush() for the final K buffers."""

    def setup_capture(self, scale, pad_x, pad_y, conf):
        self.scale, self.pad_x, self.pad_y, self.conf = scale, pad_x, pad_y, conf
        self.meta_in = [None] * self.K        # frame_base currently held in out[b]
        self.rows = []
        self.frames_seen = 0
        self.frames_with_dets = 0

    def _emit(self, frame_base, res):
        # res: (batch, 300, 57) cols = [x1,y1,x2,y2, conf, cls, 17*(kx,ky,kconf)]
        for bi in range(self.batch):
            d = res[bi]
            m = d[:, 4] > self.conf
            self.frames_seen += 1
            n = int(m.sum())
            if n == 0:
                continue
            dd = d[m]
            rows = np.empty((n, 57), np.float32)
            rows[:, 0] = frame_base + bi                       # global frame index
            rows[:, 1] = (dd[:, 0] - self.pad_x) / self.scale  # x1
            rows[:, 2] = (dd[:, 1] - self.pad_y) / self.scale  # y1
            rows[:, 3] = (dd[:, 2] - self.pad_x) / self.scale  # x2
            rows[:, 4] = (dd[:, 3] - self.pad_y) / self.scale  # y2
            rows[:, 5] = dd[:, 4]                              # conf
            kp = dd[:, 6:57].reshape(n, 17, 3).copy()
            kp[:, :, 0] = (kp[:, :, 0] - self.pad_x) / self.scale
            kp[:, :, 1] = (kp[:, :, 1] - self.pad_y) / self.scale
            rows[:, 6:] = kp.reshape(n, 51)
            self.rows.append(rows)
            self.frames_with_dets += 1

    def feed_capture(self, slot_tensor, slot, frame_base):
        """Zero-copy: DMA from the pinned ring slot. Returns the decode slot
        evicted from this buffer (safe to recycle), or None."""
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()             # prior H2D + compute on buffer b done
        if self.meta_in[b] is not None:      # capture prior result before overwrite
            self._emit(self.meta_in[b], self.out[b].cpu().numpy())
        evicted = self.slot_in[b]
        self.slot_in[b] = slot
        self.meta_in[b] = frame_base
        with torch.cuda.stream(self.stream):
            self.staging[b].copy_(slot_tensor, non_blocking=True)
            self.inp[b].copy_(self.staging[b].permute(0, 3, 1, 2))
            self.inp[b].div_(255.0)
            self.graphs[b].replay()
            self.ev[b].record(self.stream)
        return evicted

    def feed_capture_host(self, host_arr, frame_base):
        """Host-copy fallback (when cudaHostRegister is unavailable)."""
        b = self.k
        self.k = (self.k + 1) % self.K
        self.ev[b].synchronize()
        if self.meta_in[b] is not None:
            self._emit(self.meta_in[b], self.out[b].cpu().numpy())
        self.meta_in[b] = frame_base
        self.pinned[b].copy_(torch.from_numpy(host_arr))
        self.run_gpu(b)

    def flush(self):
        """Drain the final K buffers that were never reused."""
        self.sync()
        # emit in chronological order of the rolling buffer
        for off in range(self.K):
            b = (self.k + off) % self.K
            if self.meta_in[b] is not None:
                self._emit(self.meta_in[b], self.out[b].cpu().numpy())
                self.meta_in[b] = None


# ── main ───────────────────────────────────────────────────────────────────────
def probe_video(video):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
        "-show_entries", "format=duration",
        "-of", "default=nk=1:nw=1", video]).decode().split()
    w, h = int(out[0]), int(out[1])
    num, den = out[2].split("/")
    fps = float(num) / float(den)
    nb_frames = int(out[3]) if out[3].isdigit() else None
    dur = float(out[4])
    return w, h, fps, nb_frames, dur


def calibrate(video, vcpus, ceiling, threads, safety, probe):
    single = probe_single_stream(video, threads, min(probe, 256), min(probe * 2, 10_000))
    per_worker = single * POOL_EFF
    cap = max(1, vcpus - 1)                  # reserve 1 core for the consumer
    needed = math.ceil(ceiling / per_worker * safety) if per_worker > 0 else cap
    workers = min(needed, cap)
    bound = "GPU-bound (decode has headroom)" if needed <= cap \
        else f"CPU-DECODE-BOUND (need {needed}, capped at {cap})"
    return workers, single, per_worker, needed, bound


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="/out/poses.npz")
    ap.add_argument("--engine", default="/app/yolo26x-pose-int8-b16.engine")
    ap.add_argument("--conf", type=float, default=0.15)
    ap.add_argument("--ceiling", type=float, default=1040.0,
                    help="GPU img/s ceiling; 0 = measure at startup")
    ap.add_argument("--vcpus", type=int, default=None)
    ap.add_argument("--workers", type=int, default=None,
                    help="override calibration")
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--safety", type=float, default=1.15)
    ap.add_argument("--probe", type=int, default=256)
    ap.add_argument("--slots", type=int, default=32)
    args = ap.parse_args()

    if not Path(args.video).exists():
        sys.exit(f"ERROR: input video not found: {args.video}")

    W, H, fps, nb_frames, dur = probe_video(args.video)
    scale = min(IMGSZ / W, IMGSZ / H)
    pad_x, pad_y = (IMGSZ - W * scale) / 2.0, (IMGSZ - H * scale) / 2.0
    vcpus = args.vcpus or effective_cpus()

    print("=" * 64)
    print(f"  input        {args.video}")
    print(f"  resolution   {W}x{H}  {fps:.3f} fps  {dur:.0f}s  "
          f"{nb_frames if nb_frames else '?'} frames")
    print(f"  vCPUs        {vcpus} "
          f"({'overridden' if args.vcpus else 'cgroup-detected'})")

    # 1) load engine + build CUDA-graph consumer (model load — unavoidable)
    t_load = time.perf_counter()
    engine = load_engine(Path(args.engine))
    batch = int(engine.get_tensor_shape(engine.get_tensor_name(0))[0])
    consumer = CaptureConsumer(engine, batch, K=4)
    print(f"  engine       batch={batch}  loaded+captured in "
          f"{time.perf_counter() - t_load:.1f}s")

    # GPU ceiling (baked by default → skip measurement for fast cold start)
    ceiling = args.ceiling
    if ceiling <= 0:
        ceiling = bench_inference_only(consumer, 800)
        print(f"  GPU ceiling  {ceiling:.0f} img/s (measured)")
    else:
        print(f"  GPU ceiling  {ceiling:.0f} img/s (baked)")

    # 2) calibrate decoder workers
    if args.workers:
        workers = args.workers
        print(f"  workers      {workers} (overridden)")
    else:
        workers, single, per_w, needed, bound = calibrate(
            args.video, vcpus, ceiling, args.threads, args.safety, args.probe)
        print(f"  single-stream {single:.0f} img/s  (1 ffmpeg, -threads {args.threads})")
        print(f"  workers      {workers}  (need {needed} to clear ceiling; {bound})")
    print("=" * 64)

    # 3) run the full video
    consumer.setup_capture(scale, pad_x, pad_y, args.conf)
    pool = IndexedDecodePool(args.video, dur, workers, batch, fps,
                             n_slots=max(args.slots, 4 * workers, 8),
                             register=True, threads=args.threads)
    zero_copy = pool._registered
    finished = 0
    t0 = time.perf_counter()
    while True:
        to = 10.0 if finished < workers else 0.5
        try:
            slot, fb = pool.get(timeout=to)
        except Empty:
            if finished >= workers or not pool.any_alive():
                break
            continue
        if slot < 0:                          # sentinel
            finished += 1
            continue
        if zero_copy:
            evicted = consumer.feed_capture(pool.slot_tensor(slot), slot, fb)
            if evicted is not None:
                pool.release(evicted)
        else:
            consumer.feed_capture_host(pool.view(slot).copy(), fb)
            pool.release(slot)
    consumer.flush()
    elapsed = time.perf_counter() - t0
    pool.close()

    # 4) assemble + save
    dets = (np.vstack(consumer.rows) if consumer.rows
            else np.zeros((0, 57), np.float32))
    thr = consumer.frames_seen / elapsed if elapsed > 0 else 0.0
    coverage = (consumer.frames_seen / nb_frames) if nb_frames else None
    summary = {
        "input": args.video,
        "orig_hw": [H, W],
        "fps": fps,
        "duration_s": dur,
        "source_frames": nb_frames,
        "frames_processed": consumer.frames_seen,
        "frames_with_dets": consumer.frames_with_dets,
        "total_detections": int(dets.shape[0]),
        "coverage": coverage,
        "conf_thresh": args.conf,
        "decode_workers": workers,
        "vcpus": vcpus,
        "throughput_img_s": round(thr, 1),
        "elapsed_s": round(elapsed, 2),
        "zero_copy_dma": zero_copy,
        "cols": "frame_idx,x1,y1,x2,y2,conf,17*(kx,ky,kconf)",
        "coord_space": "original_resolution",
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, dets=dets, meta=json.dumps(summary))
    out.with_suffix(".json").write_text(json.dumps(summary, indent=2))

    print(f"\n  processed {consumer.frames_seen} frames in {elapsed:.1f}s  "
          f"→ {thr:.0f} img/s")
    if coverage is not None:
        flag = "" if coverage >= 0.97 else "  ⚠️ (boundary/tail frames dropped)"
        print(f"  coverage  {consumer.frames_seen}/{nb_frames} "
              f"= {100 * coverage:.1f}%{flag}")
    print(f"  {dets.shape[0]} detections in {consumer.frames_with_dets} frames")
    print(f"  saved {out}  and  {out.with_suffix('.json')}")
    print("=" * 64)


if __name__ == "__main__":
    main()
