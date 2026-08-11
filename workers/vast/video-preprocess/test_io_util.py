"""Pure tests for URL helpers."""

from __future__ import annotations

import unittest

from io_util import is_youtube_url, resolve_path_mode, sanitize_error, validate_multipart


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

    def test_remote_is_user(self):
        self.assertEqual(
            resolve_path_mode(
                "https://s3.us-west-004.backblazeb2.com/bucket/users/u/m/original.mp4",
            ),
            "user",
        )
        self.assertEqual(
            resolve_path_mode(
                "https://cdn.example.com/bwf/m/original.mkv?X-Amz-Signature=x",
            ),
            "user",
        )


class TestSanitize(unittest.TestCase):
    def test_redacts_url(self):
        s = sanitize_error("failed https://bucket.example/path?sig=secret more")
        self.assertNotIn("sig=secret", s)
        self.assertIn("bucket.example", s)


class TestMultipart(unittest.TestCase):
    def test_requires_fields(self):
        with self.assertRaises(RuntimeError):
            validate_multipart(None)
        with self.assertRaises(RuntimeError):
            validate_multipart({"part_urls": ["https://x"]})
        ok = {
            "part_urls": ["https://x/1"],
            "complete_url": "https://x/c",
            "abort_url": "https://x/a",
            "part_size": 64,
        }
        self.assertIs(validate_multipart(ok), ok)

    def test_rejects_file_urls(self):
        with self.assertRaises(RuntimeError):
            validate_multipart({
                "part_urls": ["file:///tmp/x"],
                "complete_url": "https://x/c",
                "abort_url": "https://x/a",
            })


if __name__ == "__main__":
    unittest.main()
