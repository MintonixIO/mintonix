"""Shared test setup for video-normalization unit tests."""

import os
from pathlib import Path

# Local tests use file:// I/O; production images leave this unset/0.
os.environ.setdefault("ALLOW_FILE_URLS", "1")

VIDEO = str(Path(__file__).parent / "sample.mov")
