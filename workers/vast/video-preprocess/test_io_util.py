"""Pure tests for URL helpers."""

from __future__ import annotations

import unittest

from io_util import is_youtube_url, resolve_path_mode, sanitize_error


class TestYoutube(unittest.TestCase):
    def test_hosts(self):
        self.assertTrue(is_youtube_url("https://www.youtube.com/watch?v=abc"))
        self.assertTrue(is_youtube_url("https://youtu.be/abc"))
        self.assertFalse(is_youtube_url("https://example.com/v.mp4"))


class TestPathMode(unittest.TestCase):
    def test_youtube_is_bwf(self):
        self.assertEqual(
            resolve_path_mode("https://www.youtube.com/watch?v=abc"), "bwf",
        )
        self.assertEqual(resolve_path_mode("https://youtu.be/abc"), "bwf")

    def test_local_is_user(self):
        self.assertEqual(resolve_path_mode("file:///data/match.mp4"), "user")

    def test_b2_or_remote_is_user(self):
        self.assertEqual(
            resolve_path_mode(
                "https://s3.us-west-004.backblazeb2.com/bucket/users/u/m/original.mp4",
            ),
            "user",
        )
        self.assertEqual(
            resolve_path_mode("https://cdn.example.com/bwf/m/original.mkv?X-Amz-Signature=x"),
            "user",
        )


class TestSanitize(unittest.TestCase):
    def test_redacts_url(self):
        s = sanitize_error("failed https://bucket.example/path?sig=secret more")
        self.assertNotIn("sig=secret", s)
        self.assertIn("bucket.example", s)


if __name__ == "__main__":
    unittest.main()
