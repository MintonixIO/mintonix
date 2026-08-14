"""Pure tests for Engine detections.json segments + scoreboard geometry."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
import numpy as np

from detect.output import ensure_segments, write_detections_json
from detect.scoreboard import (
    ocr_score_from_frame,
    parse_crop,
    parse_preprocess_log,
    scoreboard_geometry,
)
from detect.segments import (
    build_segments,
    clamp_segments_to_frame_count,
    fallback_island,
    islands_from_frame_shifts,
    rallies_from_segments,
    representative_frame,
)
from detect.types import FrameResult, ShuttleCandidate


class TestIslands(unittest.TestCase):
    def test_from_frame_shifts(self) -> None:
        shifts = [
            {"old_start": 100, "old_end": 280, "new_start": 0, "new_end": 180},
            {"old_start": 400, "old_end": 459, "new_start": 181, "new_end": 240},
            {"old_start": 500, "old_end": 659, "new_start": 241, "new_end": 400},
        ]
        self.assertEqual(
            islands_from_frame_shifts(shifts),
            [(0, 180), (181, 240), (241, 400)],
        )

    def test_skips_bad_entries(self) -> None:
        self.assertEqual(
            islands_from_frame_shifts(
                [
                    {"new_start": 5, "new_end": 2},
                    {"new_start": "x", "new_end": 1},
                    None,
                    {"new_start": 0, "new_end": 9},
                ]
            ),
            [(0, 9)],
        )

    def test_empty(self) -> None:
        self.assertEqual(islands_from_frame_shifts(None), [])
        self.assertEqual(islands_from_frame_shifts([]), [])

    def test_fallback(self) -> None:
        self.assertEqual(fallback_island(0), [])
        self.assertEqual(fallback_island(1), [(0, 0)])
        self.assertEqual(fallback_island(241), [(0, 240)])

    def test_representative(self) -> None:
        self.assertEqual(representative_frame(0, 180), 90)
        self.assertEqual(representative_frame(10, 10), 10)


class TestBuildSegments(unittest.TestCase):
    def test_zip_scores(self) -> None:
        segs = build_segments(
            [(0, 180), (181, 240)],
            [
                {"t1": 5, "t2": 3, "score_conf": 0.92},
                {"t1": 5, "t2": 3, "conf": 0.88},
            ],
        )
        self.assertEqual(segs[0]["score"], {"t1": 5, "t2": 3})
        self.assertEqual(segs[0]["score_conf"], 0.92)
        self.assertEqual(segs[1]["score_conf"], 0.88)

    def test_length_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            build_segments([(0, 1)], [])

    def test_clamp(self) -> None:
        segs = [
            {"start_frame": 0, "end_frame": 999, "score": {"t1": 1, "t2": 0}},
            {"start_frame": 5000, "end_frame": 5001, "score": {"t1": 2, "t2": 0}},
        ]
        out = clamp_segments_to_frame_count(segs, 100)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["end_frame"], 99)

    def test_ensure_fallback(self) -> None:
        out = ensure_segments([], 50)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["start_frame"], 0)
        self.assertEqual(out[0]["end_frame"], 49)
        self.assertEqual(out[0]["score"], {"t1": 0, "t2": 0})


class TestScoreboardGeometry(unittest.TestCase):
    def test_parse_crop(self) -> None:
        self.assertEqual(parse_crop({"x": 1, "y": 2, "w": 3, "h": 4}), (1, 2, 3, 4))
        self.assertIsNone(parse_crop({"x": 0, "y": 0, "w": 0, "h": 10}))
        self.assertIsNone(parse_crop(None))

    def test_prefers_score_sub_crop(self) -> None:
        ann = {
            "court": {
                "scoreboard_crop": {"x": 0, "y": 0, "w": 400, "h": 200},
                "score_sub_crop": {"x": 10, "y": 20, "w": 80, "h": 40},
                "row_split_y": 40,
            }
        }
        g = scoreboard_geometry(ann)
        assert g is not None
        self.assertEqual((g["x"], g["y"], g["w"], g["h"]), (10, 20, 80, 40))
        self.assertEqual(g["row_split_rel"], 20)

    def test_missing_crop(self) -> None:
        self.assertIsNone(scoreboard_geometry({"court": {"corners": []}}))
        self.assertIsNone(scoreboard_geometry(None))

    def test_ocr_without_geometry_is_low_conf(self) -> None:
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        sc = ocr_score_from_frame(frame, None)
        self.assertEqual(sc["t1"], 0)
        self.assertEqual(sc["t2"], 0)
        self.assertEqual(sc["score_conf"], 0.0)

    def test_ocr_painted_digits_reads_something(self) -> None:
        import cv2

        frame = np.zeros((120, 200, 3), dtype=np.uint8)
        # Dark bar, white digits — two rows.
        cv2.putText(frame, "5", (20, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
        cv2.putText(frame, "3", (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 2)
        geom = {"x": 0, "y": 0, "w": 200, "h": 120, "row_split_rel": 60}
        sc = ocr_score_from_frame(frame, geom)
        self.assertIn("t1", sc)
        self.assertIn("t2", sc)
        self.assertGreaterEqual(sc["t1"], 0)
        self.assertGreaterEqual(sc["t2"], 0)
        # Lightweight template OCR is best-effort; do not require exact 5/3.
        self.assertGreaterEqual(sc["score_conf"], 0.0)
        self.assertLessEqual(sc["score_conf"], 1.0)


class TestPreprocessLog(unittest.TestCase):
    def test_parse(self) -> None:
        raw = {
            "path": "bwf",
            "frame_shifts": [
                {"new_start": 0, "new_end": 10},
                "nope",
            ],
        }
        shifts = parse_preprocess_log(raw)
        self.assertEqual(len(shifts), 1)
        self.assertEqual(shifts[0]["new_end"], 10)

    def test_parse_empty(self) -> None:
        self.assertEqual(parse_preprocess_log({}), [])
        self.assertEqual(parse_preprocess_log(None), [])


class TestRallies(unittest.TestCase):
    def _seg(self, start: int, end: int, t1: int, t2: int, conf: float = 0.9):
        return {
            "start_frame": start,
            "end_frame": end,
            "score": {"t1": t1, "t2": t2},
            "score_conf": conf,
        }

    def test_adjacent_same_score_merges(self) -> None:
        segs = [
            self._seg(0, 10, 5, 3),
            self._seg(11, 20, 5, 3),
        ]
        rallies = rallies_from_segments(segs)
        self.assertEqual(len(rallies), 1)
        self.assertEqual(rallies[0]["start_frame"], 0)
        self.assertEqual(rallies[0]["end_frame"], 20)
        self.assertEqual(rallies[0]["score"], {"t1": 5, "t2": 3})

    def test_one_island_between_same_score_merges(self) -> None:
        segs = [
            self._seg(0, 10, 5, 3, 0.9),
            self._seg(11, 15, 0, 0, 0.1),
            self._seg(16, 30, 5, 3, 0.8),
        ]
        rallies = rallies_from_segments(segs)
        # One intervening island is absorbed into the same physics run.
        self.assertEqual(len(rallies), 1)
        self.assertEqual(rallies[0]["start_frame"], 0)
        self.assertEqual(rallies[0]["end_frame"], 30)
        self.assertEqual(rallies[0]["score"], {"t1": 5, "t2": 3})
        self.assertEqual(rallies[0]["score_conf"], 0.9)

    def test_two_islands_between_same_score_stay_split(self) -> None:
        segs = [
            self._seg(0, 10, 5, 3),
            self._seg(11, 15, 0, 0),
            self._seg(16, 20, 1, 0),
            self._seg(21, 40, 5, 3),
        ]
        rallies = rallies_from_segments(segs)
        fives = [r for r in rallies if r["score"] == {"t1": 5, "t2": 3}]
        self.assertEqual(len(fives), 2)
        self.assertEqual(fives[0]["end_frame"], 10)
        self.assertEqual(fives[1]["start_frame"], 21)

    def test_empty(self) -> None:
        self.assertEqual(rallies_from_segments([]), [])


class TestWriteDetectionsJson(unittest.TestCase):
    def test_engine_envelope(self) -> None:
        frames = [
            FrameResult(
                frame=i,
                poses=[],
                shuttle=[ShuttleCandidate(0.1, 0.2, 0.9)],
            )
            for i in range(3)
        ]
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "detections.json"
            n = write_detections_json(
                dest,
                request_id="job-9",
                video_path=Path(td) / "missing.mp4",
                frame_chunks=[frames],
                segments=[
                    {
                        "start_frame": 0,
                        "end_frame": 180,
                        "score": {"t1": 5, "t2": 3},
                        "score_conf": 0.91,
                    }
                ],
                fps=29.97,
                width=1920,
                height=1080,
            )
            self.assertEqual(n, 3)
            body = json.loads(dest.read_text())
            for key in (
                "job_id",
                "fps",
                "width",
                "height",
                "segments",
                "rallies",
                "frames",
            ):
                self.assertIn(key, body)
            self.assertEqual(body["job_id"], "job-9")
            self.assertEqual(body["width"], 1920)
            self.assertEqual(body["height"], 1080)
            self.assertEqual(len(body["frames"]), 3)
            self.assertEqual(body["frames"][0]["frame"], 0)
            self.assertEqual(body["segments"][0]["end_frame"], 2)  # clamped
            self.assertEqual(len(body["rallies"]), 1)
            self.assertEqual(body["rallies"][0]["end_frame"], 2)
            self.assertFalse(dest.with_suffix(".json.frames.partial").exists())

    def test_empty_segments_fallback(self) -> None:
        frames = [FrameResult(frame=0, poses=[], shuttle=[])]
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "d.json"
            write_detections_json(
                dest,
                request_id=None,
                video_path=Path(td) / "v.mp4",
                frame_chunks=[frames],
                segments=[],
                fps=0.0,
                width=640,
                height=360,
            )
            body = json.loads(dest.read_text())
            self.assertEqual(body["fps"], 30.0)  # default when probe missing
            self.assertEqual(len(body["segments"]), 1)
            self.assertEqual(body["segments"][0]["end_frame"], 0)
            self.assertEqual(len(body["rallies"]), 1)


class TestDebugSidecars(unittest.TestCase):
    def test_discover_and_load(self) -> None:
        import debug as debug_mod

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "annotation.json").write_text('{"court":{}}', encoding="utf-8")
            video = root / "normalized.mp4"
            video.write_bytes(b"x")
            found = debug_mod._discover_sidecar(video, "annotation.json")
            self.assertEqual(found, root / "annotation.json")
            self.assertIsNone(debug_mod._discover_sidecar(video, "preprocess-log.json"))
            data = debug_mod._load_json_file(found)
            self.assertEqual(data, {"court": {}})


if __name__ == "__main__":
    unittest.main()
