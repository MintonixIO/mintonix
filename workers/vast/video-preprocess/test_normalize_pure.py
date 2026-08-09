"""Pure tests for encode helpers (no ffmpeg)."""

from __future__ import annotations

import unittest

from normalize import select_expr, span_window


class TestSelectExpr(unittest.TestCase):
    def test_single(self):
        self.assertEqual(select_expr([(10, 20)]), r"between(n\,10\,20)")

    def test_multi(self):
        expr = select_expr([(0, 1), (5, 6)])
        self.assertIn(r"between(n\,0\,1)", expr)
        self.assertIn(r"between(n\,5\,6)", expr)
        self.assertIn("+", expr)


class TestSpanWindow(unittest.TestCase):
    def test_rebase(self):
        start, end, rel = span_window([(100, 110), (200, 210)])
        self.assertEqual(start, 100)
        self.assertEqual(end, 210)
        self.assertEqual(rel, [(0, 10), (100, 110)])


if __name__ == "__main__":
    unittest.main()
