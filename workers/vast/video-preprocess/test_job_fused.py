"""Fused encode-then-detect job (CPU mocks, no GPU / ffmpeg)."""

from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import detect_job
import job
from job import JobFailed


COURT = {
    "court": {
        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
    },
}

PROBE = {
    "width": 1920,
    "height": 1080,
    "fps": 30.0,
    "duration": 1.0,
    "codec": "h264",
    "audio_codec": "aac",
    "pixel_fmt": "yuv420p",
    "file_size": 100,
    "is_vfr": False,
}


def _multipart() -> dict:
    return {
        "part_urls": ["https://example/p1"],
        "complete_url": "https://example/complete",
        "abort_url": "https://example/abort",
        "part_size": 64 * 1024 * 1024,
    }


def _prod_body(**extra) -> dict:
    body = {
        "request_id": "j1",
        "input_url": "https://cdn.example/v.mp4",
        "output_upload": _multipart(),
        "thumbnail_upload_url": "https://cdn.example/t.jpg",
        "preprocess_log_upload_url": "https://cdn.example/l.json",
        "detections_upload_url": "https://cdn.example/d.json",
        "annotation": COURT,
    }
    body.update(extra)
    return body


@contextmanager
def _job_patches(*, detect_error: BaseException | None = None):
    uploaded: list[str] = []

    def fake_download(url, dest, **k):
        Path(dest).write_bytes(b"src")

    def fake_encode(src, dst, info):
        Path(dst).write_bytes(b"mp4")
        return dict(PROBE)

    def fake_thumb(dst, thumb_path, duration):
        Path(thumb_path).write_bytes(b"jpg")
        return {"width": 320, "height": 180}

    def fake_multipart(path, spec):
        uploaded.append("multipart:normalized.mp4")

    def fake_upload(path, url):
        uploaded.append(Path(path).name)

    def fake_upload_file(path, url, **k):
        uploaded.append(Path(path).name)

    def fake_detect(detector, video_path, dest_json, **k):
        if detect_error is not None:
            raise detect_error
        Path(dest_json).write_text("{}", encoding="utf-8")
        return {
            "frame_count": 12,
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "segments": 1,
        }

    with (
        mock.patch("normalize.require_nvenc"),
        mock.patch("normalize.probe", return_value=dict(PROBE)),
        mock.patch("normalize.encode_full", side_effect=fake_encode),
        mock.patch("normalize.extract_thumbnail", side_effect=fake_thumb),
        mock.patch("io_util.download", side_effect=fake_download),
        mock.patch("io_util.upload_multipart", side_effect=fake_multipart),
        mock.patch("io_util.upload", side_effect=fake_upload),
        mock.patch("io_util.upload_file", side_effect=fake_upload_file),
        mock.patch("worker_info.collect_worker_info", return_value={"gpu": "test"}),
        mock.patch.object(
            detect_job, "run_detect_on_local_video", side_effect=fake_detect
        ) as det,
    ):
        yield uploaded, det


class TestFusedJob(unittest.TestCase):
    def test_detect_runs_when_upload_url_present(self):
        with _job_patches() as (uploaded, det):
            result = job.run_preprocess_job(_prod_body(), detector=mock.MagicMock())
        det.assert_called_once()
        self.assertEqual(result["frame_count"], 12)
        self.assertIn("gpu_detect_sec", result["stage_timings"])
        self.assertNotIn("detect_sec", result["stage_timings"])
        self.assertIn("multipart:normalized.mp4", uploaded)
        self.assertIn("thumbnail.jpg", uploaded)
        self.assertIn("preprocess-log.json", uploaded)
        self.assertIn("detections.json", uploaded)

    def test_local_without_detector_is_encode_only(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "in.mp4"
            src.write_bytes(b"src")
            out = Path(td) / "out"

            def fake_encode(src_path, dst, info):
                Path(dst).write_bytes(b"mp4")
                return dict(PROBE)

            def fake_thumb(dst, thumb_path, duration):
                Path(thumb_path).write_bytes(b"jpg")
                return {"width": 320}

            with (
                mock.patch("normalize.require_nvenc"),
                mock.patch("normalize.probe", return_value=dict(PROBE)),
                mock.patch("normalize.encode_full", side_effect=fake_encode),
                mock.patch("normalize.extract_thumbnail", side_effect=fake_thumb),
                mock.patch("worker_info.collect_worker_info", return_value={}),
                mock.patch.object(detect_job, "run_detect_on_local_video") as det,
            ):
                result = job.run_preprocess_job(
                    {
                        "request_id": "debug",
                        "local_source": str(src),
                        "local_output_dir": str(out),
                        "annotation": COURT,
                    },
                    detector=None,
                )
            det.assert_not_called()
            self.assertNotIn("frame_count", result)
            self.assertNotIn("gpu_detect_sec", result["stage_timings"])
            self.assertTrue((out / "normalized.mp4").is_file())
            self.assertTrue((out / "preprocess-log.json").is_file())
            self.assertFalse((out / "detections.json").exists())

    def test_detect_failure_after_encode_uploads_mp4_and_log(self):
        with _job_patches(detect_error=RuntimeError("gpu exploded")) as (
            uploaded,
            det,
        ):
            with self.assertRaises(JobFailed) as ctx:
                job.run_preprocess_job(_prod_body(), detector=mock.MagicMock())
        self.assertIn("gpu exploded", str(ctx.exception))
        self.assertEqual(ctx.exception.extra.get("width"), 1920)
        det.assert_called_once()
        self.assertIn("multipart:normalized.mp4", uploaded)
        self.assertIn("thumbnail.jpg", uploaded)
        self.assertIn("preprocess-log.json", uploaded)
        self.assertNotIn("detections.json", uploaded)
        self.assertGreaterEqual(uploaded.count("preprocess-log.json"), 1)

    def test_log_includes_gpu_detect_sec_not_ncc_detect_sec(self):
        captured: list[dict] = []

        real_write = job._write_json

        def capture_write(path, payload):
            captured.append(json.loads(json.dumps(payload)))
            return real_write(path, payload)

        with _job_patches() as (_uploaded, _det):
            with mock.patch.object(job, "_write_json", side_effect=capture_write):
                job.run_preprocess_job(_prod_body(), detector=mock.MagicMock())
        self.assertGreaterEqual(len(captured), 1)
        timings = captured[-1]["timings"]
        self.assertIn("gpu_detect_sec", timings)
        self.assertNotIn("detect_sec", timings)

    def test_local_with_detector_writes_detections(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "in.mp4"
            src.write_bytes(b"src")
            out = Path(td) / "out"

            def fake_encode(src_path, dst, info):
                Path(dst).write_bytes(b"mp4")
                return dict(PROBE)

            def fake_thumb(dst, thumb_path, duration):
                Path(thumb_path).write_bytes(b"jpg")
                return {"width": 320}

            def fake_detect(detector, video_path, dest_json, **k):
                Path(dest_json).write_text("{}", encoding="utf-8")
                return {
                    "frame_count": 4,
                    "width": 1920,
                    "height": 1080,
                    "fps": 30,
                    "segments": 1,
                }

            with (
                mock.patch("normalize.require_nvenc"),
                mock.patch("normalize.probe", return_value=dict(PROBE)),
                mock.patch("normalize.encode_full", side_effect=fake_encode),
                mock.patch("normalize.extract_thumbnail", side_effect=fake_thumb),
                mock.patch("worker_info.collect_worker_info", return_value={}),
                mock.patch.object(
                    detect_job, "run_detect_on_local_video", side_effect=fake_detect
                ),
            ):
                result = job.run_preprocess_job(
                    {
                        "request_id": "debug",
                        "local_source": str(src),
                        "local_output_dir": str(out),
                        "annotation": COURT,
                    },
                    detector=mock.MagicMock(),
                )
            self.assertEqual(result["frame_count"], 4)
            self.assertTrue((out / "detections.json").is_file())


if __name__ == "__main__":
    unittest.main()
