from pathlib import Path
from typing import Generator

import cv2
import numpy as np

from .pose import PoseEstimator
from .shuttle import ShuttleDetector
from .types import FrameResult

CHUNK_SIZE = 48   # LCM(16, 3) — aligns both model batches with no padding in the hot path
POSE_BATCH = 16
SHUTTLE_WIN = 3


class VideoDetector:
    def __init__(self, pose_engine: str | Path, shuttle_ckpt: str | Path) -> None:
        self.pose = PoseEstimator(pose_engine, batch_size=POSE_BATCH)
        self.shuttle = ShuttleDetector(shuttle_ckpt)

    def run(
        self, video_path: str | Path
    ) -> Generator[tuple[list[FrameResult], int, int], None, None]:
        """Yield (chunk_results, frames_done, frames_total) after every 48-frame chunk."""
        cap = cv2.VideoCapture(str(video_path))
        total = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

        buf: list[np.ndarray] = []
        indices: list[int] = []
        global_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            buf.append(frame)
            indices.append(global_idx)
            global_idx += 1

            if len(buf) == CHUNK_SIZE:
                yield self._process_full(buf, indices), global_idx, total
                buf, indices = [], []

        cap.release()

        if buf:
            yield self._process_tail(buf, indices), global_idx, total

    # ------------------------------------------------------------------

    def _process_full(
        self, frames: list[np.ndarray], indices: list[int]
    ) -> list[FrameResult]:
        pose_out: list = []
        for i in range(0, CHUNK_SIZE, POSE_BATCH):
            pose_out.extend(self.pose.run_batch(frames[i : i + POSE_BATCH]))

        shuttle_out: list = []
        for i in range(0, CHUNK_SIZE, SHUTTLE_WIN):
            shuttle_out.extend(self.shuttle.process_triplet(*frames[i : i + SHUTTLE_WIN]))

        return [
            FrameResult(frame=indices[i], poses=pose_out[i], shuttle=shuttle_out[i])
            for i in range(CHUNK_SIZE)
        ]

    def _process_tail(
        self, frames: list[np.ndarray], indices: list[int]
    ) -> list[FrameResult]:
        n = len(frames)
        last = frames[-1]

        # shuttle: pad to nearest multiple of 3
        pad3 = ((n + 2) // 3) * 3
        s_frames = frames + [last] * (pad3 - n)
        shuttle_out: list = []
        for i in range(0, pad3, SHUTTLE_WIN):
            shuttle_out.extend(self.shuttle.process_triplet(*s_frames[i : i + SHUTTLE_WIN]))

        # pose: pad to nearest multiple of 16
        pad16 = ((n + 15) // 16) * 16
        p_frames = frames + [last] * (pad16 - n)
        pose_out: list = []
        for i in range(0, pad16, POSE_BATCH):
            pose_out.extend(self.pose.run_batch(p_frames[i : i + POSE_BATCH]))

        return [
            FrameResult(frame=indices[i], poses=pose_out[i], shuttle=shuttle_out[i])
            for i in range(n)
        ]
