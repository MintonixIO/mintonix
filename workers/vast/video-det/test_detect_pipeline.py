"""CPU-safe detect pipeline contract tests (pose/shuttle/chunking)."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from detect.shuttle_peaks import top_candidates
from detect.types import FrameResult, Keypoint, PoseResult, ShuttleCandidate


class TestShuttlePeaks(unittest.TestCase):
    def test_top_k_sorted_and_nms(self) -> None:
        hm = np.zeros((20, 20), dtype=np.float32)
        hm[5, 5] = 0.9
        hm[5, 6] = 0.85  # within NMS of first peak
        hm[15, 15] = 0.3
        out = top_candidates(hm, top_k=8, min_conf=0.05, nms_radius=3)
        self.assertEqual(len(out), 2)
        self.assertGreater(out[0].conf, out[1].conf)
        self.assertAlmostEqual(out[0].conf, 0.9, places=5)


class TestFrameResultJson(unittest.TestCase):
    def test_to_dict_shape(self) -> None:
        fr = FrameResult(
            frame=3,
            poses=[
                PoseResult(
                    keypoints=[Keypoint(0.1, 0.2, 0.9)] * 17,
                    bbox=(0.0, 0.0, 0.5, 0.5),
                    conf=0.8,
                    player_id=None,
                )
            ],
            shuttle=[ShuttleCandidate(0.4, 0.3, 0.7), ShuttleCandidate(0.1, 0.2, 0.1)],
        )
        d = fr.to_dict()
        self.assertEqual(d["frame"], 3)
        self.assertEqual(len(d["poses"]), 1)
        self.assertIsNone(d["poses"][0]["player_id"])
        self.assertEqual(len(d["poses"][0]["keypoints"]), 17)
        self.assertEqual(len(d["shuttle"]), 2)
        self.assertEqual(d["shuttle"][0]["x"], 0.4)


class TestTrackNetTopology(unittest.TestCase):
    def test_expected_parameter_names(self) -> None:
        try:
            import torch  # noqa: F401
        except ImportError:
            self.skipTest("torch not installed")

        from detect.tracknet import TrackNetV5

        m = TrackNetV5()
        keys = set(m.state_dict().keys())
        for required in (
            "mdd.a",
            "mdd.b",
            "backbone.conv1.conv.0.weight",
            "head.spatial_pos_embed",
            "head.time_embed",
            "head.draft_head.weight",
        ):
            self.assertIn(required, keys, msg=f"missing {required}")


class TestDetectConfig(unittest.TestCase):
    def test_from_env_paths_and_conf(self) -> None:
        from detect.config import DetectConfig

        saved = {
            k: os.environ.pop(k, None)
            for k in ("POSE_ENGINE", "SHUTTLE_CKPT", "POSE_CONF")
        }
        try:
            cfg = DetectConfig.from_env()
            self.assertTrue(str(cfg.pose_engine).endswith(".engine"))
            self.assertTrue(str(cfg.shuttle_ckpt).endswith(".pt"))
            self.assertGreater(cfg.conf, 0.0)
            self.assertFalse(hasattr(cfg, "reid_engine"))
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v

    def test_pose_conf_override(self) -> None:
        from detect.config import DetectConfig

        os.environ["POSE_CONF"] = "0.42"
        try:
            self.assertAlmostEqual(DetectConfig.from_env().conf, 0.42)
        finally:
            os.environ.pop("POSE_CONF", None)


class TestPoseDecodePure(unittest.TestCase):
    def test_decode_pose_frame_conf_and_layout(self) -> None:
        from pose.engine import decode_pose_frame
        from pose.letterbox import LetterboxMeta

        meta = LetterboxMeta(
            orig_h=640, orig_w=640, scale=1.0, pad_x=0.0, pad_y=0.0, imgsz=640
        )
        preds = np.zeros((300, 56), dtype=np.float32)
        preds[0, 0:5] = [10, 20, 30, 40, 0.9]
        preds[0, 5:8] = [15, 25, 1.0]
        preds[1, 0:5] = [1, 1, 2, 2, 0.05]
        out = decode_pose_frame(preds, meta, conf=0.15)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0].conf, 0.9, places=5)
        self.assertAlmostEqual(out[0].bbox[0], 10.0, places=3)

    def test_to_pose_result_normalizes(self) -> None:
        from detect.pose import to_pose_result
        from pose.engine import EngineDetection

        det = EngineDetection(
            bbox=(10.0, 20.0, 110.0, 220.0),
            conf=0.5,
            keypoints=np.zeros((17, 3), dtype=np.float32),
        )
        det.keypoints[0] = [50.0, 100.0, 0.8]
        pr = to_pose_result(det, width=200, height=400)
        self.assertAlmostEqual(pr.bbox[0], 0.05)
        self.assertAlmostEqual(pr.bbox[1], 0.05)
        self.assertAlmostEqual(pr.keypoints[0].x, 0.25)
        self.assertAlmostEqual(pr.keypoints[0].y, 0.25)

    def test_pose_estimator_removed(self) -> None:
        import detect.pose as pose_mod

        self.assertFalse(hasattr(pose_mod, "PoseEstimator"))
        self.assertTrue(callable(pose_mod.to_pose_result))


class TestChunkSize(unittest.TestCase):
    def test_chunk_size_for_common_batches(self) -> None:
        from detect import _chunk_size

        self.assertEqual(_chunk_size(16), 48)
        self.assertEqual(_chunk_size(8), 48)
        self.assertEqual(_chunk_size(None), 48)
        self.assertEqual(_chunk_size(0), 48)
        self.assertEqual(_chunk_size(-1), 48)
        self.assertEqual(_chunk_size(5), 50)
        self.assertEqual(_chunk_size(32), 64)
        self.assertEqual(_chunk_size(97), 96)
        self.assertEqual(_chunk_size(128), 96)
        self.assertEqual(_chunk_size(200), 96)


class TestShuttleProcessFrames(unittest.TestCase):
    def _make_det(self, torch):
        from detect.shuttle import ShuttleDetector

        det = object.__new__(ShuttleDetector)
        det.device = "cpu"
        det.top_k = 8
        det.min_conf = 0.05
        det.nms_radius = 3
        det.max_triplets = 10_000  # tests clamp via module ``_MAX_TRIPLETS``
        det.trt = None  # force torch FakeModel path (``object.__new__`` skips __init__)
        det.model = None
        return det

    def test_process_frames_sliding_window_and_batch_shape(self) -> None:
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import SHUTTLE_WIN

        det = self._make_det(torch)
        frames = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(4)]

        class FakeModel:
            def __call__(self, x):
                b = x.shape[0]
                return torch.ones((b, SHUTTLE_WIN, 4, 4), dtype=torch.float32) * 0.5

        det.model = FakeModel()
        det._preprocess_stack = lambda fs: torch.zeros(
            (len(fs), 3, 4, 4), dtype=torch.float32
        )
        out = det.process_frames(frames)
        self.assertEqual(len(out), 4)

    def test_edge_pad_and_center_heatmap_channel(self) -> None:
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import SHUTTLE_WIN

        det = self._make_det(torch)
        frames = [np.full((4, 4, 3), i, dtype=np.uint8) for i in range(3)]
        seen: list[tuple] = []

        class FakeModel:
            def __call__(self, x):
                seen.append(tuple(x.shape))
                b = x.shape[0]
                hm = torch.zeros((b, SHUTTLE_WIN, 4, 4), dtype=torch.float32)
                hm[:, 1, 2, 2] = 0.9
                return hm

        det.model = FakeModel()

        def stack_with_ids(fs):
            t = torch.zeros((len(fs), 3, 4, 4), dtype=torch.float32)
            for i, f in enumerate(fs):
                t[i, 0, 0, 0] = float(f[0, 0, 0])
            return t

        det._preprocess_stack = stack_with_ids
        out = det.process_frames(frames)
        self.assertEqual(len(out), 3)
        self.assertEqual(len(out[0]), 1)
        self.assertAlmostEqual(out[0][0].conf, 0.9, places=5)

        prev = np.full((4, 4, 3), 99, dtype=np.uint8)
        nxt = np.full((4, 4, 3), 100, dtype=np.uint8)
        det.process_frames(frames[:1], prev_frame=prev, next_frame=nxt)
        self.assertTrue(seen)

    def test_process_frames_micro_batch_and_bad_heatmap(self) -> None:
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect import shuttle as shuttle_mod
        from detect.shuttle import SHUTTLE_WIN, ShuttleDetector

        det = self._make_det(torch)
        frames = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(20)]

        with patch.object(shuttle_mod, "_MAX_TRIPLETS", 4):
            batch_sizes: list[int] = []

            class FakeModel:
                def __call__(self, x):
                    batch_sizes.append(int(x.shape[0]))
                    b = x.shape[0]
                    return torch.ones((b, SHUTTLE_WIN, 4, 4)) * 0.2

            det.model = FakeModel()
            det._preprocess_stack = lambda fs: torch.zeros(
                (len(fs), 3, 4, 4), dtype=torch.float32
            )
            out = det.process_frames(frames)
            self.assertEqual(len(out), 20)
            self.assertTrue(batch_sizes)
            self.assertTrue(all(b <= 4 for b in batch_sizes))
            out5 = det.process_frames(frames[:5])
            self.assertEqual(len(out5), 5)

            class BadModel:
                def __call__(self, x):
                    return torch.ones((x.shape[0], 2, 4, 4))

            det.model = BadModel()
            with self.assertRaises(RuntimeError) as ctx:
                det.process_frames(frames[:3])
            self.assertIn("heatmap shape", str(ctx.exception).lower())

    def test_cross_chunk_matches_monolithic(self) -> None:
        """Two chunks with prev/next stitch must match one-shot process_frames."""
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import SHUTTLE_WIN

        det = self._make_det(torch)
        frames = [np.full((4, 4, 3), i, dtype=np.uint8) for i in range(5)]

        class FakeModel:
            def __call__(self, x):
                b = x.shape[0]
                # Encode left/center/right channel-0 values into heatmap conf.
                conf = x[:, 0:1, 0:1, 0:1].mean(dim=1, keepdim=True)
                hm = torch.zeros((b, SHUTTLE_WIN, 4, 4), dtype=torch.float32)
                hm[:, 1, 1, 1] = conf.view(b, 1, 1)
                return hm

        det.model = FakeModel()

        def stack_with_ids(fs):
            t = torch.zeros((len(fs), 3, 4, 4), dtype=torch.float32)
            for i, f in enumerate(fs):
                t[i, 0, 0, 0] = float(f[0, 0, 0])
            return t

        det._preprocess_stack = stack_with_ids
        mono = det.process_frames(frames)

        c0 = det.process_frames(frames[:2], next_frame=frames[2])
        mid = det.process_frames(
            frames[2:3], prev_frame=frames[1], next_frame=frames[3]
        )
        c1 = det.process_frames(frames[3:], prev_frame=frames[2])
        stitched = c0 + mid + c1
        self.assertEqual(len(stitched), len(mono))
        for a, b in zip(mono, stitched):
            self.assertEqual(len(a), len(b))
            if a:
                self.assertAlmostEqual(a[0].conf, b[0].conf, places=4)

    def test_no_process_triplet_wrapper(self) -> None:
        from detect import shuttle as shuttle_mod

        self.assertNotIn("def process_triplet", Path(shuttle_mod.__file__).read_text())
        self.assertNotIn("def _preprocess(", Path(shuttle_mod.__file__).read_text())

    def test_cuda_required_by_default(self) -> None:
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import ShuttleDetector

        with patch.object(torch.cuda, "is_available", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                ShuttleDetector("/nonexistent.pt")
            self.assertIn("CUDA", str(ctx.exception))


class TestVideoDetectorSinglePassMock(unittest.TestCase):
    def _cfg(self):
        from detect.config import DetectConfig

        return DetectConfig(
            pose_engine=Path("/x.engine"),
            shuttle_ckpt=Path("/x.pt"),
            conf=0.15,
        )

    def test_process_chunk_merges_pose_and_shuttle_indices(self) -> None:
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2
        det._pose_chunk = MagicMock(  # type: ignore[method-assign]
            return_value=[[], []]
        )
        shuttle_lists = [[ShuttleCandidate(0.1, 0.2, 0.9)], []]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(return_value=shuttle_lists)

        out = det._process_chunk(
            [np.zeros((4, 4, 3), dtype=np.uint8)] * 2,
            [10, 11],
        )
        self.assertEqual([r.frame for r in out], [10, 11])
        self.assertEqual(len(out[0].shuttle), 1)
        self.assertEqual(len(out[1].shuttle), 0)

    def test_process_chunk_length_mismatch_raises(self) -> None:
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2
        det._pose_chunk = MagicMock(return_value=[[]])  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(return_value=[[], []])
        with self.assertRaises(RuntimeError) as ctx:
            det._process_chunk(
                [np.zeros((2, 2, 3), dtype=np.uint8)] * 2,
                [0, 1],
            )
        self.assertIn("length mismatch", str(ctx.exception))

    def test_pose_chunk_pads_incomplete_batch(self) -> None:
        from detect import VideoDetector
        from pose.engine import EngineDetection

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 4
        calls: list[int] = []

        def fake_run_batch(batch: list) -> list:
            calls.append(len(batch))
            empty = EngineDetection(
                bbox=(0, 0, 1, 1),
                conf=0.1,
                keypoints=np.zeros((17, 3), dtype=np.float32),
            )
            return [[empty] for _ in batch]

        det.pose = MagicMock()
        det.pose.run_batch = fake_run_batch
        frames = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(3)]
        out = det._pose_chunk(frames)
        self.assertEqual(calls, [4])
        self.assertEqual(len(out), 3)

    def _cap(self, frames_src, *, opened=True):
        state = {"i": 0, "released": 0}

        class Cap:
            def isOpened(self_):
                return opened

            def get(self_, _):
                return len(frames_src)

            def read(self_):
                i = state["i"]
                if i >= len(frames_src):
                    return False, None
                state["i"] = i + 1
                return True, frames_src[i]

            def release(self_):
                state["released"] += 1

        return Cap(), state

    def test_run_multi_chunk_remainder(self) -> None:
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2

        frames_src = [np.full((4, 4, 3), i, dtype=np.uint8) for i in range(5)]
        cap, state = self._cap(frames_src)

        det._pose_chunk = MagicMock(  # type: ignore[method-assign]
            side_effect=lambda frames: [[] for _ in frames]
        )
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(
            side_effect=lambda frames, prev_frame=None, next_frame=None: [
                [] for _ in frames
            ]
        )

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with patch("detect._chunk_size", return_value=2):
                results = list(det.run("/fake.mp4"))

        all_idx = [fr.frame for chunk in results for fr in chunk]
        self.assertEqual(all_idx, [0, 1, 2, 3, 4])
        self.assertEqual(state["released"], 1)

    def test_run_peek_prev_next_across_chunks(self) -> None:
        """run() one-frame peek must pass global prev/next into process_frames."""
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2

        # 5 frames, chunk_size=2 → batches sized via peek
        frames_src = [np.full((4, 4, 3), i, dtype=np.uint8) for i in range(5)]
        cap, _ = self._cap(frames_src)

        calls: list[dict] = []

        def record_process(frames, prev_frame=None, next_frame=None):
            def _id(f):
                if f is None:
                    return None
                return int(f[0, 0, 0])

            calls.append(
                {
                    "ids": [_id(f) for f in frames],
                    "prev": _id(prev_frame),
                    "next": _id(next_frame),
                }
            )
            return [[] for _ in frames]

        det._pose_chunk = MagicMock(  # type: ignore[method-assign]
            side_effect=lambda frames: [[] for _ in frames]
        )
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(side_effect=record_process)

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with patch("detect._chunk_size", return_value=2):
                results = list(det.run("/peek.mp4"))

        all_idx = [fr.frame for chunk in results for fr in chunk]
        self.assertEqual(all_idx, [0, 1, 2, 3, 4])
        # First full chunk of 2 has next=frame 2; last batch has next=None.
        self.assertIsNotNone(calls[0]["next"])
        self.assertIsNone(calls[-1]["next"])
        self.assertIsNone(calls[0]["prev"])
        if len(calls) > 1:
            self.assertIsNotNone(calls[1]["prev"])

    def test_run_zero_frames_raises(self) -> None:
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2
        cap, state = self._cap([])

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with self.assertRaises(RuntimeError) as ctx:
                list(det.run("/empty.mp4"))
        self.assertIn("no frames", str(ctx.exception).lower())
        self.assertEqual(state["released"], 1)

    def test_run_is_opened_false_raises(self) -> None:
        from detect import VideoDetector

        det = object.__new__(VideoDetector)
        det.config = self._cfg()
        det.pose_batch = 2
        cap, _ = self._cap([], opened=False)

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with self.assertRaises(RuntimeError) as ctx:
                list(det.run("/missing.mp4"))
        self.assertIn("could not open", str(ctx.exception).lower())

    def test_no_reid_module(self) -> None:
        import importlib.util
        from pathlib import Path as P

        root = P(__file__).resolve().parent
        self.assertIsNone(importlib.util.find_spec("detect.reid"))
        self.assertFalse((root / "detect" / "reid.py").exists())


if __name__ == "__main__":
    unittest.main()
