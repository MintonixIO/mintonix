"""Pure tests for URL helpers."""

from __future__ import annotations

import unittest

from io_util import is_youtube_url, sanitize_error


class TestYoutube(unittest.TestCase):
    def test_hosts(self):
        self.assertTrue(is_youtube_url("https://www.youtube.com/watch?v=abc"))
        self.assertTrue(is_youtube_url("https://youtu.be/abc"))
        self.assertFalse(is_youtube_url("https://example.com/v.mp4"))


class TestSanitize(unittest.TestCase):
    def test_redacts_url(self):
        s = sanitize_error("failed https://bucket.example/path?sig=secret more")
        self.assertNotIn("sig=secret", s)
        self.assertIn("bucket.example", s)


if __name__ == "__main__":
    unittest.main()
