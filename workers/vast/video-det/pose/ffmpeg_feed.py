"""Multi-ffmpeg → pinned SHM → CUDA-graph pose video feed.

Product feed path: decode overlaps on CPU processes while pose clears the GPU.
Postprocess is the shared `decode_pose_*` path from `engine.py` (no duplicated
Ultralytics unletterbox / conf logic here).
"""
from __future__ import annotations

import logging
import math
import os
import subprocess
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .decode_pool import Empty, IndexedDecodePool, frame_bytes, letterbox_vf
from .engine import DEFAULT_CONF, EngineDetection, decode_pose_batch
from .letterbox import LetterboxMeta, letterbox_params
from .trt_runtime import GpuConsumer, load_engine

log = logging.getLogger("video-det.ffmpeg_feed")

POOL_EFF = 0.80


def effective_cpus() -> int:
    cands: list[int] = []
    try:
        cands.append(len(os.sched_getaffinity(0)))
    except Exception:
        cands.append(os.cpu_count() or 1)
    try:
        q = Path("/sys/fs/cgroup/cpu.max").read_text().split()
        if q[0] != "max":
            cands.append(max(1, round(float(q[0]) / float(q[1]))))
    except Exception:
        pass
    try:
        quota = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text())
        period = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text())
        if quota > 0:
            cands.append(max(1, round(quota / period)))
    except Exception:
        pass
    return max(1, min(cands) if cands else 1)


def probe_video(video: str) -> tuple[int, int, float, int | None, float]:
    out = (
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate,nb_frames",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nk=1:nw=1",
                video,
            ]
        )
        .decode()
        .split()
    )
    w, h = int(out[0]), int(out[1])
    num, den = out[2].split("/")
    fps = float(num) / float(den)
    nb_frames = int(out[3]) if out[3].isdigit() else None
    dur = float(out[4])
    return w, h, fps, nb_frames, dur


def probe_single_stream(
    video: str,
    threads: int,
    na: int,
    nb: int,
    *,
    imgsz: int,
) -> float:
    fb = frame_bytes(imgsz)
    vf = letterbox_vf(imgsz)

    def run(n: int) -> tuple[int, float]:
        cmd = [
            "ffmpeg",
            "-loglevel",
            "error",
            "-threads",
            str(threads),
            "-i",
            video,
            "-an",
            "-sn",
            "-vf",
            vf,
            "-frames:v",
            str(n),
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ]
        t0 = time.perf_counter()
        raw = subprocess.run(cmd, capture_output=True).stdout
        return len(raw) // fb, time.perf_counter() - t0

    ga, ta = run(na)
    gb, tb = run(nb)
    if gb > ga and tb > ta:
        return (gb - ga) / (tb - ta)
    return (ga / ta) if ta > 0 else 0.0


def calibrate_workers(
    video: str,
    *,
    ceiling: float,
    imgsz: int,
    vcpus: int | None = None,
    threads: int = 1,
    safety: float = 1.15,
    probe: int = 256,
) -> tuple[int, dict[str, Any]]:
    v = vcpus or effective_cpus()
    single = probe_single_stream(
        video, threads, min(probe, 256), min(probe * 2, 10_000), imgsz=imgsz
    )
    per_worker = single * POOL_EFF
    cap = max(1, v - 1)
    needed = math.ceil(ceiling / per_worker * safety) if per_worker > 0 else cap
    workers = min(needed, cap)
    meta = {
        "vcpus": v,
        "single_stream_fps": round(single, 1),
        "per_worker_est": round(per_worker, 1),
        "needed": needed,
        "workers": workers,
        "ceiling": ceiling,
        "imgsz": imgsz,
        "bound": (
            "GPU-bound"
            if needed <= cap
            else f"CPU-DECODE-BOUND need={needed} cap={cap}"
        ),
    }
    return workers, meta


class CaptureConsumer(GpuConsumer):
    """GpuConsumer that D2H-captures TRT outputs and decodes via engine helpers.

    GPU normalize + graph paths are inherited (`feed` / `run_gpu`); this subclass
    only tracks per-buffer frame bases and runs shared postprocess.
    """

    def setup_capture(self, meta: LetterboxMeta, conf: float) -> None:
        self.lb_meta = meta
        self.conf = conf
        # frame_base (int) or None per graph buffer
        self.meta_in: list = [None] * self.K
        # n_valid frames for that buffer (pad-aware); None → full batch
        self.n_valid_in: list = [None] * self.K
        # frame_idx -> list[EngineDetection]
        self.by_frame: dict[int, list[EngineDetection]] = {}
        self.frames_seen = 0

    def _emit(self, frame_base: int, res: np.ndarray, n_valid: int | None) -> None:
        """D2H result already on host; decode only real (non-pad) slots."""
        n = self.batch if n_valid is None else int(n_valid)
        n = max(0, min(n, self.batch, int(res.shape[0])))
        if n <= 0:
            return
        metas = [self.lb_meta] * n
        batch_dets = decode_pose_batch(res[:n], metas, self.conf)
        for bi, dets in enumerate(batch_dets):
            self.by_frame[frame_base + bi] = dets
            self.frames_seen += 1

    def _drain_buffer(self, b: int) -> None:
        if self.meta_in[b] is None:
            return
        raw = self.out[b].detach().float().cpu().numpy()
        self._emit(self.meta_in[b], raw, self.n_valid_in[b])
        self.meta_in[b] = None
        self.n_valid_in[b] = None

    def feed_capture(
        self, slot_tensor, slot: int, frame_base: int, n_valid: int | None = None
    ):
        """Zero-copy slot feed + track frame_base for later D2H decode."""
        b = self.k
        self.ev[b].synchronize()
        self._drain_buffer(b)
        self.meta_in[b] = frame_base
        self.n_valid_in[b] = n_valid
        return self.feed(slot_tensor, slot)

    def feed_capture_host(
        self,
        host_arr: np.ndarray,
        frame_base: int,
        n_valid: int | None = None,
    ) -> None:
        """Host-copy path when SHM is not cudaHostRegistered.

        Uses base `stage_host` + `run_gpu` (no reimplemented normalize/graph).
        """
        b = self.k
        self.ev[b].synchronize()
        self._drain_buffer(b)
        self.meta_in[b] = frame_base
        self.n_valid_in[b] = n_valid
        b2 = self.stage_host(host_arr)
        # stage_host re-syncs the same buffer and advances k.
        self.run_gpu(b2)

    def flush(self) -> None:
        self.sync()
        for off in range(self.K):
            b = (self.k + off) % self.K
            self._drain_buffer(b)


def _engine_imgsz(engine) -> tuple[int, int]:
    """Return (batch, imgsz) from TRT engine input tensor shape (NCHW)."""
    in_name = engine.get_tensor_name(0)
    shape = tuple(engine.get_tensor_shape(in_name))
    batch = int(shape[0])
    if len(shape) == 4:
        h, w = int(shape[2]), int(shape[3])
        if h != w:
            raise ValueError(f"expected square pose input, got HxW={h}x{w}")
        return batch, h
    raise ValueError(f"unexpected pose engine input shape {shape}")


def run_ffmpeg_pose(
    video_path: str | Path,
    engine_path: str | Path,
    *,
    conf: float = DEFAULT_CONF,
    ceiling: float | None = None,
    workers: int | None = None,
    threads: int = 1,
    graph_depth: int = 4,
) -> tuple[dict[int, list[EngineDetection]], dict[str, Any]]:
    """Run the multi-ffmpeg pose pipeline.

    Returns (by_frame detections in original pixels, run meta).
    Only real decoded frames are present in `by_frame` (partial last batches are
    padded for TRT but pad slots are not emitted as product frames).
    """
    video = str(video_path)
    W, H, fps, nb_frames, dur = probe_video(video)

    engine = load_engine(Path(engine_path))
    batch, imgsz = _engine_imgsz(engine)
    meta_lb = letterbox_params(H, W, imgsz)
    consumer = CaptureConsumer(engine, batch, K=graph_depth, imgsz=imgsz)

    ceil = ceiling
    if ceil is None:
        ceil = float(os.environ.get("POSE_CEILING", "1040") or "1040")
    if ceil <= 0:
        t0 = time.perf_counter()
        with torch.cuda.stream(consumer.stream):
            for _ in range(200):
                consumer.graphs[0].replay()
        consumer.sync()
        ceil = 200 * batch / max(time.perf_counter() - t0, 1e-6)

    if workers is None:
        env_w = os.environ.get("POSE_DECODE_WORKERS")
        if env_w:
            workers = int(env_w)
            cal_meta = {"workers": workers, "source": "env"}
        else:
            workers, cal_meta = calibrate_workers(
                video, ceiling=ceil, threads=threads, imgsz=imgsz
            )
    else:
        cal_meta = {"workers": workers, "source": "arg"}

    n_slots = max(32, 4 * workers, 8)
    log.info(
        "ffmpeg_pose: %dx%d fps=%.2f dur=%.0fs batch=%d imgsz=%d workers=%d "
        "ceiling=%.0f slots=%d conf=%.2f",
        W,
        H,
        fps,
        dur,
        batch,
        imgsz,
        workers,
        ceil,
        n_slots,
        conf,
    )
    log.info("ffmpeg_pose calibrate: %s", cal_meta)

    consumer.setup_capture(meta_lb, conf)
    pool = IndexedDecodePool(
        video,
        dur,
        workers,
        batch,
        fps,
        n_slots=n_slots,
        register=True,
        threads=threads,
        imgsz=imgsz,
    )
    zero_copy = pool._registered
    finished = 0
    t0 = time.perf_counter()
    try:
        while True:
            to = 10.0 if finished < workers else 0.5
            try:
                item = pool.get(timeout=to)
            except Empty:
                if finished >= workers or not pool.any_alive():
                    break
                continue
            # Protocol: (slot, frame_base, n_valid) or legacy (slot, frame_base)
            slot = item[0]
            if slot < 0:
                finished += 1
                continue
            if len(item) >= 3:
                fb, n_valid = int(item[1]), int(item[2])
            else:
                fb, n_valid = int(item[1]), batch
            if zero_copy:
                evicted = consumer.feed_capture(
                    pool.slot_tensor(slot), slot, fb, n_valid
                )
                if evicted is not None:
                    pool.release(evicted)
            else:
                consumer.feed_capture_host(pool.view(slot).copy(), fb, n_valid)
                pool.release(slot)
        consumer.flush()
    finally:
        pool.close()

    elapsed = time.perf_counter() - t0
    thr = consumer.frames_seen / elapsed if elapsed > 0 else 0.0
    run_meta = {
        "orig_hw": [H, W],
        "fps": fps,
        "duration_s": dur,
        "source_frames": nb_frames,
        "frames_processed": consumer.frames_seen,
        "throughput_img_s": round(thr, 1),
        "elapsed_s": round(elapsed, 2),
        "zero_copy_dma": zero_copy,
        "decode_workers": workers,
        "batch": batch,
        "imgsz": imgsz,
        "calibrate": cal_meta,
        "ceiling": ceil,
    }
    log.info(
        "ffmpeg_pose done: frames=%d thr=%.0f img/s elapsed=%.1fs zero_copy=%s",
        consumer.frames_seen,
        thr,
        elapsed,
        zero_copy,
    )
    return consumer.by_frame, run_meta


# Back-compat name used by detect.VideoDetector research path.
run_research_pose = run_ffmpeg_pose
