"""
CPU-decode worker calibration for the serverless pose pipeline.

Goal: pick the SMALLEST number of decoder workers that lets CPU decode clear the
GPU inference ceiling, given the container's real vCPU budget — without an
expensive N-point sweep.

Method (O(1), one probe — not a sweep):
  1. effective vCPUs   : cgroup/cpuset-aware (os.cpu_count() lies in containers)
  2. GPU ceiling       : measured once via CUDA-graph replay (or --ceiling)
  3. single-stream fps : time ONE `-threads 1` ffmpeg on a short prefix of the
                         actual input, two-point timing to cancel startup/seek
  4. workers           : clamp(ceil(ceiling / single_fps * safety), 1, vcpus-1)

We pin `-threads 1` so N workers scale ~linearly with cores (no ffmpeg
internal-thread oversubscription) and the recommendation ports to the deploy
shape. Reserve 1 core for the consumer (normalize + H2D).

Usage:
  python calibrate_workers.py --video V [--engine E | --ceiling F]
        [--vcpus N] [--threads 1] [--safety 1.15] [--probe 256] [--verify]
"""
import argparse
import math
import os
import subprocess
import sys
import time
from pathlib import Path

from pipeline_decode import (FRAME_BYTES, IMGSZ, GpuConsumer, bench_combined,
                             bench_decode_only, bench_inference_only, load_engine)

LB_VF = (f"scale={IMGSZ}:{IMGSZ}:force_original_aspect_ratio=decrease,"
         f"pad={IMGSZ}:{IMGSZ}:(ow-iw)/2:(oh-ih)/2")

# In-pool per-worker throughput is below a bare ffmpeg stream: the shm ring,
# the free/ready queues, and the consumer all contend for CPU/mem bandwidth.
# Measured ~0.8 (640² frames, so ~independent of source resolution). We derate
# the bare-probe rate by this so the estimate matches the real pool and biases
# slightly high — over-provisioning is safe with -threads 1 below core count.
POOL_EFF = 0.80


def effective_cpus() -> int:
    """vCPUs actually usable: min(cpuset affinity, cgroup CFS quota)."""
    cands = []
    try:
        cands.append(len(os.sched_getaffinity(0)))
    except Exception:
        cands.append(os.cpu_count() or 1)
    # cgroup v2
    try:
        q = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if q[0] != "max":
            cands.append(max(1, round(float(q[0]) / float(q[1]))))
    except Exception:
        pass
    # cgroup v1
    try:
        quota = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text())
        period = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text())
        if quota > 0:
            cands.append(max(1, round(quota / period)))
    except Exception:
        pass
    return max(1, min(cands))


def probe_single_stream(video, threads, na, nb) -> float:
    """Frames/sec of one ffmpeg decode stream; two-point timing removes the
    fixed ffmpeg startup + seek cost so we measure steady-state decode."""
    def run(n):
        cmd = ["ffmpeg", "-loglevel", "error", "-threads", str(threads),
               "-i", video, "-an", "-sn", "-vf", LB_VF,
               "-frames:v", str(n), "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
        t0 = time.perf_counter()
        raw = subprocess.run(cmd, capture_output=True).stdout
        return len(raw) // FRAME_BYTES, time.perf_counter() - t0
    ga, ta = run(na)
    gb, tb = run(nb)
    if gb > ga and tb > ta:
        return (gb - ga) / (tb - ta)         # steady-state
    return (ga / ta) if ta > 0 else 0.0      # fallback (short clip)


def measure_ceiling(engine_path) -> tuple:
    eng = load_engine(Path(engine_path))
    batch = int(eng.get_tensor_shape(eng.get_tensor_name(0))[0])
    c = GpuConsumer(eng, batch, K=4)
    fps = bench_inference_only(c, 800)
    return fps, batch, c, eng


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--engine", default="yolo26x-pose-int8-b16.engine")
    ap.add_argument("--ceiling", type=float, default=None,
                    help="skip GPU measurement, use this img/s")
    ap.add_argument("--vcpus", type=int, default=None, help="override detected vCPUs")
    ap.add_argument("--threads", type=int, default=1, help="ffmpeg threads per worker")
    ap.add_argument("--safety", type=float, default=1.15)
    ap.add_argument("--probe", type=int, default=256, help="prefix frames (a; b=2a)")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    dur = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nk=1:nw=1", args.video]).decode().strip())
    res = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "default=nk=1:nw=1",
        args.video]).decode().split()

    vcpus = args.vcpus or effective_cpus()
    print(f"=== Calibration ===")
    print(f"  video         {args.video}  ({res[0]}x{res[1]}, {dur:.0f}s)")
    print(f"  effective vCPUs {vcpus}" + ("  (overridden)" if args.vcpus else "  (detected)"))

    # 1) GPU ceiling
    consumer = engine = None
    if args.ceiling:
        ceiling, batch = args.ceiling, None
        print(f"  GPU ceiling   {ceiling:.0f} img/s  (given)")
    else:
        ceiling, batch, consumer, engine = measure_ceiling(args.engine)
        print(f"  GPU ceiling   {ceiling:.0f} img/s  (measured, batch={batch})")

    # 2) single-stream decode probe
    na = min(args.probe, max(32, 0))
    nb = min(args.probe * 2, 10_000)
    single = probe_single_stream(args.video, args.threads, na, nb)
    per_worker = single * POOL_EFF
    print(f"  single stream {single:.0f} img/s  (1 ffmpeg, -threads {args.threads});"
          f"  in-pool est {per_worker:.0f} img/s/worker (×{POOL_EFF})")

    # 3) formula
    cap = max(1, vcpus - 1)            # reserve 1 core for the consumer
    needed = math.ceil(ceiling / per_worker * args.safety) if per_worker > 0 else cap
    workers = min(needed, cap)
    predicted = workers * per_worker
    bound = ("GPU-bound — decode has headroom" if needed <= cap
             else f"CPU-DECODE-BOUND — vCPU-limited (need {needed}, capped at {cap})")
    print(f"\n  workers needed to clear ceiling (×{args.safety}):  {needed}")
    print(f"  RECOMMENDED workers:                          {workers}")
    print(f"  predicted decode @ {workers}w:                 {predicted:.0f} img/s")
    print(f"  predicted end-to-end:                         {min(predicted, ceiling):.0f} img/s")
    print(f"  regime:                                       {bound}")

    # 4) optional verify (real pool, pinned -threads)
    if args.verify:
        if consumer is None:
            ceiling, batch, consumer, engine = measure_ceiling(args.engine)
        print(f"\n=== Verify (proc pool, -threads {args.threads}) ===")
        for w in sorted({max(1, workers - 1), workers, workers + 1}):
            if w >= vcpus:
                continue
            dfps, _ = bench_decode_only("proc", args.video, dur, w, batch, 200,
                                        threads=args.threads)
            print(f"  {w}w  decode-only {dfps:7.1f} img/s"
                  f"  ({'clears' if dfps >= ceiling else 'below'} ceiling)")
        comb, _, q = bench_combined("proc", consumer, args.video, dur, workers,
                                    batch, 200, 30, threads=args.threads)
        print(f"  {workers}w combined  {comb:7.1f} img/s  (queue depth {q:.0f}) "
              f"= {100*comb/ceiling:.0f}% of ceiling")


if __name__ == "__main__":
    main()
