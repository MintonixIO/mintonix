"""Product detect orchestrator: pose feed → shuttle/ReID on OpenCV frames."""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Generator

import cv2
import numpy as np

from .config import DetectConfig
from .pose import to_pose_result
from .types import FrameResult, PoseResult, ShuttleCandidate

log = logging.getLogger("video-det.detect")

# Shuttle window is fixed at 3 (TrackNetV5 triplet).
SHUTTLE_WIN = 3

# Default chunk size when engine batch divides 48 (batch ∈ {8, 16}).
# If batch does not divide 48, use lcm(batch, 3) via `_chunk_size`.
_DEFAULT_CHUNK = 48


def _chunk_size(batch_size: int | None) -> int:
    """Frames per OpenCV shuttle/ReID chunk.

    Prefer 48 when `batch_size` divides it (no wasted pad for engines with
    batch 8 or 16). Otherwise `lcm(batch, 3)` so both alignments stay clean.
    When batch is unknown (ffmpeg feed already finished pose), 48 is fine.
    """
    if batch_size is None or batch_size <= 0:
        return _DEFAULT_CHUNK
    if _DEFAULT_CHUNK % batch_size == 0:
        return _DEFAULT_CHUNK
    return math.lcm(batch_size, SHUTTLE_WIN)


class VideoDetector:
    """Single-path product detector.

    1. Pose feed → `dict[int, list[EngineDetection]]` (opencv or ffmpeg)
    2. OpenCV once for shuttle (+ ReID seed on frame 0)
    3. Per chunk: poses for those indices, shuttle, ReID assign → FrameResult

    Output length equals the OpenCV frame count. Missing pose indices get an
    empty pose list; we never invent trailing empty-shuttle frames past OpenCV EOF.
    """

    def __init__(self, config: DetectConfig) -> None:
        from .reid import ReIDEmbedder
        from .shuttle import ShuttleDetector

        self.config = config
        self.pose_engine_path = Path(config.pose_engine)
        self.shuttle = ShuttleDetector(config.shuttle_ckpt)
        self.reid = (
            ReIDEmbedder(config.reid_engine) if config.reid_engine is not None else None
        )
        # OpenCV feed may pre-load PoseEngine at run; keep optional handle for
        # callers that want batch_size after first run.
        self._pose_batch: int | None = None
        log.info(
            "VideoDetector: pose_feed=%s conf=%s reid=%s",
            config.pose_feed,
            config.conf,
            config.reid_engine is not None,
        )

    @classmethod
    def from_config(cls, cfg: DetectConfig) -> VideoDetector:
        return cls(cfg)

    def run(
        self, video_path: str | Path, player_mask: np.ndarray | None = None
    ) -> Generator[tuple[list[FrameResult], int, int], None, None]:
        """Yield (chunk_results, frames_done, frames_total) after every chunk."""
        by_frame_eng, pose_meta = self._run_pose_feed(video_path)
        log.info("pose feed meta: %s", pose_meta)

        orig_hw = pose_meta.get("orig_hw")
        batch = pose_meta.get("batch")
        if isinstance(batch, int):
            self._pose_batch = batch
        chunk_size = _chunk_size(self._pose_batch)

        from .reid import build_reference_embeddings

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"OpenCV could not open video: {video_path}")
        # Prefer CAP_PROP when available; actual total is frames we successfully read.
        reported = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_hint = max(1, reported) if reported > 0 else 1

        buf: list[np.ndarray] = []
        indices: list[int] = []
        global_idx = 0
        refs: dict[int, np.ndarray] = {}
        # Fall back to pose meta size when OpenCV frames lack shape (should not happen).
        fallback_h, fallback_w = 0, 0
        if isinstance(orig_hw, (list, tuple)) and len(orig_hw) == 2:
            fallback_h, fallback_w = int(orig_hw[0]), int(orig_hw[1])

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if global_idx == 0 and self.reid is not None and player_mask is not None:
                refs = build_reference_embeddings(self.reid, frame, player_mask)

            buf.append(frame)
            indices.append(global_idx)
            global_idx += 1

            if len(buf) == chunk_size:
                results = self._merge_chunk(
                    buf, indices, by_frame_eng, refs, fallback_w, fallback_h
                )
                buf.clear()
                indices.clear()
                yield results, global_idx, max(total_hint, global_idx)

        cap.release()

        if buf:
            results = self._merge_chunk(
                buf, indices, by_frame_eng, refs, fallback_w, fallback_h
            )
            buf.clear()
            indices.clear()
            yield results, global_idx, max(total_hint, global_idx)

        # No trailing pose-only empty-shuttle frames: output length == OpenCV count.

    # ------------------------------------------------------------------
    # Pose feed
    # ------------------------------------------------------------------

    def _run_pose_feed(
        self, video_path: str | Path
    ) -> tuple[dict[int, list], dict]:
        cfg = self.config
        if cfg.pose_feed == "ffmpeg":
            from .pose_feed import run_ffmpeg_pose

            log.info("pose feed=ffmpeg conf=%s", cfg.conf)
            return run_ffmpeg_pose(
                video_path,
                self.pose_engine_path,
                conf=cfg.conf,
                ceiling=cfg.pose_ceiling,
                workers=cfg.decode_workers,
                imgsz=cfg.imgsz,
            )

        from .pose_feed import run_opencv_pose

        log.info("pose feed=opencv conf=%s", cfg.conf)
        return run_opencv_pose(
            video_path,
            self.pose_engine_path,
            conf=cfg.conf,
        )

    # ------------------------------------------------------------------
    # Chunk helpers
    # ------------------------------------------------------------------

    def _shuttle_chunk(
        self, frames: list[np.ndarray]
    ) -> list[list[ShuttleCandidate]]:
        """TrackNet triplets over `frames`; pad last frame to multiple of 3."""
        n = len(frames)
        if n == 0:
            return []
        last = frames[-1]
        pad3 = ((n + SHUTTLE_WIN - 1) // SHUTTLE_WIN) * SHUTTLE_WIN
        s_frames = frames + [last] * (pad3 - n)
        shuttle_out: list[list[ShuttleCandidate]] = []
        for i in range(0, pad3, SHUTTLE_WIN):
            shuttle_out.extend(
                self.shuttle.process_triplet(*s_frames[i : i + SHUTTLE_WIN])
            )
        return shuttle_out[:n]

    def _merge_chunk(
        self,
        frames: list[np.ndarray],
        indices: list[int],
        by_frame_eng: dict[int, list],
        refs: dict[int, np.ndarray],
        fallback_w: int,
        fallback_h: int,
    ) -> list[FrameResult]:
        n = len(frames)
        if n == 0:
            return []

        shuttle_out = self._shuttle_chunk(frames)

        pose_out: list[list[PoseResult]] = []
        for frame, idx in zip(frames, indices):
            h, w = frame.shape[:2]
            if w <= 0 or h <= 0:
                w, h = fallback_w, fallback_h
            dets = by_frame_eng.get(idx, [])
            pose_out.append([to_pose_result(d, w, h) for d in dets])

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
