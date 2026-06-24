import os
import tempfile
import unittest
from pathlib import Path

import normalize as h

VIDEO = str(Path(__file__).parent / "sample.mov")


class TestBuildFfmpegCmd(unittest.TestCase):
    def _cmd_str(self, info):
        return " ".join(h.build_ffmpeg_cmd("in", "out", info))

    def test_scales_down_4k(self):
        cmd = self._cmd_str({"width": 3840, "height": 2160, "fps": 30, "audio_codec": "aac"})
        self.assertIn("scale=1920:1080", cmd)

    def test_no_scale_when_under_1080p(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
        self.assertNotIn("scale=", cmd)

    def test_caps_fps_above_30(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 60, "audio_codec": "aac"})
        self.assertIn("fps=30", cmd)

    def test_no_fps_filter_when_at_30(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
        self.assertNotIn("fps=30", cmd)

    def test_no_fps_filter_when_under_30(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 24, "audio_codec": "aac"})
        self.assertNotIn("fps=30", cmd)

    def test_copies_aac_audio(self):
        cmd = h.build_ffmpeg_cmd("in", "out", {"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
        idx = cmd.index("-c:a")
        self.assertEqual(cmd[idx + 1], "copy")

    def test_transcodes_non_aac_audio(self):
        cmd = h.build_ffmpeg_cmd("in", "out", {"width": 1280, "height": 720, "fps": 30, "audio_codec": "opus"})
        idx = cmd.index("-c:a")
        self.assertEqual(cmd[idx + 1], "aac")

    def test_strips_audio_when_none(self):
        cmd = h.build_ffmpeg_cmd("in", "out", {"width": 1280, "height": 720, "fps": 30, "audio_codec": None})
        self.assertIn("-an", cmd)

    def test_always_includes_yuv420p(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
        self.assertIn("format=yuv420p", cmd)

    def test_portrait_scales_correctly(self):
        # 1080x1920 portrait 4K → should not upscale, already fits
        cmd = self._cmd_str({"width": 1080, "height": 1920, "fps": 30, "audio_codec": "aac"})
        self.assertNotIn("scale=", cmd)

    def test_portrait_4k_scales_down(self):
        # 2160x3840 portrait 4K → should scale down
        cmd = self._cmd_str({"width": 2160, "height": 3840, "fps": 30, "audio_codec": "aac"})
        self.assertIn("scale=", cmd)


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

    def test_full_pipeline_with_thumbnail(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "normalized.mp4")
            thumb = os.path.join(tmp, "thumbnail.jpg")
            result = h.normalize_job(
                f"file://{VIDEO}", f"file://{out}",
                thumbnail_upload_url=f"file://{thumb}",
            )
            # the JPEG was produced and uploaded to the same dir
            self.assertTrue(os.path.exists(thumb))
            self.assertGreater(os.path.getsize(thumb), 0)

        self.assertIsNotNone(result.get("thumbnail"))
        self.assertNotIn("thumbnail_error", result)
        self.assertLessEqual(result["thumbnail"]["width"], h.THUMBNAIL_WIDTH)
        self.assertGreater(result["thumbnail"]["file_size"], 0)
        # frame sampled from within the clip, never past the end
        self.assertLess(result["thumbnail"]["timestamp_sec"], result["duration"])

    def test_thumbnail_omitted_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "normalized.mp4")
            result = h.normalize_job(f"file://{VIDEO}", f"file://{out}")
        # no thumbnail requested -> no thumbnail keys (backward compatible)
        self.assertNotIn("thumbnail", result)


if __name__ == "__main__":
    unittest.main()
