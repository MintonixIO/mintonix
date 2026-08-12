"""Pure tests for annotation → court config."""

from __future__ import annotations

import unittest

from bwf.annotation import config_from_annotation


def _ok_ann(**court_extra):
    court = {
        "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
        "net_poles": [[0.4, 0.4], [0.6, 0.4]],
        **court_extra,
    }
    return {"court": court}


class TestConfigFromAnnotation(unittest.TestCase):
    def test_ok_corners_and_net_poles(self):
        cfg = config_from_annotation(_ok_ann())
        self.assertIsNotNone(cfg)
        assert cfg is not None
        self.assertEqual(len(cfg["court_corners"]), 4)
        self.assertEqual(len(cfg["net_poles"]), 2)
        self.assertEqual(cfg["net_poles"][0], [0.4, 0.4])

    def test_missing_corners(self):
        self.assertIsNone(config_from_annotation({}))
        self.assertIsNone(config_from_annotation({"court": {}}))
        self.assertIsNone(config_from_annotation({
            "court": {
                "corners": [[0, 0]],
                "net_poles": [[0.4, 0.4], [0.6, 0.4]],
            },
        }))

    def test_missing_net_poles(self):
        self.assertIsNone(config_from_annotation({
            "court": {"corners": [[0, 0], [1, 0], [1, 1], [0, 1]]},
        }))
        self.assertIsNone(config_from_annotation({
            "court": {
                "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
                "net_poles": [[0.5, 0.5]],
            },
        }))

    def test_not_dict(self):
        self.assertIsNone(config_from_annotation(None))  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
