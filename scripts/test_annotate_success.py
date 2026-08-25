#!/usr/bin/env python3
"""Unit tests for dual-truth detect content checks and scoreboard crop fields.

    python3 scripts/test_annotate_success.py
"""

from __future__ import annotations

import inspect
import os
import sys
import types
import unittest

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

# annotate_and_ingest imports cv2/numpy at module load; these checks do not need them.
for _mod in ("cv2", "numpy"):
    if _mod not in sys.modules:
        try:
            __import__(_mod)
        except ImportError:
            sys.modules[_mod] = types.ModuleType(_mod)

import annotate_and_ingest as a  # noqa: E402


def _shifts(n: int) -> list[dict]:
    return [{"new_start": i * 10, "new_end": i * 10 + 9} for i in range(n)]


def _segments(n: int, *, score_conf: float = 0.0) -> list[dict]:
    return [
        {
            "start_frame": i * 10,
            "end_frame": i * 10 + 9,
            "score": {"t1": 0, "t2": 0},
            "score_conf": score_conf,
        }
        for i in range(n)
    ]


def _detections(
    *,
    n_segments: int = 1,
    n_frames: int = 30,
    score_conf: float = 0.0,
    fps: float | None = 30.0,
    width: int | None = 1920,
    height: int | None = 1080,
) -> dict:
    body: dict = {
        "segments": _segments(n_segments, score_conf=score_conf),
        "frames": [{"frame": i} for i in range(n_frames)],
        "rallies": [],
    }
    if fps is not None:
        body["fps"] = fps
    if width is not None:
        body["width"] = width
    if height is not None:
        body["height"] = height
    return body


def _match(*, duration_sec: float = 1.0, fps: float = 30.0) -> dict:
    return {
        "id": "fd73153b",
        "status": "ready",
        "duration_sec": duration_sec,
        "width": 1920,
        "height": 1080,
        "fps": fps,
    }


def _ready_snapshot(
    *,
    detections: dict | None = None,
    preprocess_log: dict | None = None,
) -> a.Snapshot:
    return a.Snapshot(
        match=_match(),
        job={
            "id": "20e360a5",
            "status": "complete",
            "stage": "detect",
            "attempt": 1,
            "queue": "jobs_interactive",
        },
        basenames={
            "annotation.json",
            "normalized.mp4",
            "thumbnail.jpg",
            "preprocess-log.json",
            "detections.json",
        },
        prefix="bwf/fd73153b/",
        completeness={"normalize": "✓", "detect": "✓", "analyze": "✗"},
        t_elapsed=12.0,
        detections=detections,
        preprocess_log=preprocess_log,
    )


def _by_name(checks: list[a.CheckResult]) -> dict[str, a.CheckResult]:
    return {c.name: c for c in checks}


class TestDetectionsContentChecks(unittest.TestCase):
    def test_75_shifts_1_segment_hard_fails(self) -> None:
        """The fd73153b dual-truth miss: object exists, 75 islands, 1 segment."""
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=30, score_conf=0.0),
            {"frame_shifts": _shifts(75)},
            _match(),
        )
        self.assertFalse(a.is_hard_success(checks))
        seg = _by_name(checks)["detections.segments_vs_islands"]
        self.assertFalse(seg.ok)
        self.assertIn("1", seg.detail)
        self.assertIn("75", seg.detail)

    def test_n_shifts_equal_n_segments_passes(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=75, n_frames=30, score_conf=0.4),
            {"frame_shifts": _shifts(75)},
            _match(),
        )
        self.assertTrue(_by_name(checks)["detections.segments_vs_islands"].ok)
        self.assertTrue(a.is_hard_success(checks))

    def test_empty_shifts_fallback_island_does_not_hard_fail(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=30, score_conf=0.4),
            {"frame_shifts": []},
            _match(),
        )
        self.assertTrue(_by_name(checks)["detections.segments_vs_islands"].ok)
        self.assertTrue(a.is_hard_success(checks))

    def test_missing_frame_shifts_key_is_empty_not_hard_fail(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=30, score_conf=0.4),
            {},
            _match(),
        )
        self.assertTrue(_by_name(checks)["detections.segments_vs_islands"].ok)
        self.assertTrue(a.is_hard_success(checks))

    def test_frames_outside_2pct_hard_fails(self) -> None:
        # expected = 10s * 10fps = 100; 103 is 3% off.
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=103, score_conf=0.4, fps=10.0),
            {"frame_shifts": []},
            _match(duration_sec=10.0, fps=10.0),
        )
        frames = _by_name(checks)["detections.frames_vs_duration"]
        self.assertFalse(frames.ok)
        self.assertFalse(a.is_hard_success(checks))

    def test_frames_vs_duration_uses_match_probe_not_detections_fps(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=30, score_conf=0.4, fps=60.0),
            {"frame_shifts": []},
            _match(duration_sec=1.0, fps=30.0),
        )
        self.assertTrue(_by_name(checks)["detections.frames_vs_duration"].ok)

    def test_frames_exactly_2pct_passes(self) -> None:
        # expected = 100; 102 is exactly 2%.
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=102, score_conf=0.4, fps=10.0),
            {"frame_shifts": []},
            _match(duration_sec=10.0, fps=10.0),
        )
        self.assertTrue(_by_name(checks)["detections.frames_vs_duration"].ok)
        self.assertTrue(a.is_hard_success(checks))

    def test_missing_fps_width_height_hard_fails(self) -> None:
        body = _detections(n_segments=1, n_frames=30, score_conf=0.4)
        del body["fps"]
        del body["width"]
        del body["height"]
        checks = a.detections_content_checks(body, {"frame_shifts": []}, _match())
        meta = _by_name(checks)["detections.fps_width_height"]
        self.assertFalse(meta.ok)
        self.assertFalse(a.is_hard_success(checks))

    def test_all_zero_score_conf_is_soft_warning(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=3, n_frames=30, score_conf=0.0),
            {"frame_shifts": _shifts(3)},
            _match(),
        )
        conf = _by_name(checks)["detections.score_conf"]
        self.assertTrue(conf.ok)
        self.assertIn("score_conf==0", conf.detail)
        self.assertTrue(a.is_hard_success(checks))

    def test_missing_preprocess_log_hard_fails_island_check(self) -> None:
        checks = a.detections_content_checks(
            _detections(n_segments=1, n_frames=30, score_conf=0.4),
            None,
            _match(),
        )
        self.assertFalse(_by_name(checks)["detections.segments_vs_islands"].ok)
        self.assertFalse(a.is_hard_success(checks))


class TestEvaluateSuccessDetectContent(unittest.TestCase):
    def test_stub_snapshot_75_shifts_1_segment_ok_false(self) -> None:
        snap = _ready_snapshot(
            detections=_detections(n_segments=1, n_frames=30, score_conf=0.0),
            preprocess_log={"frame_shifts": _shifts(75)},
        )
        checks = a.evaluate_success(snap, until="detect", lane="bwf")
        self.assertFalse(a.is_hard_success(checks))
        self.assertFalse(_by_name(checks)["detections.segments_vs_islands"].ok)
        # Existence / job / match checks still pass — content is why we fail.
        self.assertTrue(_by_name(checks)["b2.detections.json"].ok)
        self.assertTrue(_by_name(checks)["match.status_ready"].ok)
        self.assertTrue(_by_name(checks)["job.terminal_complete"].ok)

    def test_empty_shifts_user_lane_ok_true_with_score_conf_warning(self) -> None:
        snap = _ready_snapshot(
            detections=_detections(n_segments=1, n_frames=30, score_conf=0.0),
            preprocess_log={"frame_shifts": []},
        )
        checks = a.evaluate_success(snap, until="detect", lane="user")
        self.assertTrue(a.is_hard_success(checks))
        self.assertTrue(_by_name(checks)["detections.segments_vs_islands"].ok)
        self.assertTrue(_by_name(checks)["detections.score_conf"].ok)
        self.assertIn("score_conf==0", _by_name(checks)["detections.score_conf"].detail)

    def test_normalize_until_skips_content_checks(self) -> None:
        snap = _ready_snapshot(
            detections=_detections(n_segments=1, n_frames=30),
            preprocess_log={"frame_shifts": _shifts(75)},
        )
        checks = a.evaluate_success(snap, until="normalize", lane="bwf")
        names = {c.name for c in checks}
        self.assertNotIn("detections.segments_vs_islands", names)
        self.assertTrue(a.is_hard_success(checks))

    def test_processing_job_skips_content_without_injection(self) -> None:
        snap = _ready_snapshot(
            detections=None,
            preprocess_log={"frame_shifts": _shifts(75)},
        )
        assert snap.job is not None
        snap.job["status"] = "processing"
        checks = a.evaluate_success(snap, until="detect", lane="bwf")
        names = {c.name for c in checks}
        self.assertNotIn("detections.segments_vs_islands", names)
        self.assertFalse(_by_name(checks)["job.terminal_complete"].ok)

    def test_content_mismatch_is_terminal_for_monitor(self) -> None:
        snap = _ready_snapshot(
            detections=_detections(n_segments=1, n_frames=30, score_conf=0.0),
            preprocess_log={"frame_shifts": _shifts(75)},
        )
        checks = a.evaluate_success(snap, until="detect", lane="bwf")
        fail = a.detect_content_hard_fail(checks)
        self.assertIsNotNone(fail)
        assert fail is not None
        self.assertEqual(fail.name, "detections.segments_vs_islands")


class TestScoreboardFields(unittest.TestCase):
    def test_no_dummy_half_frame(self) -> None:
        self.assertIsNone(a.scoreboard_fields(True, None)["scoreboard_crop"])
        q = {"x": 1400, "y": 40, "w": 220, "h": 120}
        self.assertEqual(a.scoreboard_fields(True, q)["scoreboard_crop"], q)

    def test_user_lane_omits_crop_even_if_quad_given(self) -> None:
        q = {"x": 1400, "y": 40, "w": 220, "h": 120}
        self.assertIsNone(a.scoreboard_fields(False, q)["scoreboard_crop"])

    def test_unclicked_bwf_omits_all_scoreboard_keys_from_annotation(self) -> None:
        config = {
            "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "net_poles": [[0, 0], [1, 0]],
            **a.scoreboard_fields(True, None),
            "frame_width": 1920,
            "frame_height": 1080,
        }
        obj = a.build_annotation_json(config, [], "test")
        self.assertNotIn("scoreboard_crop", obj["court"])
        self.assertNotIn("score_sub_crop", obj["court"])
        self.assertNotIn("row_split_y", obj["court"])

    def test_clicked_quad_fills_sub_crop_and_row_split(self) -> None:
        q = {"x": 1400, "y": 40, "w": 220, "h": 120}
        fields = a.scoreboard_fields(True, q)
        self.assertEqual(fields["score_sub_crop"], q)
        self.assertEqual(fields["row_split_y"], 100)

    def test_crop_from_tl_br_normalizes_opposite_corners(self) -> None:
        self.assertEqual(
            a.crop_from_tl_br([[1620, 160], [1400, 40]]),
            {"x": 1400, "y": 40, "w": 220, "h": 120},
        )
        self.assertIsNone(a.crop_from_tl_br([[10, 10], [10, 10]]))

    def test_annotate_source_has_no_half_frame_dummy(self) -> None:
        src = inspect.getsource(a.annotate)
        self.assertNotIn("width // 2", src)
        self.assertNotIn("height // 2", src)


if __name__ == "__main__":
    unittest.main()
