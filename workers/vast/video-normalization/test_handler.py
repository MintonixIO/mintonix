import csv
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

import normalize as h
import valid_frames as vf

VIDEO = str(Path(__file__).parent / "sample.mov")


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
        cmd = self._cmd_str({"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac"})
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
        cmd = self._cmd_str({"width": 1080, "height": 1920, "fps": 30, "audio_codec": "aac"})
        self.assertNotIn("scale_cuda", cmd)

    def test_portrait_4k_scales_down(self):
        # 2160x3840 portrait 4K → should scale down
        cmd = self._cmd_str({"width": 2160, "height": 3840, "fps": 30, "audio_codec": "aac"})
        self.assertIn("scale_cuda=", cmd)

    def test_force_cfr_skips_copy_and_pins_fps(self):
        # A source that already matches spec would be remux-copied, but a
        # valid-frames request needs a CFR re-encode so frame indices and
        # timestamps agree.
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


class TestValidFramesLogic(unittest.TestCase):
    """Pure-logic parts of valid_frames.py: no ffmpeg decode, no OCR model,
    so these run in any environment (mirrors this file's no-SDK-needed design
    for the rest of the suite)."""

    def test_hysteresis_holds_between_on_off(self):
        # 0.75 is between OFF(0.70) and ON(0.80): once ON, stays on; once OFF
        # (never triggered), stays off.
        ncc = np.array([0.5, 0.9, 0.75, 0.75, 0.6, 0.75, 0.9], np.float32)
        out = vf._hysteresis(ncc, 0.80, 0.70)
        self.assertListEqual(list(out), [False, True, True, True, False, False, True])

    def test_runs_of_true_respects_min_len(self):
        mask = np.array([1, 1, 0, 1, 1, 1, 1, 0, 1], dtype=bool)
        self.assertEqual(vf._runs_of_true(mask, 3), [(3, 6)])
        self.assertEqual(vf._runs_of_true(mask, 1), [(0, 1), (3, 6), (8, 8)])

    def test_compute_valid_ranges_upsamples_per_second_score(self):
        # 3 fps, 2 seconds of court visibility; scoreboard visible only in
        # second 0 -> only frames [0,2] should be valid.
        court = np.array([True, True, True, True, True, True])
        svis_per_sec = [True, False]
        ranges = vf.compute_valid_ranges(court, svis_per_sec, fps=3, min_valid_run=1)
        self.assertEqual(ranges, [(0, 2)])

    def test_compute_valid_ranges_requires_both_signals(self):
        court = np.array([False, False, True, True, True, True])
        svis_per_sec = [True, True]
        ranges = vf.compute_valid_ranges(court, svis_per_sec, fps=3, min_valid_run=1)
        self.assertEqual(ranges, [(2, 5)])

    def test_build_frame_manifest_sequential_new_indices(self):
        manifest = vf.build_frame_manifest([(10, 12), (20, 21)])
        self.assertEqual(manifest, [(10, 0), (11, 1), (12, 2), (20, 3), (21, 4)])

    def test_write_manifest_csv_roundtrip(self):
        manifest = vf.build_frame_manifest([(5, 6), (100, 100)])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "manifest.csv")
            vf.write_manifest_csv(manifest, path)
            with open(path) as f:
                rows = list(csv.reader(f))
        self.assertEqual(rows[0], ["old_frame", "new_frame"])
        self.assertEqual(rows[1:], [["5", "0"], ["6", "1"], ["100", "2"]])

    def test_build_select_expr_joins_ranges(self):
        expr = vf.build_select_expr([(0, 10), (20, 30)])
        self.assertEqual(expr, "between(n,0,10)+between(n,20,30)")

    def test_green_mask_scales_to_video_dimensions(self):
        # Corners spanning the full frame must cover the whole detection
        # canvas whatever the video's resolution — corners are in the video's
        # own pixel coordinates, not a fixed 1920-wide one.
        for w, hgt in [(1920, 1080), (1280, 720), (640, 480)]:
            corners = [[0, 0], [w, 0], [w, hgt], [0, hgt]]
            _, area = vf._green_mask(corners, w, hgt)
            self.assertGreater(area, 0.99 * vf.SW * vf.SH, f"{w}x{hgt}")

    def test_build_valid_frames_cmd(self):
        cmd = h.build_valid_frames_cmd("in.mp4", "out.mp4",
                                       vf.build_select_expr([(0, 5)]))
        self.assertIn("-an", cmd)
        self.assertIn("select='between(n,0,5)',setpts=N/FRAME_RATE/TB", cmd)
        self.assertIn("h264_nvenc", cmd)


VALID_VF_CONFIG = {
    "court_corners": [[667, 398], [1252, 398], [1490, 990], [436, 992]],
    "scoreboard_crop": {"x": 175, "y": 55, "w": 1525, "h": 360},
    "score_sub_crop": {"x": 0, "y": 0, "w": 345, "h": 95},
    "row_split_y": 40,
    "player_names": ["SHI", "AXELSEN"],
}


class TestValidateValidFramesRequest(unittest.TestCase):
    def test_accepts_complete_request(self):
        self.assertIsNone(h.validate_valid_frames_request(VALID_VF_CONFIG, True, True))

    def test_requires_upload_destinations(self):
        self.assertIn("destination",
                      h.validate_valid_frames_request(VALID_VF_CONFIG, False, True))
        self.assertIn("manifest_upload_url",
                      h.validate_valid_frames_request(VALID_VF_CONFIG, True, False))

    def test_rejects_empty_player_names(self):
        # '' or [] would compile to a match-everything regex, silently
        # degrading validity to court-only.
        for names in ([], [""], ["  "], "SHI", None):
            cfg = {**VALID_VF_CONFIG, "player_names": names}
            self.assertIn("player_names",
                          h.validate_valid_frames_request(cfg, True, True))

    def test_rejects_missing_or_malformed_geometry(self):
        for key, bad in [("court_corners", [[0, 0], [1, 1]]),
                         ("court_corners", None),
                         ("scoreboard_crop", {"x": 0, "y": 0, "w": 10}),
                         ("score_sub_crop", "0,0,345,95"),
                         ("row_split_y", None)]:
            cfg = {**VALID_VF_CONFIG, key: bad}
            self.assertIn(key, h.validate_valid_frames_request(cfg, True, True))


class TestYoutubeSourceDetection(unittest.TestCase):
    def test_youtube_urls(self):
        for url in ("https://www.youtube.com/watch?v=nUKzwRPI68A",
                    "https://youtube.com/watch?v=abc",
                    "https://m.youtube.com/watch?v=abc",
                    "https://youtu.be/nUKzwRPI68A",
                    "http://www.youtube.com/shorts/abc"):
            self.assertTrue(h.is_youtube_url(url), url)

    def test_non_youtube_urls(self):
        # presigned B2/S3 GETs and lookalike hosts must take the plain
        # download path, never yt-dlp
        for url in ("https://s3.us-west-004.backblazeb2.com/bucket/k?sig=x",
                    "file:///tmp/source.mp4",
                    "https://notyoutube.com/watch?v=abc",
                    "https://evil.com/youtu.be/abc",
                    "https://youtube.com.evil.com/watch?v=abc",
                    ""):
            self.assertFalse(h.is_youtube_url(url), url)


class TestPostCallback(unittest.TestCase):
    """post_callback against a real local HTTP server: the Bearer token and
    JSON payload must arrive intact, and 4xx must not trigger the retry loop
    (a rejected/stale token can't be fixed by retrying)."""

    def _serve(self, status):
        import http.server
        import json as jsonlib
        import threading

        received = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                received["auth"] = self.headers.get("Authorization")
                received["body"] = jsonlib.loads(
                    self.rfile.read(int(self.headers["Content-Length"])))
                received["count"] = received.get("count", 0) + 1
                self.send_response(status)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_port}/callback", received

    def test_success_delivers_token_and_payload(self):
        url, received = self._serve(200)
        status = h.post_callback(url, "tok123", {"request_id": "j1", "status": "success"})
        self.assertEqual(status, 200)
        self.assertEqual(received["auth"], "Bearer tok123")
        self.assertEqual(received["body"]["request_id"], "j1")

    def test_4xx_is_terminal_no_retries(self):
        url, received = self._serve(403)
        status = h.post_callback(url, "stale", {"request_id": "j1"}, attempts=3)
        self.assertEqual(status, 403)
        self.assertEqual(received["count"], 1)


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


if __name__ == "__main__":
    unittest.main()
