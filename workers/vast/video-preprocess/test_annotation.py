"""Pure tests for annotation → court config."""

from __future__ import annotations

import unittest

from bwf.annotation import config_from_annotation


class TestConfigFromAnnotation(unittest.TestCase):
    def test_ok_corners(self):
        ann = {"court": {"corners": [[0, 0], [1, 0], [1, 1], [0, 1]]}}
        cfg = config_from_annotation(ann)
        self.assertIsNotNone(cfg)
        self.assertEqual(len(cfg["court_corners"]), 4)

    def test_missing_corners(self):
        self.assertIsNone(config_from_annotation({}))
        self.assertIsNone(config_from_annotation({"court": {}}))
        self.assertIsNone(config_from_annotation({"court": {"corners": [[0, 0]]}}))

    def test_not_dict(self):
        self.assertIsNone(config_from_annotation(None))  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
