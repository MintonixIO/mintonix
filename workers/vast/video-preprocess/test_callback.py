"""Tests for callback URL allowlist policy and failure raising."""

from __future__ import annotations

import os
import unittest
from unittest import mock

import callback


class TestCallbackAllowlist(unittest.TestCase):
    def _env(self, **kwargs):
        base = {"CALLBACK_URL_PREFIX": ""}
        base.update(kwargs)
        return mock.patch.dict(os.environ, base, clear=False)

    def test_fail_closed_without_prefix(self):
        good = "https://proj.supabase.co/functions/v1/jobs/callback"
        with self._env():
            self.assertFalse(callback.callback_allowed(good))
            self.assertTrue(callback.callback_allowed(""))
            self.assertTrue(callback.callback_allowed(None))

    def test_allow_with_prefix(self):
        with self._env(CALLBACK_URL_PREFIX="https://proj.supabase.co"):
            self.assertTrue(
                callback.callback_allowed(
                    "https://proj.supabase.co/functions/v1/jobs/callback"
                )
            )
            self.assertFalse(callback.callback_allowed("https://evil.example/cb"))


class TestPostCallback(unittest.TestCase):
    def test_raises_after_retries(self):
        with mock.patch("callback.time.sleep"), mock.patch(
            "callback.requests.post",
        ) as post:
            post.side_effect = callback.requests.RequestException("down")
            with self.assertRaises(RuntimeError):
                callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 3)

    def test_raises_on_terminal_4xx(self):
        resp = mock.Mock()
        resp.status_code = 401
        resp.text = "unauthorized"
        with mock.patch("callback.requests.post", return_value=resp) as post:
            with self.assertRaises(RuntimeError):
                callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 1)

    def test_retries_429_then_succeeds(self):
        bad = mock.Mock()
        bad.status_code = 429
        bad.text = "rate limited"
        good = mock.Mock()
        good.status_code = 200
        good.text = "ok"
        with mock.patch("callback.time.sleep"), mock.patch(
            "callback.requests.post",
            side_effect=[bad, good],
        ) as post:
            callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 2)

    def test_retries_408_then_raises(self):
        resp = mock.Mock()
        resp.status_code = 408
        resp.text = "timeout"
        with mock.patch("callback.time.sleep"), mock.patch(
            "callback.requests.post", return_value=resp,
        ) as post:
            with self.assertRaises(RuntimeError):
                callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 3)

    def test_2xx_ok(self):
        resp = mock.Mock()
        resp.status_code = 204
        resp.text = ""
        with mock.patch("callback.requests.post", return_value=resp):
            callback.post_callback("https://cb.example/x", None, {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
