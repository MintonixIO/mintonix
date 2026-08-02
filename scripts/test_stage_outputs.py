#!/usr/bin/env python3
"""Unit tests for stage artifact helpers (no network / DB).

    python3 scripts/test_stage_outputs.py
"""

from __future__ import annotations

import os
import sys
import unittest

# Allow `python3 scripts/test_stage_outputs.py` from repo root or scripts/.
_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import ops_stage as s  # noqa: E402


# Golden fixture — keep in sync with supabase/README.md + ops/stage_outputs.ts.
GOLDEN_STAGE_OUTPUTS = {
    "normalize": (
        "normalized.mp4",
        "thumbnail.jpg",
        "frame_ranges.csv",
        "valid.mp4",
        "frame_manifest.csv",
        "scores.csv",
    ),
    "detect": ("detections.json",),
    "analyze": ("analysis.json",),
}

GOLDEN_KEEP = frozenset({
    "original.mp4",
    "original.mov",
    "original.mkv",
    "annotation.json",
})


class StageOutputsTests(unittest.TestCase):
    def test_stage_outputs_matches_golden(self) -> None:
        self.assertEqual(dict(s.STAGE_OUTPUTS), GOLDEN_STAGE_OUTPUTS)

    def test_keep_on_regress_matches_golden(self) -> None:
        self.assertEqual(s.KEEP_ON_REGRESS, GOLDEN_KEEP)

    def test_outputs_to_purge_normalize_includes_later(self) -> None:
        self.assertEqual(
            s.outputs_to_purge("normalize"),
            [
                "normalized.mp4",
                "thumbnail.jpg",
                "frame_ranges.csv",
                "valid.mp4",
                "frame_manifest.csv",
                "scores.csv",
                "detections.json",
                "analysis.json",
            ],
        )

    def test_outputs_to_purge_detect(self) -> None:
        self.assertEqual(
            s.outputs_to_purge("detect"),
            ["detections.json", "analysis.json"],
        )

    def test_outputs_to_purge_analyze(self) -> None:
        self.assertEqual(s.outputs_to_purge("analyze"), ["analysis.json"])

    def test_outputs_to_purge_unknown(self) -> None:
        with self.assertRaises(ValueError):
            s.outputs_to_purge("nope")

    def test_keep_disjoint_from_all_purge_sets(self) -> None:
        for stage in s.STAGE_ORDER:
            purge = set(s.outputs_to_purge(stage))
            overlap = s.KEEP_ON_REGRESS & purge
            self.assertFalse(
                overlap,
                f"keep ∩ purge({stage}) must be empty, got {overlap}",
            )

    def test_stage_completeness(self) -> None:
        self.assertEqual(
            s.stage_completeness({"normalized.mp4", "detections.json"}),
            {"normalize": "✓", "detect": "✓", "analyze": "✗"},
        )
        self.assertEqual(
            s.stage_completeness([]),
            {"normalize": "✗", "detect": "✗", "analyze": "✗"},
        )

    def test_basenames_from_keys_prefix_bound(self) -> None:
        prefix = "bwf/abc/"
        keys = [
            "bwf/abc/normalized.mp4",
            "bwf/abc/nested/evil.json",  # nested → skipped
            "other/detections.json",     # off-prefix → skipped
            "bwf/abc/detections.json",
        ]
        self.assertEqual(
            s.basenames_from_keys(keys, prefix),
            {"normalized.mp4", "detections.json"},
        )

    def test_preview_purge_targets(self) -> None:
        prefix = "bwf/m1/"
        keys = [
            f"{prefix}normalized.mp4",
            f"{prefix}detections.json",
            f"{prefix}annotation.json",
            f"{prefix}original.mp4",
            "bwf/other/detections.json",
        ]
        targets = s.preview_purge_targets(keys, prefix, "detect")
        self.assertEqual(
            targets,
            [f"{prefix}detections.json"],
        )


class TsSyncTests(unittest.TestCase):
    """Best-effort: parse ops stage_outputs.ts STAGE_OUTPUTS if the file is present."""

    def test_ts_stage_outputs_names_present(self) -> None:
        root = os.path.dirname(_SCRIPTS)
        ts_path = os.path.join(
            root, "supabase", "functions", "ops", "stage_outputs.ts",
        )
        if not os.path.isfile(ts_path):
            self.skipTest("stage_outputs.ts not found")
        with open(ts_path, encoding="utf-8") as f:
            text = f.read()
        # Ensure every golden basename appears as a string literal in the TS map.
        for stage, names in GOLDEN_STAGE_OUTPUTS.items():
            self.assertIn(stage, text)
            for name in names:
                self.assertIn(f'"{name}"', text, f"missing {name} in stage_outputs.ts")


if __name__ == "__main__":
    unittest.main()
