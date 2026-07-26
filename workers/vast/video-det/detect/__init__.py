"""Product detect orchestrator: single-pass OpenCV → pose + shuttle (+ ReID)."""
from __future__ import annotations

import logging
import math
import queue
import threading
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
    """Frames per OpenCV pose/shuttle/ReID chunk (pose/RAM only).

    Prefer 48 when ``batch_size`` divides it (no wasted pad for engines with
    batch 8 or 16). Otherwise the smallest multiple of ``batch_size`` that is
    ≥ 48 (capped at ``_MAX_CHUNK``). Shuttle uses stride-1 windows and does not
    require multiples of 3.
    """
    if batch_size is None or batch_size <= 0:
        return _DEFAULT_CHUNK
    if batch_size > _MAX_CHUNK:
        # Engine batch already larger than our host-frame budget; keep the
        # OpenCV chunk at the cap and pad inside `_pose_chunk`.
        return _MAX_CHUNK
    if _DEFAULT_CHUNK % batch_size == 0:
        return _DEFAULT_CHUNK
    mult = math.ceil(_DEFAULT_CHUNK / batch_size) * batch_size
    return min(mult, _MAX_CHUNK)


class VideoDetector:
    """Single-pass product detector.

    One OpenCV decode thread owns VideoCapture and fills the next BGR chunk
    while the main thread runs pose → shuttle → ReID on the current chunk
    (one-chunk lookahead; at most one pending data chunk buffered).

    Pose and shuttle share the same sequential OpenCV frame index and stay
    serial on the GPU. Shuttle carries one-frame context across chunks so
    stride-1 windows are globally correct. Output length equals frames
    successfully read (must be > 0).
    """

    def __init__(self, config: DetectConfig) -> None:
        # Defer heavy CUDA/TRT imports until construction (CI can import detect).
        from pose.engine import PoseEngine

        from .reid import ReIDEmbedder
        from .shuttle import ShuttleDetector

        self.config = config
        if not Path(config.pose_engine).is_file():
            raise FileNotFoundError(f"pose engine missing: {config.pose_engine}")
        if not Path(config.shuttle_ckpt).is_file():
            raise FileNotFoundError(f"shuttle checkpoint missing: {config.shuttle_ckpt}")

        self.pose = PoseEngine(config.pose_engine, conf=config.conf)
        self.shuttle = ShuttleDetector(config.shuttle_ckpt)
        self.reid = (
            ReIDEmbedder(config.reid_engine) if config.reid_engine is not None else None
        )
        self.pose_batch = self.pose.batch_size
        log.info(
            "VideoDetector: batch=%d conf=%s reid=%s",
            self.pose_batch,
            config.conf,
            config.reid_engine is not None,
        )

    @classmethod
    def from_config(cls, cfg: DetectConfig) -> VideoDetector:
        return cls(cfg)

    def run(
        self, video_path: str | Path, player_mask: np.ndarray | None = None
    ) -> Generator[tuple[list[FrameResult], int, int], None, None]:
        """Yield (chunk_results, frames_done, frames_total) after every emit.

        Decode overlaps GPU work via one-chunk lookahead: a producer thread
        owns the single OpenCV ``VideoCapture`` and keeps at most one full
        data chunk ready (``Queue(maxsize=1)``). EOS is a separate
        ``threading.Event`` so it cannot race with data or be dropped.

        Cross-chunk shuttle context (one-frame hold) and ReID seed live only
        in this method. ``_process_chunk`` is the pure pose→shuttle→ReID
        helper invoked with fully resolved ``prev_frame`` / ``next_frame``.
        """
        from .reid import build_reference_embeddings

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {video_path}")

        reported = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_hint = max(1, reported) if reported > 0 else 1
        chunk_size = _chunk_size(self.pose_batch)

        # Data-only queue: at most one pending chunk. EOS is an Event so it
        # never competes for a queue slot or gets dropped on Full.
        pending: queue.Queue = queue.Queue(maxsize=1)
        eos = threading.Event()
        stop = threading.Event()
        producer_error: list[BaseException] = []

        def _put_chunk(chunk: tuple[list[np.ndarray], list[int]]) -> bool:
            """Block with timeout until put succeeds or stop. Returns False if stopped."""
            while not stop.is_set():
                try:
                    pending.put(chunk, timeout=0.1)
                    return True
                except queue.Full:
                    continue
            return False

        def _producer() -> None:
            global_idx = 0
            buf: list[np.ndarray] = []
            indices: list[int] = []
            try:
                while not stop.is_set():
                    ret, frame = cap.read()
                    if not ret:
                        break
                    # OpenCV may reuse the same buffer; copy before buffering.
                    # CPU-only: no CUDA/TRT on this thread.
                    frame = frame.copy()
                    buf.append(frame)
                    indices.append(global_idx)
                    global_idx += 1

                    if len(buf) == chunk_size:
                        chunk = (buf, indices)
                        buf = []
                        indices = []
                        if not _put_chunk(chunk):
                            break

                if buf and not stop.is_set():
                    _put_chunk((buf, indices))
            except BaseException as e:  # noqa: BLE001 — stash for main thread
                producer_error.append(e)
            finally:
                cap.release()
                # Always-writable terminal signal (never needs a queue slot).
                eos.set()

        producer = threading.Thread(
            target=_producer, name="video-det-decode", daemon=True
        )
        producer.start()
        frames_done = 0
        refs: dict[int, np.ndarray] = {}
        # Hold last frame BGR+index until next chunk/EOS supplies true next.
        # Poses are not precomputed — `_process_chunk` runs once with full context.
        held: dict | None = None
        main_exc: BaseException | None = None

        def _emit_results(results: list[FrameResult]):
            nonlocal frames_done
            if not results:
                return None
            frames_done = results[-1].frame + 1
            return results, frames_done, max(total_hint, frames_done)

        def _handle_chunk(
            chunk_frames: list[np.ndarray], chunk_indices: list[int]
        ) -> list[FrameResult]:
            nonlocal held, refs
            if not chunk_frames:
                return []

            # ReID seed on main thread only (pycuda/TRT is not thread-safe).
            if (
                chunk_indices[0] == 0
                and self.reid is not None
                and player_mask is not None
                and not refs
            ):
                refs = build_reference_embeddings(
                    self.reid, chunk_frames[0], player_mask
                )

            emit: list[FrameResult] = []

            # Complete previous chunk's last frame with true next neighbor.
            if held is not None:
                emit.extend(
                    self._process_chunk(
                        [held["bgr"]],
                        [held["idx"]],
                        refs,
                        prev_frame=held["prev_bgr"],
                        next_frame=chunk_frames[0],
                    )
                )
                prev_for_body: np.ndarray | None = held["bgr"]
            else:
                prev_for_body = None

            n = len(chunk_frames)
            if n == 1:
                held = {
                    "bgr": chunk_frames[0],
                    "idx": chunk_indices[0],
                    "prev_bgr": prev_for_body,
                }
            else:
                # Emit body with correct next=last frame; hold last (no pose yet).
                emit.extend(
                    self._process_chunk(
                        chunk_frames[:-1],
                        chunk_indices[:-1],
                        refs,
                        prev_frame=prev_for_body,
                        next_frame=chunk_frames[-1],
                    )
                )
                held = {
                    "bgr": chunk_frames[-1],
                    "idx": chunk_indices[-1],
                    "prev_bgr": chunk_frames[-2],
                }
            return emit

        try:
            while True:
                item: tuple[list[np.ndarray], list[int]] | None
                try:
                    item = pending.get(timeout=0.2)
                except queue.Empty:
                    if not eos.is_set():
                        continue
                    # Producer finished: drain any data still in the queue, then stop.
                    # Never break while a chunk may still be sitting in `pending`.
                    while True:
                        try:
                            item = pending.get_nowait()
                        except queue.Empty:
                            item = None
                            break
                        emit = _handle_chunk(item[0], item[1])
                        out = _emit_results(emit)
                        if out is not None:
                            yield out
                    break

                emit = _handle_chunk(item[0], item[1])
                out = _emit_results(emit)
                if out is not None:
                    yield out

            # EOS: flush held frame with edge-pad next (via _process_chunk only).
            if held is not None:
                flush = self._process_chunk(
                    [held["bgr"]],
                    [held["idx"]],
                    refs,
                    prev_frame=held["prev_bgr"],
                    next_frame=None,
                )
                held = None
                out = _emit_results(flush)
                if out is not None:
                    yield out
        except BaseException as e:
            main_exc = e
            stop.set()
        finally:
            stop.set()
            # Drain so a blocked producer can exit puts and set eos.
            while True:
                try:
                    pending.get_nowait()
                except queue.Empty:
                    break
            producer.join(timeout=30.0)
            producer_alive = producer.is_alive()

        if main_exc is not None:
            if producer_error:
                log.warning(
                    "decode producer also failed: %s",
                    producer_error[0],
                    exc_info=producer_error[0],
                )
            if producer_alive:
                log.error("decode producer still alive after join timeout")
            raise main_exc
        if producer_alive:
            raise RuntimeError("decode producer did not exit after join timeout")
        if producer_error:
            raise producer_error[0]
        if frames_done == 0:
            raise RuntimeError(f"no frames decoded from video: {video_path}")

    # ------------------------------------------------------------------
    # Chunk helpers
    # ------------------------------------------------------------------

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
        refs: dict[int, np.ndarray],
        *,
        prev_frame: np.ndarray | None = None,
        next_frame: np.ndarray | None = None,
    ) -> list[FrameResult]:
        """Pure pose → shuttle → ReID for a resolved frame list.

        Does **not** implement cross-chunk hold or ReID seed — those live only
        in ``run()``, which calls this helper once per frame group with
        ``prev_frame`` / ``next_frame`` already resolved for global stride-1
        windows. Safe for unit tests that need a single synchronous pass.
        """
        n = len(frames)
        if n == 0:
            return []

        # Intentional serial GPU schedule: pose then shuttle (then ReID on CPU
        # crops). No dual-stream pose+shuttle — one GPU, simple and correct.
        pose_out = self._pose_chunk(frames)
        shuttle_out: list[list[ShuttleCandidate]] = self.shuttle.process_frames(
            frames, prev_frame=prev_frame, next_frame=next_frame
        )
        if len(pose_out) != n or len(shuttle_out) != n:
            raise RuntimeError(
                f"chunk length mismatch: n={n} pose={len(pose_out)} "
                f"shuttle={len(shuttle_out)}"
            )
        self._assign_player_ids(frames, pose_out, refs)

        return [
            FrameResult(frame=indices[i], poses=pose_out[i], shuttle=shuttle_out[i])
            for i in range(n)
        ]

    def _assign_player_ids(
        self,
        frames: list[np.ndarray],
        pose_out: list[list[PoseResult]],
        refs: dict[int, np.ndarray],
    ) -> None:
        if self.reid is None or not refs:
            return
        from .reid import match_players

        for frame, poses in zip(frames, pose_out):
            if not poses:
                continue
            ids = match_players(self.reid, frame, [p.bbox for p in poses], refs)
            for pose, player_id in zip(poses, ids):
                pose.player_id = player_id
