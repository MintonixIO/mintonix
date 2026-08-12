"""Product detect orchestrator: OpenCV decode → pose + shuttle.

Optional env knobs (campaign-validated on RTX 5090):
  OVERLAP_DECODE=1   prefetch next OpenCV chunk while GPU runs current
  PARALLEL_DETECT=1  run pose ∥ shuttle within a chunk (same BGR frames)
  DEBUG_STAGE_TIMERS=1  print decode/pose/shuttle walls
"""
from __future__ import annotations

import logging
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Generator

import cv2
import numpy as np

from .config import DetectConfig
from .pose import to_pose_result
from .shuttle import SHUTTLE_WIN
from .types import FrameResult, PoseResult, ShuttleCandidate

log = logging.getLogger("video-det.detect")

__all__ = [
    "DetectConfig",
    "SHUTTLE_WIN",
    "VideoDetector",
    "_chunk_size",
]

# Default chunk size when engine batch divides 48 (batch ∈ {8, 16}).
_DEFAULT_CHUNK = 48
# Hard cap so large engine batches do not balloon host+GPU memory.
_MAX_CHUNK = 96


def _chunk_size(batch_size: int | None) -> int:
    """Frames per OpenCV pose/shuttle chunk."""
    if batch_size is None or batch_size <= 0:
        return _DEFAULT_CHUNK
    if batch_size > _MAX_CHUNK:
        return _MAX_CHUNK
    if _DEFAULT_CHUNK % batch_size == 0:
        return _DEFAULT_CHUNK
    mult = math.ceil(_DEFAULT_CHUNK / batch_size) * batch_size
    return min(mult, _MAX_CHUNK)


def _env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default) not in ("0", "false", "False", "")


class VideoDetector:
    """Product detector: OpenCV decode; pose + shuttle on one GPU.

    OpenCV decode on the main thread (optionally overlapped with GPU work).
    Pose then shuttle serially, or concurrently when ``PARALLEL_DETECT=1``.
    Chunks of BGR frames bound peak RAM. A one-frame peek supplies shuttle
    ``next_frame`` at chunk boundaries.
    """

    # Defaults so unit tests that construct via ``__new__`` still work.
    overlap_decode: bool = False
    parallel_detect: bool = False
    stage_timers: bool = False
    stage_secs: dict | None = None

    def __init__(self, config: DetectConfig) -> None:
        # Defer heavy CUDA/TRT imports until construction (CI can import detect).
        from pose.engine import PoseEngine

        from .shuttle import ShuttleDetector

        self.config = config
        pose_path = Path(config.pose_engine)
        shuttle_path = Path(config.shuttle_engine)
        if not pose_path.is_file():
            raise FileNotFoundError(f"pose engine missing: {pose_path}")
        if pose_path.suffix.lower() != ".engine":
            raise ValueError(
                f"pose must be a TensorRT .engine (got {pose_path.name}); "
                "PyTorch .pt is not supported in product"
            )
        if not shuttle_path.is_file():
            raise FileNotFoundError(f"shuttle engine missing: {shuttle_path}")
        if shuttle_path.suffix.lower() != ".engine":
            raise ValueError(
                f"shuttle must be a TensorRT .engine (got {shuttle_path.name}); "
                "PyTorch .pt is not supported in product"
            )

        self.pose = PoseEngine(pose_path, conf=config.conf)
        self.shuttle = ShuttleDetector(shuttle_path)
        self.pose_batch = self.pose.batch_size
        self.overlap_decode = _env_flag("OVERLAP_DECODE")
        self.parallel_detect = _env_flag("PARALLEL_DETECT")
        self.stage_timers = _env_flag("DEBUG_STAGE_TIMERS")
        self.stage_secs = {"decode": 0.0, "pose": 0.0, "shuttle": 0.0, "other": 0.0}
        log.info(
            "VideoDetector: pose=trt shuttle=trt batch=%d conf=%s "
            "overlap=%s parallel=%s",
            self.pose_batch,
            config.conf,
            self.overlap_decode,
            self.parallel_detect,
        )

    @classmethod
    def from_config(cls, cfg: DetectConfig) -> VideoDetector:
        return cls(cfg)

    def run(
        self, video_path: str | Path
    ) -> Generator[list[FrameResult], None, None]:
        """Yield frame-result chunks. Frame index is the OpenCV read order."""
        if self.overlap_decode:
            yield from self._run_overlap(video_path)
        else:
            yield from self._run_serial_decode(video_path)

    def _run_serial_decode(
        self, video_path: str | Path
    ) -> Generator[list[FrameResult], None, None]:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {video_path}")

        chunk_size = _chunk_size(self.pose_batch)
        frames_done = 0
        prev_bgr: np.ndarray | None = None
        pending: tuple[int, np.ndarray] | None = None
        eof = False

        def _read_one() -> tuple[int, np.ndarray] | None:
            nonlocal frames_done
            t0 = time.perf_counter()
            ret, frame = cap.read()
            if self.stage_timers:
                self.stage_secs["decode"] += time.perf_counter() - t0
            if not ret:
                return None
            idx = frames_done
            frames_done += 1
            return idx, frame.copy()

        try:
            while True:
                batch_frames: list[np.ndarray] = []
                batch_indices: list[int] = []

                while len(batch_frames) < chunk_size:
                    if pending is not None:
                        idx, bgr = pending
                        pending = None
                    else:
                        if eof:
                            break
                        item = _read_one()
                        if item is None:
                            eof = True
                            break
                        idx, bgr = item
                    batch_frames.append(bgr)
                    batch_indices.append(idx)

                if not batch_frames:
                    break

                if pending is None and not eof:
                    pending = _read_one()
                    if pending is None:
                        eof = True

                next_bgr = pending[1] if pending is not None else None
                yield self._process_chunk(
                    batch_frames,
                    batch_indices,
                    prev_frame=prev_bgr,
                    next_frame=next_bgr,
                )
                prev_bgr = batch_frames[-1]

            if frames_done == 0:
                raise RuntimeError(f"no frames decoded from video: {video_path}")
        finally:
            cap.release()
            if self.stage_timers:
                log.info("stage_secs=%s", self.stage_secs)

    def _run_overlap(
        self, video_path: str | Path
    ) -> Generator[list[FrameResult], None, None]:
        """Prefetch next OpenCV chunk on a host thread while GPU processes current."""
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {video_path}")

        chunk_size = _chunk_size(self.pose_batch)
        frames_done = 0
        prev_bgr: np.ndarray | None = None
        peek: tuple[int, np.ndarray] | None = None
        eof = False

        def _read_one() -> tuple[int, np.ndarray] | None:
            nonlocal frames_done
            t0 = time.perf_counter()
            ret, frame = cap.read()
            if self.stage_timers:
                self.stage_secs["decode"] += time.perf_counter() - t0
            if not ret:
                return None
            idx = frames_done
            frames_done += 1
            return idx, frame.copy()

        def _read_chunk(
            seed: tuple[int, np.ndarray] | None,
        ) -> tuple[list[int], list[np.ndarray], tuple[int, np.ndarray] | None, bool]:
            """Return (indices, frames, next_peek, hit_eof)."""
            nonlocal eof
            indices: list[int] = []
            frames: list[np.ndarray] = []
            local_seed = seed
            while len(frames) < chunk_size:
                if local_seed is not None:
                    idx, bgr = local_seed
                    local_seed = None
                else:
                    if eof:
                        break
                    item = _read_one()
                    if item is None:
                        eof = True
                        break
                    idx, bgr = item
                indices.append(idx)
                frames.append(bgr)
            next_peek: tuple[int, np.ndarray] | None = None
            if frames and not eof:
                next_peek = _read_one()
                if next_peek is None:
                    eof = True
            return indices, frames, next_peek, eof

        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                # Seed first chunk on main thread.
                indices, frames, peek, eof = _read_chunk(None)
                while frames:
                    next_bgr = peek[1] if peek is not None else None
                    # Prefetch next chunk while GPU works.
                    fut = pool.submit(_read_chunk, peek) if not eof or peek else None
                    yield self._process_chunk(
                        frames,
                        indices,
                        prev_frame=prev_bgr,
                        next_frame=next_bgr,
                    )
                    prev_bgr = frames[-1]
                    if fut is None:
                        break
                    indices, frames, peek, eof = fut.result()

            if frames_done == 0:
                raise RuntimeError(f"no frames decoded from video: {video_path}")
        finally:
            cap.release()
            if self.stage_timers:
                log.info("stage_secs=%s", self.stage_secs)

    def _pose_chunk(self, frames: list[np.ndarray]) -> list[list[PoseResult]]:
        """Run PoseEngine over `frames` in engine-sized batches; pad last batch."""
        n = len(frames)
        if n == 0:
            return []
        bs = self.pose_batch
        pose_out: list[list[PoseResult]] = []
        for start in range(0, n, bs):
            batch = frames[start : start + bs]
            real = len(batch)
            if real < bs:
                batch = batch + [batch[-1]] * (bs - real)
            engine_out = self.pose.run_batch(batch)
            for j in range(real):
                h, w = frames[start + j].shape[:2]
                pose_out.append([to_pose_result(d, w, h) for d in engine_out[j]])
        return pose_out

    def _process_chunk(
        self,
        frames: list[np.ndarray],
        indices: list[int],
        *,
        prev_frame: np.ndarray | None = None,
        next_frame: np.ndarray | None = None,
    ) -> list[FrameResult]:
        """Pose → shuttle (serial or parallel) for a resolved frame list."""
        n = len(frames)
        if n == 0:
            return []

        if self.parallel_detect:
            t0 = time.perf_counter()
            with ThreadPoolExecutor(max_workers=2) as ex:
                fut_p = ex.submit(self._pose_chunk, frames)
                fut_s = ex.submit(
                    self.shuttle.process_frames,
                    frames,
                    prev_frame=prev_frame,
                    next_frame=next_frame,
                )
                pose_out = fut_p.result()
                shuttle_out = fut_s.result()
            if self.stage_timers:
                # Combined wall — approximate split not available under parallel.
                wall = time.perf_counter() - t0
                self.stage_secs["pose"] += wall * 0.35
                self.stage_secs["shuttle"] += wall * 0.65
        else:
            t0 = time.perf_counter()
            pose_out = self._pose_chunk(frames)
            if self.stage_timers:
                self.stage_secs["pose"] += time.perf_counter() - t0
            t1 = time.perf_counter()
            shuttle_out = self.shuttle.process_frames(
                frames, prev_frame=prev_frame, next_frame=next_frame
            )
            if self.stage_timers:
                self.stage_secs["shuttle"] += time.perf_counter() - t1

        if len(pose_out) != n or len(shuttle_out) != n:
            raise RuntimeError(
                f"chunk length mismatch: n={n} pose={len(pose_out)} "
                f"shuttle={len(shuttle_out)}"
            )

        return [
            FrameResult(frame=indices[i], poses=pose_out[i], shuttle=shuttle_out[i])
            for i in range(n)
        ]
