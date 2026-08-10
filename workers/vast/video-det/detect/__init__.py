"""Product detect orchestrator: single-threaded OpenCV → pose + shuttle."""
from __future__ import annotations

import logging
import math
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


class VideoDetector:
    """Single-pass product detector (single-threaded).

    OpenCV decode on the main thread; pose then shuttle serially on one GPU.
    Chunks of BGR frames bound peak RAM. A one-frame peek supplies shuttle
    ``next_frame`` at chunk boundaries (no producer thread, no hold FSM).
    """

    def __init__(self, config: DetectConfig) -> None:
        # Defer heavy CUDA/TRT imports until construction (CI can import detect).
        from .shuttle import ShuttleDetector

        self.config = config
        if not Path(config.pose_engine).is_file():
            raise FileNotFoundError(f"pose weights/engine missing: {config.pose_engine}")
        if not Path(config.shuttle_ckpt).is_file():
            raise FileNotFoundError(f"shuttle checkpoint missing: {config.shuttle_ckpt}")

        # .pt → Ultralytics PyTorch (bench / first timing). .engine → product TRT.
        pose_path = Path(config.pose_engine)
        if pose_path.suffix.lower() == ".pt":
            from pose.torch_engine import TorchPoseEngine

            self.pose = TorchPoseEngine(pose_path, conf=config.conf)
            backend = "torch"
        else:
            from pose.engine import PoseEngine

            self.pose = PoseEngine(pose_path, conf=config.conf)
            backend = "trt"
        self.shuttle = ShuttleDetector(config.shuttle_ckpt)
        self.pose_batch = self.pose.batch_size
        log.info(
            "VideoDetector: backend=%s batch=%d conf=%s",
            backend,
            self.pose_batch,
            config.conf,
        )

    @classmethod
    def from_config(cls, cfg: DetectConfig) -> VideoDetector:
        return cls(cfg)

    def run(
        self, video_path: str | Path
    ) -> Generator[list[FrameResult], None, None]:
        """Yield frame-result chunks. Frame index is the OpenCV read order.

        Single-threaded: read up to ``chunk_size`` frames, peek one more for
        shuttle temporal context, run pose→shuttle, repeat. Zero frames fails.
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {video_path}")

        chunk_size = _chunk_size(self.pose_batch)
        frames_done = 0
        prev_bgr: np.ndarray | None = None
        # One-frame peek so the last frame of a full chunk has a true next.
        pending: tuple[int, np.ndarray] | None = None
        eof = False

        def _read_one() -> tuple[int, np.ndarray] | None:
            nonlocal frames_done
            ret, frame = cap.read()
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

                # Peek one frame for shuttle next context (becomes start of next batch).
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
        """Pose → shuttle for a resolved frame list."""
        n = len(frames)
        if n == 0:
            return []

        pose_out = self._pose_chunk(frames)
        shuttle_out: list[list[ShuttleCandidate]] = self.shuttle.process_frames(
            frames, prev_frame=prev_frame, next_frame=next_frame
        )
        if len(pose_out) != n or len(shuttle_out) != n:
            raise RuntimeError(
                f"chunk length mismatch: n={n} pose={len(pose_out)} "
                f"shuttle={len(shuttle_out)}"
            )

        return [
            FrameResult(frame=indices[i], poses=pose_out[i], shuttle=shuttle_out[i])
            for i in range(n)
        ]
