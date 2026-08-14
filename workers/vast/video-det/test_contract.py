"""Thin discovery note for video-det contract tests.

Focused suites (same package dir, auto-discovered by pytest/unittest):
  - test_io_util.py           I/O, safe_error_message, upload/download
  - test_detect_pipeline.py   pose/shuttle/ReID/chunk/VideoDetector
  - test_server_contract.py   FastAPI health/startup/product imports
  - test_segments.py          Engine segments / scoreboard / detections envelope

Run from this directory:
  python -m pytest test_*.py -q
  python -m unittest discover -p 'test_*.py' -v
"""

from __future__ import annotations

import unittest


class TestSuiteLayout(unittest.TestCase):
    """Smoke: split modules exist and import."""

    def test_split_modules_importable(self) -> None:
        import test_detect_pipeline  # noqa: F401
        import test_io_util  # noqa: F401
        import test_segments  # noqa: F401
        import test_server_contract  # noqa: F401


if __name__ == "__main__":
    unittest.main()
