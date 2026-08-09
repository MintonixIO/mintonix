"""Tests for callback URL allowlist policy."""

from __future__ import annotations

import os
import unittest
from unittest import mock

import callback


class TestCallbackAllowlist(unittest.TestCase):
    """Prefix-required allowlist (fail-closed without CALLBACK_URL_PREFIX)."""

    def _env(self, **kwargs):
        base = {"CALLBACK_URL_PREFIX": ""}
        base.update(kwargs)
        return mock.patch.dict(os.environ, base, clear=False)

    def test_fail_closed_without_prefix(self):
        good = "https://proj.supabase.co/functions/v1/jobs/callback"
        with self._env():
            self.assertFalse(callback.callback_allowed(good))
            self.assertFalse(
                callback.callback_allowed("https://evil.example/functions/v1/jobs/callback")
            )
            # empty / None always ok (no callback channel)
            self.assertTrue(callback.callback_allowed(""))
            self.assertTrue(callback.callback_allowed(None))

    def test_allow_with_prefix(self):
        with self._env(CALLBACK_URL_PREFIX="https://proj.supabase.co"):
            self.assertTrue(
                callback.callback_allowed(
                    "https://proj.supabase.co/functions/v1/jobs/callback"
                )
            )
            # Same host prefix is enough (no path-suffix restriction).
            self.assertTrue(
                callback.callback_allowed(
                    "https://proj.supabase.co/functions/v1/jobs/callback/extra"
                )
            )
            self.assertFalse(callback.callback_allowed("https://evil.example/cb"))
            self.assertFalse(
                callback.callback_allowed(
                    "https://other.supabase.co/functions/v1/jobs/callback"
                )
            )


if __name__ == "__main__":
    unittest.main()
