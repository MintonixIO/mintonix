"""Tests for valid_frames logic, request validation, annotation mapping, OCR/crop."""

import csv
import os
import tempfile
import unittest

import numpy as np

import test_support  # noqa: F401  # sets ALLOW_FILE_URLS

import normalize as h
import valid_frames as vf


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

    def test_build_range_manifest_compact(self):
        rm = vf.build_range_manifest([(10, 12), (20, 21)])
        self.assertEqual(rm, [
            {"old_start": 10, "old_end": 12, "new_start": 0, "new_end": 2},
            {"old_start": 20, "old_end": 21, "new_start": 3, "new_end": 4},
        ])
        self.assertEqual(vf.count_kept_frames([(10, 12), (20, 21)]), 5)

    def test_build_range_manifest_60_to_30_output_space(self):
        # 60 source frames @ 60fps → 1s → 30 output frames @ 30fps
        rm = vf.build_range_manifest([(0, 59)], src_fps=60.0, out_fps=30.0)
        self.assertEqual(rm[0]["old_start"], 0)
        self.assertEqual(rm[0]["old_end"], 59)
        self.assertEqual(rm[0]["new_start"], 0)
        self.assertEqual(rm[0]["new_end"], 29)
        self.assertEqual(
            vf.count_kept_frames([(0, 59)], src_fps=60.0, out_fps=30.0), 30,
        )
        # 1:1 when already ≤30
        rm2 = vf.build_range_manifest([(0, 29)], src_fps=30.0, out_fps=30.0)
        self.assertEqual(rm2[0]["new_end"], 29)

    def test_write_range_manifest_csv_roundtrip(self):
        rm = vf.build_range_manifest([(5, 6), (100, 100)])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "frame_ranges.csv")
            vf.write_range_manifest_csv(rm, path)
            with open(path) as f:
                rows = list(csv.reader(f))
        self.assertEqual(rows[0], ["old_start", "old_end", "new_start", "new_end"])
        self.assertEqual(rows[1:], [["5", "6", "0", "1"], ["100", "100", "2", "2"]])

    def test_green_mask_scales_to_video_dimensions(self):
        # Corners spanning the full frame must cover the whole detection
        # canvas whatever the video's resolution — corners are in the video's
        # own pixel coordinates, not a fixed 1920-wide one.
        for w, hgt in [(1920, 1080), (1280, 720), (640, 480)]:
            corners = [[0, 0], [w, 0], [w, hgt], [0, hgt]]
            _, area = vf._green_mask(corners, w, hgt)
            self.assertGreater(area, 0.99 * vf.SW * vf.SH, f"{w}x{hgt}")

    def test_frame_ranges_to_windows(self):
        wins = h.frame_ranges_to_windows([(0, 29), (90, 119)], fps=30.0)
        self.assertEqual(wins, [(0.0, 1.0), (3.0, 4.0)])

    def test_split_long_windows(self):
        wins = h.split_long_windows([(0.0, 3600.0)], n=4, total_dur=3600.0)
        self.assertGreaterEqual(len(wins), 2)
        self.assertAlmostEqual(wins[0][0], 0.0)
        self.assertAlmostEqual(wins[-1][1], 3600.0)
        for i in range(len(wins) - 1):
            self.assertAlmostEqual(wins[i][1], wins[i + 1][0])

    def test_build_window_encode_cmd_nvdec_accurate_bwf(self):
        info = {"width": 3840, "height": 2160, "fps": 60, "audio_codec": "aac",
                "pixel_fmt": "yuv420p"}
        cmd = h.build_window_encode_cmd(
            "in.mp4", "out.mp4", info, 1.0, 3.0,
            force_cfr=True, strip_audio=True, accurate_seek=True,
        )
        joined = " ".join(cmd)
        self.assertIn("-hwaccel cuda", joined)
        self.assertIn("h264_nvenc", joined)
        self.assertIn("-an", joined)
        # accurate seek: -ss after -i
        i_idx = cmd.index("-i")
        ss_positions = [i for i, t in enumerate(cmd) if t == "-ss"]
        self.assertTrue(any(p > i_idx for p in ss_positions))
        self.assertIn("fps=30", joined)
        self.assertIn("scale_cuda=1920:1080:format=nv12", joined)
        self.assertNotIn("hwupload_cuda", joined)

    def test_build_window_encode_cmd_fast_seek_keeps_audio_path(self):
        info = {"width": 1280, "height": 720, "fps": 30, "audio_codec": "aac",
                "pixel_fmt": "yuv420p"}
        cmd = h.build_window_encode_cmd(
            "in.mp4", "out.mp4", info, 0.0, 10.0,
            force_cfr=False, strip_audio=False, accurate_seek=False,
        )
        # fast seek: -ss before -i
        self.assertEqual(cmd[cmd.index("-ss") + 1], "0.000000")
        self.assertLess(cmd.index("-ss"), cmd.index("-i"))
        self.assertIn("aac", cmd)


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

    def test_accepts_simplified_shape_with_defaults(self):
        # scoreboard geometry optional — job fills after probe
        simple = {
            "court_corners": VALID_VF_CONFIG["court_corners"],
            "player_names": ["SHI", "AXELSEN"],
        }
        self.assertIsNone(h.validate_valid_frames_request(simple, True, True))

    def test_apply_defaults_fills_quadrant(self):
        simple = {
            "court_corners": VALID_VF_CONFIG["court_corners"],
            "player_names": ["SHI"],
        }
        filled = h.apply_valid_frames_defaults(simple, 1920, 1080)
        self.assertEqual(filled["scoreboard_crop"],
                         {"x": 0, "y": 0, "w": 960, "h": 540})
        # score_sub_crop is band-relative full band {0,0,w,h}
        self.assertEqual(filled["score_sub_crop"],
                         {"x": 0, "y": 0, "w": 960, "h": 540})
        self.assertEqual(filled["row_split_y"], 270.0)

    def test_apply_defaults_sub_crop_band_relative_not_absolute(self):
        # Non-origin scoreboard: missing sub → full band at 0,0 inside band
        cfg = {
            "court_corners": VALID_VF_CONFIG["court_corners"],
            "player_names": ["SHI"],
            "scoreboard_crop": {"x": 100, "y": 50, "w": 200, "h": 80},
        }
        filled = h.apply_valid_frames_defaults(cfg, 1920, 1080)
        self.assertEqual(filled["score_sub_crop"],
                         {"x": 0, "y": 0, "w": 200, "h": 80})
        # Absolute-equal-to-crop annotation → normalize to relative full band
        cfg2 = {
            **cfg,
            "score_sub_crop": {"x": 100, "y": 50, "w": 200, "h": 80},
        }
        filled2 = h.apply_valid_frames_defaults(cfg2, 1920, 1080)
        self.assertEqual(filled2["score_sub_crop"],
                         {"x": 0, "y": 0, "w": 200, "h": 80})

    def test_requires_upload_destinations(self):
        err = h.validate_valid_frames_request(VALID_VF_CONFIG, False, True)
        self.assertIn("output_upload", err)
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
                         ("row_split_y", "nope")]:
            cfg = {**VALID_VF_CONFIG, key: bad}
            self.assertIn(key, h.validate_valid_frames_request(cfg, True, True))


class TestAnnotationMapping(unittest.TestCase):
    def test_maps_corners_and_display_names(self):
        ann = {
            "court": {
                "corners": [[1, 2], [3, 4], [5, 6], [7, 8]],
                "scoreboard_crop": {"x": 0, "y": 0, "w": 100, "h": 50},
                "score_sub_crop": {"x": 0, "y": 0, "w": 100, "h": 50},
                "row_split_y": 25,
            },
            "labels": [
                {"display_name": "SHI", "frame_idx": 0},
                {"display_name": "AXELSEN", "frame_idx": 0},
            ],
            "frame_width": 1920,
            "frame_height": 1080,
        }
        cfg = h.annotation_to_valid_frames_config(ann)
        self.assertIsNotNone(cfg)
        self.assertEqual(cfg["court_corners"], [[1, 2], [3, 4], [5, 6], [7, 8]])
        self.assertEqual(cfg["player_names"], ["SHI", "AXELSEN"])
        self.assertEqual(cfg["scoreboard_crop"]["w"], 100)
        self.assertEqual(cfg["score_sub_crop"]["h"], 50)
        self.assertEqual(cfg["row_split_y"], 25.0)

    def test_falls_back_to_roster_names(self):
        ann = {
            "court": {"corners": [[0, 0], [1, 0], [1, 1], [0, 1]]},
            "labels": [],
        }
        cfg = h.annotation_to_valid_frames_config(
            ann, roster={"team1_player1": "A", "team2_player1": "B"},
        )
        self.assertEqual(cfg["player_names"], ["A", "B"])
        # Pure pass-through: no invented scoreboard geometry (dims known or not).
        self.assertNotIn("scoreboard_crop", cfg)
        self.assertNotIn("score_sub_crop", cfg)
        self.assertNotIn("row_split_y", cfg)

    def test_returns_none_without_corners(self):
        self.assertIsNone(h.annotation_to_valid_frames_config({"court": {}}))

    def test_returns_none_without_player_names(self):
        ann = {
            "court": {"corners": [[0, 0], [1, 0], [1, 1], [0, 1]]},
            "labels": [],
        }
        self.assertIsNone(h.annotation_to_valid_frames_config(ann, roster={}))


class TestOcrIncomplete(unittest.TestCase):
    def test_read_scoreboard_incomplete_on_bad_path(self):
        # No file → imread None → _INCOMPLETE
        out = vf._read_scoreboard_frame(
            ocr=None, path="/nonexistent/band.jpg",
            sub_crop={"x": 0, "y": 0, "w": 10, "h": 10},
            row_split_y=5, name_re=__import__("re").compile("X"),
            conf_min=0.6,
        )
        self.assertIs(out, vf._INCOMPLETE)


class TestCropClamp(unittest.TestCase):
    def test_clamp_and_reject_nan(self):
        filled = h.apply_valid_frames_defaults(
            {
                "court_corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "player_names": ["A"],
                "scoreboard_crop": {"x": -10, "y": 0, "w": 5000, "h": 100},
            },
            1920, 1080,
        )
        self.assertEqual(filled["scoreboard_crop"]["x"], 0)
        self.assertLessEqual(filled["scoreboard_crop"]["w"], 1920)

        with self.assertRaises(RuntimeError):
            h.apply_valid_frames_defaults(
                {
                    "court_corners": [[float("nan"), 0], [1, 0], [1, 1], [0, 1]],
                    "player_names": ["A"],
                },
                100, 100,
            )

    def test_validate_rejects_nan_crop(self):
        cfg = {
            "court_corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "player_names": ["A"],
            "scoreboard_crop": {"x": 0, "y": 0, "w": float("nan"), "h": 10},
        }
        err = h.validate_valid_frames_request(cfg, True, True)
        self.assertIsNotNone(err)
        self.assertIn("scoreboard_crop", err)


if __name__ == "__main__":
    unittest.main()
