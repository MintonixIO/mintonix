"""Tests for ffmpeg command construction, VFR helpers, segment parallel, GPU gates."""

import unittest
from unittest import mock

import test_support  # noqa: F401  # sets ALLOW_FILE_URLS

import normalize as h
import ffmpeg_ops as fo


class TestBuildFfmpegCmd(unittest.TestCase):
    """Command construction only — the transcode chain is GPU-only
    (NVDEC → scale_cuda → h264_nvenc), so these assert the CUDA chain
    regardless of what hardware the test host has."""

    def _cmd_str(self, info):
        return " ".join(h.build_ffmpeg_cmd("in", "out", info))

    def test_scales_down_4k(self):
        cmd = self._cmd_str({"width": 3840, "height": 2160, "fps": 30, "audio_codec": "aac"})
        self.assertIn("scale_cuda=1920:1080:format=nv12", cmd)

    def test_no_scale_when_under_1080p(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac",
                             "pixel_fmt": "yuv420p"})
        self.assertNotIn("scale_cuda", cmd)

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

    def test_always_uses_nvenc(self):
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
        self.assertIn("h264_nvenc", cmd)
        self.assertNotIn("libx264", cmd)

    def test_pixfmt_conversion_via_scale_cuda(self):
        # 10-bit source at target resolution: no scale needed, but the pixfmt
        # conversion still routes through scale_cuda (format=nv12).
        cmd = self._cmd_str({"width": 1920, "height": 1080, "fps": 30,
                             "audio_codec": "aac", "codec": "hevc",
                             "pixel_fmt": "yuv420p10le"})
        self.assertIn("scale_cuda=iw:ih:format=nv12", cmd)

    def test_portrait_scales_correctly(self):
        # 1080x1920 portrait → should not upscale, already fits
        cmd = self._cmd_str({"width": 1080, "height": 1920, "fps": 30, "audio_codec": "aac",
                             "pixel_fmt": "yuv420p"})
        self.assertNotIn("scale_cuda", cmd)

    def test_portrait_4k_scales_down(self):
        # 2160x3840 portrait 4K → should scale down
        cmd = self._cmd_str({"width": 2160, "height": 3840, "fps": 30, "audio_codec": "aac"})
        self.assertIn("scale_cuda=", cmd)

    def test_force_cfr_skips_copy_and_pins_fps(self):
        # A source that already matches spec would be remux-copied, but VFR
        # (or an explicit force_cfr) needs a CFR re-encode.
        info = {"width": 1280, "height": 720, "fps": 25, "audio_codec": "aac",
                "codec": "h264", "pixel_fmt": "yuv420p"}
        self.assertFalse(h.needs_transcode(info))
        cmd = " ".join(h.build_ffmpeg_cmd("in", "out", info, force_cfr=True))
        self.assertNotIn("-c copy", cmd)
        self.assertIn("fps=25", cmd)

    def test_force_cfr_still_caps_high_fps(self):
        info = {"width": 1280, "height": 720, "fps": 60, "audio_codec": "aac",
                "codec": "h264", "pixel_fmt": "yuv420p"}
        cmd = " ".join(h.build_ffmpeg_cmd("in", "out", info, force_cfr=True))
        self.assertIn("fps=30", cmd)
        self.assertNotIn("fps=60", cmd)


class TestVfrDetection(unittest.TestCase):
    def test_is_vfr_flag_from_probe_fields(self):
        self.assertTrue(h.is_vfr({"is_vfr": True}))
        self.assertFalse(h.is_vfr({"is_vfr": False}))

    def test_compute_is_vfr_heuristic(self):
        self.assertFalse(h.compute_is_vfr(30.0, 30.0))
        self.assertFalse(h.compute_is_vfr(29.97, 29.97))
        # >2% relative delta
        self.assertTrue(h.compute_is_vfr(60.0, 30.0))
        self.assertTrue(h.compute_is_vfr(30.0, 0.0))  # avg unset
        self.assertFalse(h.compute_is_vfr(0.0, 0.0))
        # within 2%
        self.assertFalse(h.compute_is_vfr(30.0, 30.0 * 1.01))

    def test_needs_scale_cuda_path(self):
        conformant = {"width": 1280, "height": 720, "fps": 30,
                      "codec": "h264", "pixel_fmt": "yuv420p", "audio_codec": "aac"}
        self.assertFalse(h.needs_scale_cuda_path(conformant))
        # force_cfr / VFR mezzanine alone does not imply scale_cuda
        self.assertFalse(h.needs_scale_cuda_path(conformant, force_cfr=True))
        fourk = {**conformant, "width": 3840, "height": 2160, "codec": "hevc"}
        self.assertTrue(h.needs_scale_cuda_path(fourk))
        pixfmt = {**conformant, "pixel_fmt": "yuv420p10le", "codec": "hevc"}
        self.assertTrue(h.needs_scale_cuda_path(pixfmt, force_cfr=True))

    def test_cfr_mezzanine_fps_only_when_yuv420p(self):
        """VFR mezzanine: same-res CFR pin without scale_cuda when pixfmt ok."""
        info = {"width": 1920, "height": 1080, "fps": 29.97,
                "pixel_fmt": "yuv420p", "codec": "h264"}
        cmd = " ".join(fo.build_cfr_mezzanine_cmd("in", "out", info))
        self.assertIn("fps=29.97", cmd)
        self.assertNotIn("scale_cuda", cmd)
        self.assertIn("h264_nvenc", cmd)

    def test_cfr_mezzanine_scale_cuda_for_pixfmt(self):
        info = {"width": 1920, "height": 1080, "fps": 30,
                "pixel_fmt": "yuv420p10le", "codec": "hevc"}
        cmd = " ".join(fo.build_cfr_mezzanine_cmd("in", "out", info))
        self.assertIn("fps=30", cmd)
        self.assertIn("scale_cuda=iw:ih:format=nv12", cmd)


class TestSegmentParallelHelpers(unittest.TestCase):
    def test_plan_segment_splits_empty_keyframes_returns_none(self):
        # Unsafe equal wall splits removed — caller falls back to n=1.
        self.assertIsNone(fo.plan_segment_splits(100.0, [], n=4))

    def test_plan_segment_splits_keyframe_aligned(self):
        kfs = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0]
        ranges = fo.plan_segment_splits(100.0, kfs, n=4)
        self.assertIsNotNone(ranges)
        self.assertEqual(len(ranges), 4)
        # Internal cut points must land on keyframes
        cuts = [ranges[i][1] for i in range(len(ranges) - 1)]
        for c in cuts:
            self.assertIn(c, kfs)
        self.assertEqual(ranges[0][0], 0.0)
        self.assertEqual(ranges[-1][1], 100.0)

    def test_should_segment_parallel_threshold(self):
        # Default threshold is 600s; short clips stay single-stream.
        self.assertFalse(h.should_segment_parallel(30.0))
        self.assertTrue(h.should_segment_parallel(h.SEGMENT_PARALLEL_THRESHOLD_SEC))

    def test_build_window_encode_cmd_segment_defaults(self):
        """Keyframe-aligned full-timeline segment: fast seek, AAC for concat."""
        info = {"width": 3840, "height": 2160, "fps": 60, "audio_codec": "aac",
                "pixel_fmt": "yuv420p"}
        cmd = " ".join(h.build_window_encode_cmd(
            "in", "out", info, 10.0, 40.0, strip_audio=False, accurate_seek=False,
        ))
        self.assertIn("-ss 10.000", cmd)
        self.assertIn("-t 30.000", cmd)
        self.assertIn("h264_nvenc", cmd)
        self.assertIn("scale_cuda", cmd)
        # AAC re-encode (not copy) for concat safety
        self.assertIn("aac", cmd)


class TestRequireGpu(unittest.TestCase):
    def test_remux_skips_gpu_requirement(self):
        info = {"width": 1280, "height": 720, "fps": 30, "codec": "h264",
                "pixel_fmt": "yuv420p", "audio_codec": "aac"}
        with mock.patch.object(fo, "use_gpu", return_value=False):
            # Should not raise for remux-eligible
            fo.require_gpu_for_transcode(info, force_cfr=False)

    def test_transcode_requires_gpu(self):
        info = {"width": 3840, "height": 2160, "fps": 60, "codec": "hevc",
                "pixel_fmt": "yuv420p", "audio_codec": "aac"}
        with mock.patch.object(fo, "use_gpu", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                fo.require_gpu_for_transcode(info)
            self.assertIn("GPU", str(ctx.exception))

    def test_scale_cuda_missing_raises(self):
        info = {"width": 3840, "height": 2160, "fps": 30, "codec": "hevc",
                "pixel_fmt": "yuv420p10le", "audio_codec": "aac"}
        with mock.patch.object(fo, "use_gpu", return_value=True), \
             mock.patch.object(fo, "has_scale_cuda", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                fo.require_gpu_for_transcode(info)
            self.assertIn("scale_cuda", str(ctx.exception))

    def test_force_cfr_yuv420p_does_not_require_scale_cuda(self):
        """CFR pin / VFR mezzanine on delivery-compatible source: NVENC only."""
        info = {"width": 1280, "height": 720, "fps": 25, "codec": "h264",
                "pixel_fmt": "yuv420p", "audio_codec": "aac"}
        self.assertFalse(fo.needs_scale_cuda_path(info, force_cfr=True))
        with mock.patch.object(fo, "use_gpu", return_value=True), \
             mock.patch.object(fo, "has_scale_cuda", return_value=False):
            # Must not raise — matches mezzanine/build_ffmpeg_cmd without scale_cuda
            fo.require_gpu_for_transcode(info, force_cfr=True)


if __name__ == "__main__":
    unittest.main()
