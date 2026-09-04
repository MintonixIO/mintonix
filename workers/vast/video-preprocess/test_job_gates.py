"""Pure job gate tests (no GPU / ffmpeg)."""

from __future__ import annotations

import unittest
from unittest import mock

import job


class TestLocalCallbackGate(unittest.TestCase):
    def test_rejects_local_source_with_callback(self):
        with self.assertRaises(RuntimeError) as ctx:
            job.run_preprocess_job({
                "callback_url": "https://proj.example/functions/v1/jobs/callback",
                "local_source": "/tmp/x.mp4",
                "local_output_dir": "/tmp/out",
                "annotation": {
                    "court": {
                        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
                    },
                },
            })
        self.assertIn("callback_url", str(ctx.exception))

    def test_rejects_local_output_with_callback(self):
        with self.assertRaises(RuntimeError) as ctx:
            job.run_preprocess_job({
                "callback_url": "https://proj.example/cb",
                "input_url": "https://cdn.example/v.mp4",
                "local_output_dir": "/tmp/out",
                "annotation": {
                    "court": {
                        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
                    },
                },
            })
        self.assertIn("callback_url", str(ctx.exception))

    def test_callback_requires_detections_upload_url(self):
        with self.assertRaises(RuntimeError) as ctx:
            job.run_preprocess_job({
                "callback_url": "https://proj.example/functions/v1/jobs/callback",
                "input_url": "https://cdn.example/v.mp4",
                "output_upload": {
                    "part_urls": ["https://x/p1"],
                    "complete_url": "https://x/c",
                    "abort_url": "https://x/a",
                    "part_size": 1,
                },
                "thumbnail_upload_url": "https://x/t",
                "preprocess_log_upload_url": "https://x/l",
                "annotation": {
                    "court": {
                        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
                    },
                },
            })
        self.assertIn("detections_upload_url", str(ctx.exception))

    def test_requires_input_without_local_source(self):
        with self.assertRaises(RuntimeError) as ctx:
            job.run_preprocess_job({
                "detections_upload_url": "https://example/d.json",
                "annotation": {
                    "court": {
                        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
                    },
                },
            })
        self.assertIn("input_url", str(ctx.exception))


class TestAnnotationRequired(unittest.TestCase):
    def test_missing_annotation(self):
        with mock.patch("os.path.isfile", return_value=True):
            with self.assertRaises(RuntimeError) as ctx:
                job.run_preprocess_job({
                    "local_source": "/tmp/x.mp4",
                    "local_output_dir": "/tmp/out",
                })
        self.assertIn("annotation", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
