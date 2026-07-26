"""CPU-safe detect pipeline contract tests (pose/shuttle/ReID/chunking)."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from detect.reid import build_reference_embeddings, exclusive_match
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
                    player_id=1,
                )
            ],
            shuttle=[ShuttleCandidate(0.4, 0.3, 0.7), ShuttleCandidate(0.1, 0.2, 0.1)],
        )
        d = fr.to_dict()
        self.assertEqual(d["frame"], 3)
        self.assertEqual(len(d["poses"]), 1)
        self.assertEqual(d["poses"][0]["player_id"], 1)
        self.assertEqual(len(d["poses"][0]["keypoints"]), 17)
        self.assertEqual(len(d["shuttle"]), 2)
        self.assertEqual(d["shuttle"][0]["x"], 0.4)

class TestExclusiveReID(unittest.TestCase):
    def test_no_double_claim(self) -> None:
        refs = {
            1: np.array([1.0, 0.0], dtype=np.float32),
            2: np.array([0.0, 1.0], dtype=np.float32),
        }
        embs = np.array(
            [
                [0.99, 0.1],
                [0.8, 0.6],
            ],
            dtype=np.float32,
        )
        embs = embs / np.linalg.norm(embs, axis=1, keepdims=True)
        refs = {k: v / np.linalg.norm(v) for k, v in refs.items()}

        ids = exclusive_match(embs, refs, thresh=0.5)
        self.assertEqual(ids[0], 1)
        self.assertEqual(ids[1], 2)
        self.assertEqual(len(set(i for i in ids if i is not None)), 2)

    def test_below_threshold_unassigned(self) -> None:
        refs = {1: np.array([1.0, 0.0], dtype=np.float32)}
        embs = np.array([[0.0, 1.0]], dtype=np.float32)
        ids = exclusive_match(embs, refs, thresh=0.5)
        self.assertEqual(ids, [None])

    def test_mask_shape_mismatch_raises(self) -> None:
        frame = np.zeros((10, 20, 3), dtype=np.uint8)
        mask = np.zeros((11, 20), dtype=np.uint8)
        with self.assertRaises(RuntimeError) as ctx:
            build_reference_embeddings(MagicMock(), frame, mask)
        self.assertIn("player_mask shape", str(ctx.exception))

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
            for k in (
                "POSE_ENGINE",
                "SHUTTLE_CKPT",
                "REID_ENGINE",
                "POSE_CONF",
            )
        }
        try:
            cfg = DetectConfig.from_env()
            self.assertTrue(str(cfg.pose_engine).endswith(".engine"))
            self.assertTrue(str(cfg.shuttle_ckpt).endswith(".pt"))
            self.assertGreater(cfg.conf, 0.0)
            self.assertFalse(hasattr(cfg, "pose_feed"))
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
        # Pose/RAM only: smallest multiple of batch ≥ 48 (not lcm with 3).
        self.assertEqual(_chunk_size(5), 50)
        self.assertEqual(_chunk_size(32), 64)
        # Cap at 96 for oversized engine batch
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
        return det

    def test_process_frames_sliding_window_and_batch_shape(self) -> None:
        """Stride-1 windows: N frames → N triplets; input channels=9 (prev|curr|next)."""
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import SHUTTLE_WIN

        det = self._make_det(torch)
        seen_shapes: list[tuple] = []

        class FakeModel:
            def __call__(self, x):
                seen_shapes.append(tuple(x.shape))
                return torch.zeros(x.shape[0], SHUTTLE_WIN, 8, 8)

        det.model = FakeModel()
        det._preprocess_stack = (  # type: ignore[method-assign]
            lambda frames: torch.zeros(len(frames), 3, 8, 8)
        )

        for n in range(0, 6):
            frames = [np.zeros((40, 60, 3), dtype=np.uint8) for _ in range(n)]
            seen_shapes.clear()
            out = det.process_frames(frames)
            self.assertEqual(len(out), n)
            if n == 0:
                self.assertEqual(seen_shapes, [])
            else:
                self.assertEqual(sum(s[0] for s in seen_shapes), n)
                for s in seen_shapes:
                    self.assertEqual(s[1], 9)

    def test_edge_pad_and_center_heatmap_channel(self) -> None:
        """Edge pad uses edge frames; only heatmap channel 1 is peaking-scored."""
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect.shuttle import SHUTTLE_WIN

        det = self._make_det(torch)
        seen_triplets: list[torch.Tensor] = []

        class FakeModel:
            def __call__(self, x):
                # x: (B, 9, H, W) — capture for composition asserts
                seen_triplets.append(x.detach().cpu().clone())
                B = x.shape[0]
                h = torch.zeros(B, SHUTTLE_WIN, 8, 8)
                # Distinct peaks per channel; product must use channel 1 only.
                for b in range(B):
                    h[b, 0, 0, 0] = 0.99  # prev channel — must be ignored
                    h[b, 1, 4, 4] = 0.5 + 0.01 * b  # center
                    h[b, 2, 7, 7] = 0.95  # next channel — must be ignored
                return h

        det.model = FakeModel()

        def stack_with_ids(frames):
            # Encode a unique constant per frame in channel 0 pixel (0,0).
            t = torch.zeros(len(frames), 3, 8, 8)
            for i, f in enumerate(frames):
                # Prefer embedded id from frame[0,0,0] if set.
                t[i, 0, 0, 0] = float(f[0, 0, 0])
            return t

        det._preprocess_stack = stack_with_ids  # type: ignore[method-assign]

        frames = [np.full((8, 8, 3), i, dtype=np.uint8) for i in range(3)]
        out = det.process_frames(frames)
        self.assertEqual(len(out), 3)
        # Only center-channel confs (0.5, 0.51, 0.52)
        self.assertAlmostEqual(out[0][0].conf, 0.5, places=4)
        self.assertAlmostEqual(out[1][0].conf, 0.51, places=4)
        self.assertAlmostEqual(out[2][0].conf, 0.52, places=4)

        # Triplet composition for frame 0: prev=f0 (pad), curr=f0, next=f1
        trip0 = seen_triplets[0][0]  # first batch item
        self.assertEqual(float(trip0[0, 0, 0]), 0.0)  # prev ch0
        self.assertEqual(float(trip0[3, 0, 0]), 0.0)  # curr
        self.assertEqual(float(trip0[6, 0, 0]), 1.0)  # next
        # Frame 2: prev=f1, curr=f2, next=f2 (pad)
        trip2 = seen_triplets[0][2]
        self.assertEqual(float(trip2[0, 0, 0]), 1.0)
        self.assertEqual(float(trip2[3, 0, 0]), 2.0)
        self.assertEqual(float(trip2[6, 0, 0]), 2.0)

        # Explicit global prev/next override pads
        seen_triplets.clear()
        prev = np.full((8, 8, 3), 9, dtype=np.uint8)
        nxt = np.full((8, 8, 3), 8, dtype=np.uint8)
        det.process_frames(frames[:1], prev_frame=prev, next_frame=nxt)
        t = seen_triplets[0][0]
        self.assertEqual(float(t[0, 0, 0]), 9.0)
        self.assertEqual(float(t[3, 0, 0]), 0.0)
        self.assertEqual(float(t[6, 0, 0]), 8.0)

    def test_process_frames_micro_batch_and_bad_heatmap(self) -> None:
        try:
            import torch
        except ImportError:
            self.skipTest("torch not installed")

        from detect import shuttle as shuttle_mod

        det = self._make_det(torch)
        det._preprocess_stack = (  # type: ignore[method-assign]
            lambda frames: torch.zeros(len(frames), 3, 8, 8)
        )

        with patch.object(shuttle_mod, "_MAX_TRIPLETS", 2):
            calls: list[int] = []

            class FakeModel:
                def __call__(self, x):
                    calls.append(x.shape[0])
                    return torch.zeros(x.shape[0], 3, 8, 8)

            det.model = FakeModel()
            # 18 frames → 18 sliding triplets → 9 micro-batches of 2
            frames = [np.zeros((16, 16, 3), dtype=np.uint8) for _ in range(18)]
            out = det.process_frames(frames)
            self.assertEqual(len(out), 18)
            self.assertEqual(calls, [2] * 9)

            # Remainder micro-batch: 5 frames with MAX=2 → [2, 2, 1]
            calls.clear()
            out5 = det.process_frames(frames[:5])
            self.assertEqual(len(out5), 5)
            self.assertEqual(calls, [2, 2, 1])

            class BadModel:
                def __call__(self, x):
                    return torch.zeros(x.shape[0], 2, 8, 8)  # wrong T dim

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

        class FakeModel:
            def __call__(self, x):
                # conf = mean of the 9-channel "id" plane so window content matters
                B = x.shape[0]
                h = torch.zeros(B, SHUTTLE_WIN, 4, 4)
                for b in range(B):
                    # ids stored at (0,0) of each RGB block
                    ids = [float(x[b, c, 0, 0]) for c in (0, 3, 6)]
                    h[b, 1, 1, 1] = 0.1 * (ids[0] + ids[1] * 10 + ids[2] * 100)
                return h

        det.model = FakeModel()

        def stack_with_ids(frames):
            t = torch.zeros(len(frames), 3, 4, 4)
            for i, f in enumerate(frames):
                t[i, 0, 0, 0] = float(f[0, 0, 0])
            return t

        det._preprocess_stack = stack_with_ids  # type: ignore[method-assign]

        frames = [np.full((4, 4, 3), i, dtype=np.uint8) for i in range(5)]
        mono = det.process_frames(frames)

        # Chunk [0,1,2] then [3,4] with hold-style stitch
        c0 = det.process_frames(frames[:2], next_frame=frames[2])
        # frames 0,1 with next of body last = frames[2] only applies to index 1 when
        # we pass next_frame for the list end — for two-frame body of a 3-frame
        # first open-cv chunk we'd process frames[:2] with next=frames[2].
        mid = det.process_frames(
            [frames[2]], prev_frame=frames[1], next_frame=frames[3]
        )
        c1 = det.process_frames(frames[3:], prev_frame=frames[2])
        stitched = c0 + mid + c1
        self.assertEqual(len(stitched), 5)
        for i in range(5):
            self.assertAlmostEqual(
                stitched[i][0].conf if stitched[i] else 0.0,
                mono[i][0].conf if mono[i] else 0.0,
                places=5,
                msg=f"frame {i} mismatch mono vs stitched",
            )

    def test_no_process_triplet_wrapper(self) -> None:
        from detect import shuttle as shuttle_mod
        from detect.shuttle import ShuttleDetector

        self.assertFalse(hasattr(ShuttleDetector, "process_triplet"))
        self.assertNotIn("def process_triplet", Path(shuttle_mod.__file__).read_text())
        self.assertNotIn("def _preprocess(", Path(shuttle_mod.__file__).read_text())

    def test_cuda_required_by_default(self) -> None:
        """Patch deferred `_torch()` so the test works without module-level torch."""
        from detect.shuttle import ShuttleDetector

        fake_torch = MagicMock()
        fake_torch.cuda.is_available.return_value = False

        with patch("detect.shuttle._torch", return_value=fake_torch):
            with self.assertRaises(RuntimeError) as ctx:
                ShuttleDetector.__init__(
                    object.__new__(ShuttleDetector),
                    "/nonexistent.pt",
                )
        self.assertIn("CUDA", str(ctx.exception))
        fake_torch.cuda.is_available.assert_called()

class TestVideoDetectorSinglePassMock(unittest.TestCase):
    def test_process_chunk_merges_pose_and_shuttle_indices(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        cfg = DetectConfig(
            pose_engine=Path("/nonexistent/pose.engine"),
            shuttle_ckpt=Path("/nonexistent/shuttle.pt"),
            reid_engine=None,
            conf=0.15,
        )
        det = object.__new__(VideoDetector)
        det.config = cfg
        det.reid = None
        det.pose_batch = 2

        frames = [np.zeros((40, 60, 3), dtype=np.uint8) for _ in range(3)]
        indices = [10, 11, 12]
        shuttle_lists = [
            [ShuttleCandidate(0.1, 0.2, 0.9)],
            [ShuttleCandidate(0.2, 0.3, 0.8)],
            [ShuttleCandidate(0.3, 0.4, 0.7)],
        ]

        det._pose_chunk = MagicMock(return_value=[[], [], []])  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(return_value=shuttle_lists)

        out = det._process_chunk(frames, indices, refs={})
        self.assertEqual(len(out), 3)
        self.assertEqual([r.frame for r in out], [10, 11, 12])
        self.assertEqual(out[0].shuttle[0].conf, 0.9)

    def test_process_chunk_length_mismatch_raises(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.reid = None
        det.pose_batch = 2
        frames = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(2)]
        det._pose_chunk = MagicMock(return_value=[[]])  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(return_value=[[], []])
        with self.assertRaises(RuntimeError) as ctx:
            det._process_chunk(frames, [0, 1], refs={})
        self.assertIn("length mismatch", str(ctx.exception))

    def test_pose_chunk_pads_incomplete_batch(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig
        from pose.engine import EngineDetection

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x.engine"),
            shuttle_ckpt=Path("/x.pt"),
            reid_engine=None,
            conf=0.15,
        )
        det.pose_batch = 4
        det.reid = None

        frames = [np.zeros((20, 30, 3), dtype=np.uint8) for _ in range(5)]
        fake_dets = [
            [
                EngineDetection(
                    bbox=(0, 0, 10, 10),
                    conf=0.9,
                    keypoints=np.zeros((17, 3), dtype=np.float32),
                )
            ]
            for _ in range(4)
        ]
        call_sizes: list[int] = []

        def fake_run_batch(batch: list) -> list:
            call_sizes.append(len(batch))
            return fake_dets

        det.pose = MagicMock()
        det.pose.run_batch = fake_run_batch

        out = det._pose_chunk(frames)
        self.assertEqual(len(out), 5)
        self.assertEqual(call_sizes, [4, 4])
        self.assertAlmostEqual(out[0][0].bbox[2], 10 / 30)

    def test_process_chunk_assigns_reid(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = MagicMock()
        pose = PoseResult(
            keypoints=[Keypoint(0.1, 0.2, 0.9)] * 17,
            bbox=(0.1, 0.1, 0.5, 0.5),
            conf=0.8,
            player_id=None,
        )
        det._pose_chunk = MagicMock(return_value=[[pose]])  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(return_value=[[]])
        frames = [np.zeros((20, 20, 3), dtype=np.uint8)]
        refs = {1: np.array([1.0, 0.0], dtype=np.float32)}
        with patch("detect.reid.match_players", return_value=[1]) as mp:
            out = det._process_chunk(frames, [0], refs=refs)
        self.assertEqual(out[0].poses[0].player_id, 1)
        mp.assert_called_once()

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
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None

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

        all_idx = [fr.frame for chunk, _, _ in results for fr in chunk]
        self.assertEqual(all_idx, [0, 1, 2, 3, 4])
        self.assertEqual(results[-1][1], 5)
        self.assertEqual(state["released"], 1)

    def test_run_hold_prev_next_kwargs_across_chunks(self) -> None:
        """run() one-frame hold must pass global prev/next into process_frames."""
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None

        # 5 frames, chunk_size=2 → chunks [0,1], [2,3], [4]
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
                results = list(det.run("/hold.mp4"))

        all_idx = [fr.frame for chunk, _, _ in results for fr in chunk]
        self.assertEqual(all_idx, [0, 1, 2, 3, 4])

        # Expected schedule with hold:
        # chunk [0,1]: body [0] next=1, hold 1
        # chunk [2,3]: flush held 1 with prev=0 next=2; body [2] next=3; hold 3
        # chunk [4]:   flush held 3 with prev=2 next=4; hold 4
        # EOS:         flush held 4 with prev=3 next=None
        self.assertEqual(
            calls,
            [
                {"ids": [0], "prev": None, "next": 1},
                {"ids": [1], "prev": 0, "next": 2},
                {"ids": [2], "prev": 1, "next": 3},
                {"ids": [3], "prev": 2, "next": 4},
                {"ids": [4], "prev": 3, "next": None},
            ],
        )

    def test_run_zero_frames_raises(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None

        cap, state = self._cap([], opened=True)
        with patch("detect.cv2.VideoCapture", return_value=cap):
            with self.assertRaises(RuntimeError) as ctx:
                list(det.run("/empty.mp4"))
        self.assertIn("no frames", str(ctx.exception).lower())
        self.assertEqual(state["released"], 1)

    def test_run_is_opened_false_raises(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None
        cap, _ = self._cap([], opened=False)
        with patch("detect.cv2.VideoCapture", return_value=cap):
            with self.assertRaises(RuntimeError) as ctx:
                list(det.run("/missing.mp4"))
        self.assertIn("could not open", str(ctx.exception).lower())

    def test_producer_exception_reraise_and_release(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None
        state = {"released": 0}

        class Cap:
            def isOpened(self):
                return True

            def get(self, _):
                return 10

            def read(self):
                raise RuntimeError("decode boom")

            def release(self):
                state["released"] += 1

        with patch("detect.cv2.VideoCapture", return_value=Cap()):
            with patch("detect._chunk_size", return_value=2):
                with self.assertRaises(RuntimeError) as ctx:
                    list(det.run("/boom.mp4"))
        self.assertIn("decode boom", str(ctx.exception))
        self.assertEqual(state["released"], 1)

    def test_consumer_failure_releases_cap(self) -> None:
        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None
        frames_src = [np.zeros((4, 4, 3), dtype=np.uint8) for _ in range(4)]
        cap, state = self._cap(frames_src)

        det._pose_chunk = MagicMock(side_effect=RuntimeError("gpu down"))  # type: ignore[method-assign]
        det.shuttle = MagicMock()

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with patch("detect._chunk_size", return_value=2):
                with self.assertRaises(RuntimeError) as ctx:
                    list(det.run("/gpu.mp4"))
        self.assertIn("gpu down", str(ctx.exception))
        self.assertEqual(state["released"], 1)

    def test_slow_process_multi_chunk_eof_no_hang(self) -> None:
        """Regression: EOS sentinel must not hang when process is slower than decode."""
        import time

        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = None
        frames_src = [np.zeros((4, 4, 3), dtype=np.uint8) for _ in range(6)]
        cap, state = self._cap(frames_src)

        def slow_pose(frames):
            time.sleep(0.05)  # slower than decode of a small synthetic set
            return [[] for _ in frames]

        det._pose_chunk = slow_pose  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(
            side_effect=lambda frames, prev_frame=None, next_frame=None: [
                [] for _ in frames
            ]
        )

        with patch("detect.cv2.VideoCapture", return_value=cap):
            with patch("detect._chunk_size", return_value=2):
                results = list(det.run("/slow.mp4"))
        total = sum(len(c[0]) for c in results)
        self.assertEqual(total, 6)
        self.assertEqual(state["released"], 1)

    def test_reid_seed_on_main_thread_not_producer(self) -> None:
        import threading

        from detect import VideoDetector
        from detect.config import DetectConfig

        det = object.__new__(VideoDetector)
        det.config = DetectConfig(
            pose_engine=Path("/x"), shuttle_ckpt=Path("/y"), reid_engine=None, conf=0.15
        )
        det.pose_batch = 2
        det.reid = MagicMock()
        frames_src = [np.zeros((8, 8, 3), dtype=np.uint8) for _ in range(2)]
        cap, _ = self._cap(frames_src)
        main_tid = threading.get_ident()
        seed_tids: list[int] = []

        def fake_seed(reid, frame, mask):
            seed_tids.append(threading.get_ident())
            return {1: np.array([1.0, 0.0], dtype=np.float32)}

        det._pose_chunk = MagicMock(side_effect=lambda f: [[] for _ in f])  # type: ignore[method-assign]
        det.shuttle = MagicMock()
        det.shuttle.process_frames = MagicMock(
            side_effect=lambda frames, prev_frame=None, next_frame=None: [
                [] for _ in frames
            ]
        )

        mask = np.zeros((8, 8), dtype=np.uint8)
        mask[2:6, 2:6] = 1
        with patch("detect.cv2.VideoCapture", return_value=cap):
            with patch("detect._chunk_size", return_value=2):
                with patch("detect.reid.build_reference_embeddings", side_effect=fake_seed):
                    list(det.run("/reid.mp4", player_mask=mask))
        self.assertEqual(seed_tids, [main_tid])

if __name__ == "__main__":
    unittest.main()
