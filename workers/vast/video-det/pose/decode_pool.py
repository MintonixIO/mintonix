"""Multi-process ffmpeg decode ring for the ffmpeg pose feed.

Decoders run as separate processes (own GIL), letterbox to imgsz×imgsz rgb24 in
the ffmpeg filter graph, and write batches into a shared-memory ring. Only slot
indices cross the process queues. Optional cudaHostRegister lets the GPU DMA
frames out of the ring without an extra host memcpy.

`imgsz` is an explicit constructor/worker parameter (defaults to module
`IMGSZ` / env `POSE_IMGSZ`) so correctness does not depend solely on import-time
env for a non-default engine spatial size.
"""
from __future__ import annotations

import fcntl
import multiprocessing as mp
import subprocess
from multiprocessing import shared_memory
from queue import Empty as QueueEmpty

import numpy as np
import torch

from .letterbox import IMGSZ

CHANNELS = 3
F_SETPIPE_SZ = 1031
PIPE_SZ = 1 << 20


def frame_bytes(imgsz: int = IMGSZ) -> int:
    return int(imgsz) * int(imgsz) * CHANNELS


def letterbox_vf(imgsz: int = IMGSZ) -> str:
    """ffmpeg vf matching Ultralytics letterbox (decrease + center pad)."""
    s = int(imgsz)
    return (
        f"scale={s}:{s}:force_original_aspect_ratio=decrease,"
        f"pad={s}:{s}:(ow-iw)/2:(oh-ih)/2"
    )


# Defaults for the module IMGSZ (import-time env). Prefer the helpers above
# when an explicit engine imgsz is known.
FRAME_BYTES = frame_bytes(IMGSZ)
LB_VF = letterbox_vf(IMGSZ)


def spawn_ffmpeg(
    video: str,
    start_s: float,
    dur_s: float,
    threads: int = 1,
    *,
    imgsz: int = IMGSZ,
) -> subprocess.Popen:
    fb = frame_bytes(imgsz)
    cmd = ["ffmpeg", "-loglevel", "error"]
    if threads > 0:
        cmd += ["-threads", str(threads)]
    cmd += [
        "-ss",
        f"{start_s:.3f}",
        "-t",
        f"{dur_s:.3f}",
        "-i",
        video,
        "-an",
        "-sn",
        "-vf",
        letterbox_vf(imgsz),
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
    ]
    p = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=fb * 8,
    )
    try:
        fcntl.fcntl(p.stdout.fileno(), F_SETPIPE_SZ, PIPE_SZ)
    except OSError:
        pass
    return p


def decode_worker_indexed(
    video,
    start_s,
    dur_s,
    base_frame,
    shm_name,
    n_slots,
    batch,
    free_q,
    ready_q,
    stop_evt,
    wid,
    threads=1,
    imgsz=IMGSZ,
):
    imgsz = int(imgsz)
    fb = frame_bytes(imgsz)
    shm = shared_memory.SharedMemory(name=shm_name)
    arr = np.ndarray(
        (n_slots, batch, imgsz, imgsz, CHANNELS), np.uint8, buffer=shm.buf
    )
    proc = spawn_ffmpeg(video, start_s, dur_s, threads=threads, imgsz=imgsz)
    stdout = proc.stdout
    nbytes = batch * fb
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
            if got == 0:
                free_q.put(slot)
                break
            if got < nbytes:
                # Pad last partial batch by repeating the last complete frame so
                # TRT always sees a full batch. n_valid reports real frames only
                # so the consumer does not invent product-level trailing frames.
                n_complete = got // fb
                if n_complete == 0:
                    free_q.put(slot)
                    break
                last = np.array(arr[slot, n_complete - 1], copy=True)
                for i in range(n_complete, batch):
                    arr[slot, i] = last
                ready_q.put((slot, base_frame + emitted * batch, n_complete))
                emitted += 1
                break
            ready_q.put((slot, base_frame + emitted * batch, batch))
            emitted += 1
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        shm.close()
        try:
            ready_q.put((-1, wid, 0))
        except Exception:
            pass


class IndexedDecodePool:
    """Time-sliced multi-ffmpeg producers → ready queue of (slot, frame_base, n_valid)."""

    def __init__(
        self,
        video: str,
        duration: float,
        workers: int,
        batch: int,
        fps: float,
        n_slots: int = 32,
        register: bool = True,
        threads: int = 1,
        imgsz: int = IMGSZ,
    ) -> None:
        self.batch = batch
        self.n_slots = n_slots
        self.imgsz = int(imgsz)
        self.ctx = mp.get_context("spawn")
        fb = frame_bytes(self.imgsz)
        self.shm = shared_memory.SharedMemory(
            create=True, size=n_slots * batch * fb
        )
        self.arr = np.ndarray(
            (n_slots, batch, self.imgsz, self.imgsz, CHANNELS),
            dtype=np.uint8,
            buffer=self.shm.buf,
        )
        self.tensor = None
        self._registered = False
        if register:
            import ctypes

            t = torch.frombuffer(self.shm.buf, dtype=torch.uint8)
            rc = ctypes.CDLL("libcudart.so").cudaHostRegister(
                ctypes.c_void_p(t.data_ptr()),
                ctypes.c_size_t(t.numel()),
                ctypes.c_uint(0),
            )
            if rc == 0:
                self._registered = True
                self.tensor = t.view(
                    n_slots, batch, self.imgsz, self.imgsz, CHANNELS
                )
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
                args=(
                    video,
                    w * seg,
                    seg,
                    base,
                    self.shm.name,
                    n_slots,
                    batch,
                    self.free_q,
                    self.ready_q,
                    self.stop,
                    w,
                    threads,
                    self.imgsz,
                ),
                daemon=True,
            )
            p.start()
            self.procs.append(p)

    def get(self, timeout: float):
        return self.ready_q.get(timeout=timeout)

    def release(self, slot: int) -> None:
        self.free_q.put(slot)

    def view(self, slot: int) -> np.ndarray:
        return self.arr[slot]

    def slot_tensor(self, slot: int):
        return self.tensor[slot]

    def any_alive(self) -> bool:
        return any(p.is_alive() for p in self.procs)

    def close(self) -> None:
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
                    ctypes.c_void_p(t.data_ptr())
                )
            except Exception:
                pass
        try:
            self.shm.close()
            self.shm.unlink()
        except Exception:
            pass


# Re-export for callers (`from pose.decode_pool import Empty`)
Empty = QueueEmpty
