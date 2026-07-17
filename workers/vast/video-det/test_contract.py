"""CPU-safe contract tests for the detect worker (no GPU / TRT required).

Run: python3 -m unittest test_contract -v  (from this directory, PYTHONPATH=.)
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from detect.reid import exclusive_match
from detect.shuttle_peaks import top_candidates
from detect.types import FrameResult, Keypoint, PoseResult, ShuttleCandidate
from io_util import download, upload_file


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
        # Two dets both prefer ref 1; second should take ref 2 if above thresh.
        refs = {
            1: np.array([1.0, 0.0], dtype=np.float32),
            2: np.array([0.0, 1.0], dtype=np.float32),
        }
        embs = np.array(
            [
                [0.99, 0.1],   # clearly player 1
                [0.8, 0.6],    # also closer to 1 than 2, but 1 taken
            ],
            dtype=np.float32,
        )
        # L2-normalize like the embedder does.
        embs = embs / np.linalg.norm(embs, axis=1, keepdims=True)
        refs = {k: v / np.linalg.norm(v) for k, v in refs.items()}

        ids = exclusive_match(embs, refs, thresh=0.5)
        self.assertEqual(ids[0], 1)
        self.assertEqual(ids[1], 2)
        self.assertEqual(len(set(i for i in ids if i is not None)), 2)

    def test_below_threshold_unassigned(self) -> None:
        refs = {1: np.array([1.0, 0.0], dtype=np.float32)}
        embs = np.array([[0.0, 1.0]], dtype=np.float32)  # orthogonal
        ids = exclusive_match(embs, refs, thresh=0.5)
        self.assertEqual(ids, [None])


class TestFileIO(unittest.TestCase):
    def test_file_scheme_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "in.bin"
            src.write_bytes(b"hello-detect")
            dest = td_path / "out.bin"
            download(f"file://{src}", dest)
            self.assertEqual(dest.read_bytes(), b"hello-detect")

            uploaded = td_path / "uploaded.bin"
            upload_file(dest, f"file://{uploaded}")
            self.assertEqual(uploaded.read_bytes(), b"hello-detect")

    def test_file_upload_creates_parent_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            src = td_path / "src.json"
            src.write_text('{"ok":true}')
            nested = td_path / "a" / "b" / "out.json"
            upload_file(src, f"file://{nested}", content_type="application/json")
            self.assertEqual(nested.read_text(), '{"ok":true}')

    def test_stream_json_shape(self) -> None:
        """Simulate streaming detections.json writer used by server."""
        frames = [
            FrameResult(frame=i, poses=[], shuttle=[ShuttleCandidate(0.1, 0.2, 0.3)])
            for i in range(3)
        ]
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "det.json"
            with path.open("w") as f:
                f.write('{"job_id":"j1","frames":[')
                for i, fr in enumerate(frames):
                    if i:
                        f.write(",")
                    f.write(json.dumps(fr.to_dict(), separators=(",", ":")))
                f.write("]}")
            body = json.loads(path.read_text())
            self.assertEqual(body["job_id"], "j1")
            self.assertEqual(len(body["frames"]), 3)
            self.assertEqual(body["frames"][2]["frame"], 2)


class TestTrackNetTopology(unittest.TestCase):
    def test_expected_parameter_names(self) -> None:
        try:
            import torch  # noqa: F401
        except ImportError:
            self.skipTest("torch not installed")

        from detect.tracknet import TrackNetV5

        m = TrackNetV5()
        keys = set(m.state_dict().keys())
        # Checkpoint-critical names from the released TrackNetV5.pt topology.
        for required in (
            "mdd.a",
            "mdd.b",
            "backbone.conv1.conv.0.weight",
            "head.spatial_pos_embed",
            "head.time_embed",
            "head.draft_head.weight",
        ):
            self.assertIn(required, keys, msg=f"missing {required}")


class TestWorkerConfigImport(unittest.TestCase):
    def test_request_parser(self) -> None:
        import importlib.util
        from pathlib import Path as P

        path = P(__file__).resolve().parent / "worker.py"
        try:
            import vastai  # noqa: F401
        except ImportError:
            self.skipTest("vastai-sdk not installed")
        spec = importlib.util.spec_from_file_location("video_det_worker", path)
        assert spec and spec.loader
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        inner = {"input_url": "x", "request_id": "j1"}
        self.assertEqual(mod.request_parser({"input": inner}), inner)
        self.assertEqual(mod.request_parser(inner), inner)

        bench = mod.benchmark_generator()
        self.assertTrue(bench["input_url"].startswith("file://"))
        self.assertTrue(bench["output_upload_url"].startswith("file://"))


class TestDetectConfig(unittest.TestCase):
    def test_default_pose_feed_is_opencv(self) -> None:
        import os
        from detect.config import DetectConfig

        saved = {k: os.environ.pop(k, None) for k in (
            "POSE_FEED", "POSE_PIPELINE", "POSE_CONF", "POSE_IMGSZ",
            "POSE_DECODE_WORKERS", "POSE_CEILING",
        )}
        try:
            cfg = DetectConfig.from_env()
            self.assertEqual(cfg.pose_feed, "opencv")
            self.assertGreater(cfg.conf, 0.0)
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v

    def test_legacy_pipeline_aliases(self) -> None:
        import os
        from detect.config import DetectConfig

        os.environ["POSE_PIPELINE"] = "research"
        os.environ.pop("POSE_FEED", None)
        try:
            self.assertEqual(DetectConfig.from_env().pose_feed, "ffmpeg")
            os.environ["POSE_FEED"] = "serial"
            self.assertEqual(DetectConfig.from_env().pose_feed, "opencv")
        finally:
            os.environ.pop("POSE_PIPELINE", None)
            os.environ.pop("POSE_FEED", None)


class TestPoseDecodePure(unittest.TestCase):
    def test_decode_pose_frame_conf_and_layout(self) -> None:
        from pose.engine import decode_pose_frame
        from pose.letterbox import LetterboxMeta

        # Identity letterbox: 640 space == original
        meta = LetterboxMeta(orig_h=640, orig_w=640, scale=1.0, pad_x=0.0, pad_y=0.0, imgsz=640)
        # (300, 5+51) with one det above conf and one below
        preds = np.zeros((300, 56), dtype=np.float32)
        # det 0: bbox 10,20,30,40 conf 0.9, one keypoint at 15,25 conf 1
        preds[0, 0:5] = [10, 20, 30, 40, 0.9]
        preds[0, 5:8] = [15, 25, 1.0]
        preds[1, 0:5] = [1, 1, 2, 2, 0.05]  # below conf 0.15
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


class TestChunkSize(unittest.TestCase):
    def test_chunk_size_for_common_batches(self) -> None:
        from detect import _chunk_size

        self.assertEqual(_chunk_size(16), 48)
        self.assertEqual(_chunk_size(8), 48)
        self.assertEqual(_chunk_size(None), 48)
        # batch that does not divide 48
        self.assertEqual(_chunk_size(5), 15)  # lcm(5, 3)


if __name__ == "__main__":
    unittest.main()
