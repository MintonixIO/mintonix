"""Tests for normalize_job remux/full pipelines and BWF orchestration mocks."""

import csv
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import test_support  # noqa: F401  # sets ALLOW_FILE_URLS
from test_support import VIDEO

import normalize as h
import ffmpeg_ops as fo


class TestRemuxPipeline(unittest.TestCase):
    """End-to-end over the remux path, which needs no GPU: an
    already-conformant source keeps the full orchestration (download → probe →
    remux-copy → thumbnail → upload) testable on GPU-less hosts, i.e. CI
    runners. Transcode e2e lives in TestFullPipeline and self-skips there."""

    @classmethod
    def setUpClass(cls):
        import subprocess
        cls._tmp = tempfile.TemporaryDirectory()
        cls.src = os.path.join(cls._tmp.name, "conformant.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc2=duration=2:size=1280x720:rate=30",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
             "-shortest", cls.src],
            check=True)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_remux_pipeline_with_thumbnail(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "normalized.mp4")
            thumb = os.path.join(tmp, "thumbnail.jpg")
            result = h.normalize_job(
                f"file://{self.src}", f"file://{out}",
                thumbnail_upload_url=f"file://{thumb}",
            )
            self.assertTrue(os.path.exists(thumb))
            self.assertGreater(os.path.getsize(thumb), 0)

        self.assertEqual(result["codec"], "h264")
        self.assertEqual(result["pixel_fmt"], "yuv420p")
        self.assertEqual(result["audio_codec"], "aac")
        self.assertAlmostEqual(result["duration"], result["source"]["duration"], delta=0.5)
        self.assertIsNotNone(result.get("thumbnail"))
        self.assertNotIn("thumbnail_error", result)
        self.assertLessEqual(result["thumbnail"]["width"], h.THUMBNAIL_WIDTH)
        # frame sampled from within the clip, never past the end
        self.assertLess(result["thumbnail"]["timestamp_sec"], result["duration"])

    def test_thumbnail_omitted_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "normalized.mp4")
            result = h.normalize_job(f"file://{self.src}", f"file://{out}")
        self.assertNotIn("thumbnail", result)

    def test_remux_does_not_require_gpu(self):
        """Remux path works without GPU — force use_gpu False and still succeed."""
        with mock.patch.object(fo, "use_gpu", return_value=False), \
             mock.patch.object(h, "use_gpu", return_value=False):
            with tempfile.TemporaryDirectory() as tmp:
                out = os.path.join(tmp, "normalized.mp4")
                result = h.normalize_job(f"file://{self.src}", f"file://{out}")
            self.assertEqual(result["codec"], "h264")


@unittest.skipUnless(h.use_gpu(), "transcode is GPU-only (h264_nvenc); no GPU on this host")
class TestFullPipeline(unittest.TestCase):
    def test_full_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "normalized.mp4")
            result = h.normalize_job(f"file://{VIDEO}", f"file://{out}")

        self.assertEqual(result["width"], 1920)
        self.assertEqual(result["height"], 1080)
        self.assertEqual(result["fps"], 30.0)
        self.assertEqual(result["codec"], "h264")
        self.assertEqual(result["audio_codec"], "aac")
        self.assertEqual(result["pixel_fmt"], "yuv420p")
        self.assertGreater(result["duration"], 0)
        self.assertGreater(result["file_size"], 0)
        # fps capping must drop frames, not stretch duration: output length
        # must match the source (regression guard for an input -r 30 that
        # reinterpreted >30fps sources to 2x duration).
        self.assertAlmostEqual(result["duration"], result["source"]["duration"], delta=0.5)


class TestBwfJobMock(unittest.TestCase):
    """Mocked BWF detect-then-encode orchestration (no GPU/OCR)."""

    def test_bwf_writes_ranges_manifest_and_result_keys(self):
        import job as jobmod

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "src.mp4")
            # tiny placeholder source file
            Path(src).write_bytes(b"fake")
            out = os.path.join(tmp, "normalized.mp4")
            Path(out).write_bytes(b"out")
            manifest_dest = os.path.join(tmp, "frame_ranges.csv")

            src_info = {
                "width": 1920, "height": 1080, "fps": 60.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": "aac", "duration": 10.0,
                "file_size": 100, "is_vfr": False,
            }
            dst_info = {
                "width": 1920, "height": 1080, "fps": 30.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": None, "duration": 2.0, "file_size": 50,
                "is_vfr": False,
            }
            ranges = [(0, 59), (120, 179)]  # 2s @ 60fps keep → 60 out frames @ 30

            def fake_download(url, dest, connections=None):
                Path(dest).write_bytes(b"src")

            def fake_encode_nvdec(inp, outp, info, rngs, fps, **kw):
                Path(outp).write_bytes(b"encoded")

            with mock.patch.object(jobmod, "download", side_effect=fake_download), \
                 mock.patch.object(jobmod, "probe", side_effect=[src_info, dst_info]), \
                 mock.patch.object(jobmod, "require_nvenc"), \
                 mock.patch.object(jobmod, "require_gpu_for_transcode"), \
                 mock.patch.object(jobmod, "use_gpu", return_value=True), \
                 mock.patch.object(jobmod, "has_scale_cuda", return_value=True), \
                 mock.patch.object(jobmod, "encode_frame_ranges_nvdec",
                                   side_effect=fake_encode_nvdec) as enc, \
                 mock.patch("valid_frames.detect_valid_ranges",
                            return_value=(ranges, 600)), \
                 mock.patch.object(jobmod, "is_vfr", return_value=False):
                result = jobmod.normalize_job(
                    f"file://{src}",
                    f"file://{out}",
                    valid_frames_config={
                        "court_corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "player_names": ["A", "B"],
                    },
                    manifest_upload_url=f"file://{manifest_dest}",
                )

            self.assertTrue(os.path.isfile(manifest_dest))
            with open(manifest_dest) as f:
                rows = list(csv.reader(f))
            self.assertEqual(rows[0],
                             ["old_start", "old_end", "new_start", "new_end"])
            # 60 src frames @ 60 → 30 out; second range same
            self.assertEqual(rows[1], ["0", "59", "0", "29"])
            self.assertEqual(rows[2], ["120", "179", "30", "59"])
            self.assertIn("valid_frames", result)
            self.assertEqual(result["valid_frames"]["valid_frame_count"], 60)
            self.assertEqual(result["valid_frames"]["primary_asset"],
                             "normalized.mp4")
            self.assertEqual(result["valid_frames"]["out_fps"], 30.0)
            enc.assert_called_once()
            # NVDEC path: strip_audio + force_cfr
            _, kwargs = enc.call_args
            self.assertTrue(kwargs.get("strip_audio", True))
            self.assertTrue(kwargs.get("force_cfr", True))

    def test_bwf_vfr_uses_cfr_mezzanine(self):
        """VFR BWF builds same-res CFR mezzanine then detect (not fail-closed)."""
        import job as jobmod
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "s")
            Path(src).write_bytes(b"x")
            out = os.path.join(tmp, "o.mp4")
            src_info = {
                "width": 1920, "height": 1080, "fps": 30.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": "aac", "duration": 5.0,
                "file_size": 10, "is_vfr": True,
                "r_frame_rate": "30/1", "avg_frame_rate": "0/0",
            }
            mez_info = {**src_info, "is_vfr": False}
            dst_info = {
                "width": 1920, "height": 1080, "fps": 30.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": None, "duration": 1.0, "file_size": 20,
                "is_vfr": False,
            }

            def fake_download(url, dest, connections=None):
                Path(dest).write_bytes(b"src")

            def fake_run(cmd, duration):
                Path(cmd[-1]).write_bytes(b"out")

            def fake_encode(inp, outp, info, rngs, fps, **kw):
                Path(outp).write_bytes(b"enc")

            probes = [src_info, mez_info, dst_info]

            with mock.patch.object(jobmod, "download", side_effect=fake_download), \
                 mock.patch.object(jobmod, "probe", side_effect=probes), \
                 mock.patch.object(jobmod, "require_nvenc"), \
                 mock.patch.object(jobmod, "require_gpu_for_transcode"), \
                 mock.patch.object(jobmod, "use_gpu", return_value=True), \
                 mock.patch.object(jobmod, "has_scale_cuda", return_value=True), \
                 mock.patch.object(jobmod, "is_vfr", side_effect=lambda i: bool(i.get("is_vfr"))), \
                 mock.patch.object(jobmod, "run_ffmpeg", side_effect=fake_run), \
                 mock.patch.object(jobmod, "encode_frame_ranges_nvdec",
                                   side_effect=fake_encode), \
                 mock.patch(
                     "ffmpeg_ops.build_cfr_mezzanine_cmd",
                     side_effect=lambda i, o, info: ["ffmpeg", "mez", o],
                 ) as mez_cmd, \
                 mock.patch("valid_frames.detect_valid_ranges",
                            return_value=([(0, 29)], 150)):
                result = jobmod.normalize_job(
                    f"file://{src}", f"file://{out}",
                    valid_frames_config={
                        "court_corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                        "player_names": ["A"],
                    },
                    manifest_upload_url=f"file://{tmp}/m.csv",
                )
            mez_cmd.assert_called()
            self.assertIn("valid_frames", result)

    def test_bwf_requires_primary_output(self):
        import job as jobmod
        with self.assertRaises(RuntimeError) as ctx:
            jobmod.normalize_job(
                "file:///x",
                output_upload_url=None,
                valid_frames_config={
                    "court_corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                    "player_names": ["A"],
                },
                manifest_upload_url="file:///m.csv",
            )
        self.assertIn("output_upload", str(ctx.exception))

    def test_primary_prefers_multipart_over_single_put(self):
        """Production path: output_upload → upload_multipart, not single PUT."""
        import job as jobmod

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "s")
            Path(src).write_bytes(b"src")
            out = os.path.join(tmp, "o.mp4")
            Path(out).write_bytes(b"out")
            src_info = {
                "width": 1280, "height": 720, "fps": 30.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": "aac", "duration": 2.0,
                "file_size": 10, "is_vfr": False,
            }
            dst_info = dict(src_info)

            def fake_download(url, dest, connections=None):
                Path(dest).write_bytes(b"src")

            multiparts = []

            def fake_mp(path, spec):
                multiparts.append((path, spec))
                # Simulate complete: write nothing; job already encoded to path.

            with mock.patch.object(jobmod, "download", side_effect=fake_download), \
                 mock.patch.object(jobmod, "probe", side_effect=[src_info, dst_info]), \
                 mock.patch.object(jobmod, "require_gpu_for_transcode"), \
                 mock.patch.object(jobmod, "use_gpu", return_value=False), \
                 mock.patch.object(jobmod, "needs_transcode", return_value=False), \
                 mock.patch.object(jobmod, "is_vfr", return_value=False), \
                 mock.patch.object(jobmod, "run_ffmpeg",
                                   side_effect=lambda cmd, d: Path(cmd[-1]).write_bytes(b"x")), \
                 mock.patch.object(jobmod, "upload_multipart", side_effect=fake_mp) as um, \
                 mock.patch.object(jobmod, "upload") as usingle:
                spec = {
                    "part_urls": ["https://example/p1"],
                    "complete_url": "https://example/c",
                    "abort_url": "https://example/a",
                    "part_size": 64 * 1024 * 1024,
                }
                jobmod.normalize_job(
                    f"file://{src}",
                    output_upload_url="https://example/should-not-use",
                    output_upload=spec,
                )
            um.assert_called_once()
            usingle.assert_not_called()
            self.assertEqual(multiparts[0][1]["complete_url"], spec["complete_url"])

    def test_original_archive_uses_multipart_when_provided(self):
        import job as jobmod

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "s")
            Path(src).write_bytes(b"src")
            src_info = {
                "width": 1280, "height": 720, "fps": 30.0,
                "codec": "h264", "pixel_fmt": "yuv420p",
                "audio_codec": "aac", "duration": 2.0,
                "file_size": 10, "is_vfr": False,
            }
            dst_info = dict(src_info)

            def fake_download(url, dest, connections=None):
                Path(dest).write_bytes(b"src")

            with mock.patch.object(jobmod, "download", side_effect=fake_download), \
                 mock.patch.object(jobmod, "probe", side_effect=[src_info, dst_info]), \
                 mock.patch.object(jobmod, "require_gpu_for_transcode"), \
                 mock.patch.object(jobmod, "use_gpu", return_value=False), \
                 mock.patch.object(jobmod, "needs_transcode", return_value=False), \
                 mock.patch.object(jobmod, "is_vfr", return_value=False), \
                 mock.patch.object(jobmod, "run_ffmpeg",
                                   side_effect=lambda cmd, d: Path(cmd[-1]).write_bytes(b"x")), \
                 mock.patch.object(jobmod, "upload_multipart") as um, \
                 mock.patch.object(jobmod, "upload") as usingle:
                orig = {
                    "part_urls": ["https://example/op1"],
                    "complete_url": "https://example/oc",
                    "abort_url": "https://example/oa",
                    "part_size": 64 * 1024 * 1024,
                }
                out_spec = {
                    "part_urls": ["https://example/p1"],
                    "complete_url": "https://example/c",
                    "abort_url": "https://example/a",
                    "part_size": 64 * 1024 * 1024,
                }
                progress = {}
                jobmod.normalize_job(
                    f"file://{src}",
                    output_upload=out_spec,
                    original_upload=orig,
                    progress=progress,
                )
            self.assertEqual(um.call_count, 2)  # original + primary
            usingle.assert_not_called()
            self.assertTrue(progress.get("original_archived"))


if __name__ == "__main__":
    unittest.main()
