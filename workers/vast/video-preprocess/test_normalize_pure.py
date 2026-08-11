"""Pure tests for encode helpers (no ffmpeg)."""

from __future__ import annotations

import unittest

from normalize import delivery_fps


class TestDeliveryFps(unittest.TestCase):
    def test_caps_at_max(self):
        self.assertEqual(delivery_fps(60.0), 30.0)

    def test_keeps_lower(self):
        self.assertEqual(delivery_fps(24.0), 24.0)

    def test_invalid_defaults(self):
        self.assertEqual(delivery_fps(0.0), 30.0)


if __name__ == "__main__":
    unittest.main()
