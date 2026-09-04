"""Detect-only retry job (CPU mocks)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import detect_job
from detect.types import FrameResult, ShuttleCandidate


class TestDownloadJsonFailClosed(unittest.TestCase):
    def test_download_json_raises_when_url_fails(self) -> None:
        with patch.object(
            detect_job, "download", side_effect=RuntimeError("connection refused")
        ):
            with self.assertRaises(RuntimeError) as ctx:
                detect_job._download_json(
                    "https://example.invalid/preprocess-log.json",
                    label="preprocess-log.json",
                )
        self.assertIn("preprocess-log.json", str(ctx.exception))
        self.assertIn("download failed", str(ctx.exception))

    def test_download_json_raises_when_body_is_not_object(self) -> None:
        def write_array(url, dest, **kwargs):
            Path(dest).write_text("[]", encoding="utf-8")

        with patch.object(detect_job, "download", new=write_array):
            with self.assertRaises(RuntimeError) as ctx:
                detect_job._download_json(
                    "https://example/annotation.json", label="annotation.json"
                )
        self.assertIn("annotation.json", str(ctx.exception))
        self.assertIn("download failed", str(ctx.exception))

    def test_download_json_none_when_url_missing(self) -> None:
        self.assertIsNone(detect_job._download_json(None, label="annotation.json"))
        self.assertIsNone(detect_job._download_json("", label="preprocess-log.json"))


class TestRunDetectJob(unittest.TestCase):
    def test_raises_before_gpu_when_preprocess_log_url_unresolved(self) -> None:
        detector = MagicMock()
        with (
            patch.object(
                detect_job,
                "download",
                side_effect=lambda url, dest, **k: Path(dest).write_bytes(b"x"),
            ),
            patch.object(detect_job, "_download_json", return_value=None),
            patch.object(detect_job, "run_detect_on_local_video") as gpu,
            patch.object(detect_job, "upload_file"),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                detect_job.run_detect_job(
                    {
                        "request_id": "j1",
                        "input_url": "https://example/in.mp4",
                        "output_upload_url": "https://example/out.json",
                        "preprocess_log_url": (
                            "https://example.invalid/preprocess-log.json"
                        ),
                    },
                    detector,
                )
            gpu.assert_not_called()
        self.assertIn("preprocess-log.json", str(ctx.exception))
        self.assertIn("download failed", str(ctx.exception))

    def test_raises_before_gpu_when_annotation_url_unresolved(self) -> None:
        detector = MagicMock()
        with (
            patch.object(
                detect_job,
                "download",
                side_effect=lambda url, dest, **k: Path(dest).write_bytes(b"x"),
            ),
            patch.object(detect_job, "_download_json", return_value=None),
            patch.object(detect_job, "run_detect_on_local_video") as gpu,
            patch.object(detect_job, "upload_file"),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                detect_job.run_detect_job(
                    {
                        "request_id": "j1",
                        "input_url": "https://example/in.mp4",
                        "output_upload_url": "https://example/out.json",
                        "annotation_url": "https://example/annotation.json",
                        "preprocess_log": {"frame_shifts": []},
                    },
                    detector,
                )
            gpu.assert_not_called()
        self.assertIn("annotation.json", str(ctx.exception))
        self.assertIn("download failed", str(ctx.exception))

    def test_run_detect_on_local_video_writes_engine_json(self) -> None:
        frames = [
            FrameResult(frame=i, poses=[], shuttle=[ShuttleCandidate(0.1, 0.2, 0.3)])
            for i in range(2)
        ]

        class FakeDet:
            def run(self, video_path):
                yield frames

        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "d.json"
            video = Path(td) / "v.mp4"
            video.write_bytes(b"x")
            with (
                patch.object(
                    detect_job,
                    "probe_video",
                    return_value={
                        "fps": 30.0,
                        "width": 1920,
                        "height": 1080,
                        "frame_count_hint": 2,
                    },
                ),
                patch.object(
                    detect_job,
                    "build_segments_for_video",
                    return_value=[
                        {
                            "start_frame": 0,
                            "end_frame": 1,
                            "score": {"t1": 5, "t2": 3},
                            "score_conf": 0.9,
                        }
                    ],
                ),
            ):
                result = detect_job.run_detect_on_local_video(
                    FakeDet(),
                    video,
                    dest,
                    request_id="job-1",
                    annotation=None,
                    preprocess_log=None,
                )
            self.assertEqual(result["frame_count"], 2)
            self.assertEqual(result["width"], 1920)
            body = json.loads(dest.read_text())
            self.assertEqual(body["job_id"], "job-1")
            self.assertEqual(len(body["frames"]), 2)
            self.assertEqual(len(body["segments"]), 1)


    def test_run_detect_job_downloads_writes_uploads(self) -> None:
        detector = MagicMock()
        uploaded: list[str] = []

        def fake_download(url, dest, **k):
            Path(dest).write_bytes(b"mp4")

        def fake_detect(det, video_path, dest_json, **k):
            Path(dest_json).write_text("{}", encoding="utf-8")
            return {
                "frame_count": 3,
                "width": 64,
                "height": 64,
                "fps": 30,
                "segments": 1,
            }

        def fake_upload(path, url, **k):
            uploaded.append(str(url))

        with (
            patch.object(detect_job, "download", side_effect=fake_download),
            patch.object(
                detect_job, "run_detect_on_local_video", side_effect=fake_detect
            ),
            patch.object(detect_job, "upload_file", side_effect=fake_upload),
        ):
            result = detect_job.run_detect_job(
                {
                    "request_id": "j1",
                    "input_url": "https://example/in.mp4",
                    "output_upload_url": "https://example/out.json",
                    "annotation": {"court": {}},
                    "preprocess_log": {"frame_shifts": []},
                },
                detector,
            )
        self.assertEqual(result["frame_count"], 3)
        self.assertEqual(result["width"], 64)
        self.assertEqual(uploaded, ["https://example/out.json"])


if __name__ == "__main__":
    unittest.main()
