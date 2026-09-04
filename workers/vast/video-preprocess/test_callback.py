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
            self.assertFalse(
                callback.callback_allowed("https://proj.supabase.co/functions/v1/other")
            )


class TestPostCallback(unittest.TestCase):
    def _req(self, post):
        req = mock.Mock()
        req.post = post
        req.RequestException = type("RequestException", (Exception,), {})
        return mock.patch("callback._requests", return_value=req)

    def test_raises_after_retries(self):
        class Down(Exception):
            pass

        post = mock.Mock(side_effect=Down("down"))
        req = mock.Mock()
        req.post = post
        req.RequestException = Down
        with mock.patch("callback.time.sleep"), mock.patch(
            "callback._requests", return_value=req,
        ):
            with self.assertRaises(RuntimeError):
                callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 3)

    def test_raises_on_terminal_4xx(self):
        resp = mock.Mock()
        resp.status_code = 401
        resp.text = "unauthorized"
        post = mock.Mock(return_value=resp)
        with self._req(post):
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
        post = mock.Mock(side_effect=[bad, good])
        with mock.patch("callback.time.sleep"), self._req(post):
            callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 2)

    def test_retries_408_then_raises(self):
        resp = mock.Mock()
        resp.status_code = 408
        resp.text = "timeout"
        post = mock.Mock(return_value=resp)
        with mock.patch("callback.time.sleep"), self._req(post):
            with self.assertRaises(RuntimeError):
                callback.post_callback("https://cb.example/x", "tok", {"status": "ok"})
            self.assertEqual(post.call_count, 3)

    def test_2xx_ok(self):
        resp = mock.Mock()
        resp.status_code = 204
        resp.text = ""
        post = mock.Mock(return_value=resp)
        with self._req(post):
            callback.post_callback("https://cb.example/x", None, {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
