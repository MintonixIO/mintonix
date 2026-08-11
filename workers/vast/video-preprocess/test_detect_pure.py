"""Pure tests for BWF detect helpers (numpy only, no ffmpeg/GPU)."""

from __future__ import annotations

import unittest

import numpy as np

from bwf.detect import (
    expand_samples_to_source_frames,
    hysteresis,
    runs_of_true,
    build_range_manifest,
)


class TestHysteresis(unittest.TestCase):
    def test_on_off(self):
        # enter above on=0.8, leave below off=0.7
        ncc = np.array([0.5, 0.85, 0.75, 0.65, 0.9], dtype=np.float32)
        out = hysteresis(ncc, 0.8, 0.7)
        self.assertEqual(out.tolist(), [False, True, True, False, True])


class TestRuns(unittest.TestCase):
    def test_min_len(self):
        mask = np.array([0, 1, 1, 0, 1, 1, 1, 0], dtype=bool)
        self.assertEqual(runs_of_true(mask, 2), [(1, 2), (4, 6)])
        self.assertEqual(runs_of_true(mask, 3), [(4, 6)])


class TestExpandSamples(unittest.TestCase):
    def test_full_rate(self):
        s = [True, False, True]
        out = expand_samples_to_source_frames(
            s, n_src=3, src_fps=30, sample_fps=30,
        )
        self.assertEqual(out.tolist(), [True, False, True])

    def test_subsample(self):
        # 2 samples at 5 Hz over 30 fps → ~6 source frames each
        s = [True, False]
        out = expand_samples_to_source_frames(
            s, n_src=12, src_fps=30, sample_fps=5,
        )
        self.assertTrue(out[:6].all())
        self.assertFalse(out[6:].any())


class TestManifest(unittest.TestCase):
    def test_map(self):
        m = build_range_manifest([(0, 9), (20, 29)])
        self.assertEqual(m[0]["new_start"], 0)
        self.assertEqual(m[0]["new_end"], 9)
        self.assertEqual(m[1]["new_start"], 10)
        self.assertEqual(m[1]["new_end"], 19)


if __name__ == "__main__":
    unittest.main()
