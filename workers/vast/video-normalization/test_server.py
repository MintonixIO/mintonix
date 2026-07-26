"""Tests for server callback URL allowlist policy."""

import os
import unittest
from unittest import mock

import test_support  # noqa: F401  # sets ALLOW_FILE_URLS

import server as srv


class TestCallbackAllowlist(unittest.TestCase):
    """Allow/deny matrix for callback_url policy (stock path-suffix default,
    explicit prefix, ALLOW_UNSAFE_CALLBACK escape hatch)."""

    def _env(self, **kwargs):
        base = {
            "CALLBACK_URL_PREFIX": "",
            "SUPABASE_URL": "",
            "ALLOW_UNSAFE_CALLBACK": "0",
        }
        base.update(kwargs)
        return mock.patch.dict(os.environ, base, clear=False)

    def test_stock_path_suffix_allow_deny(self):
        """No prefix env: https + path ends with /functions/v1/jobs/callback."""
        good = "https://proj.supabase.co/functions/v1/jobs/callback"
        with_query = "https://other.example/functions/v1/jobs/callback?x=1"
        with self._env():
            self.assertTrue(srv._callback_url_allowed(good))
            self.assertTrue(srv._callback_url_allowed(with_query))
            # any https host is ok if the path matches (stock multi-project)
            self.assertTrue(srv._callback_url_allowed(
                "https://evil.example/functions/v1/jobs/callback"
            ))
            # wrong path / scheme / host tricks
            self.assertFalse(srv._callback_url_allowed(
                "https://evil.example/cb"
            ))
            self.assertFalse(srv._callback_url_allowed(
                "https://evil.example/functions/v1/jobs/callback/extra"
            ))
            self.assertFalse(srv._callback_url_allowed(
                "https://evil.example/functions/v1/jobs/callbackevil"
            ))
            self.assertFalse(srv._callback_url_allowed(
                "http://proj.supabase.co/functions/v1/jobs/callback"
            ))
            self.assertFalse(srv._callback_url_allowed(
                "file:///functions/v1/jobs/callback"
            ))
            # empty / None always ok (no callback channel)
            self.assertTrue(srv._callback_url_allowed(""))
            self.assertTrue(srv._callback_url_allowed(None))

    def test_allow_with_prefix(self):
        with self._env(CALLBACK_URL_PREFIX="https://proj.supabase.co"):
            self.assertTrue(
                srv._callback_url_allowed(
                    "https://proj.supabase.co/functions/v1/jobs/callback"
                )
            )
            self.assertFalse(
                srv._callback_url_allowed("https://evil.example/cb")
            )
            # prefix mode is strict: correct path on other host is denied
            self.assertFalse(
                srv._callback_url_allowed(
                    "https://other.supabase.co/functions/v1/jobs/callback"
                )
            )

    def test_supabase_url_as_prefix(self):
        with self._env(SUPABASE_URL="https://proj.supabase.co"):
            self.assertTrue(srv._callback_url_allowed(
                "https://proj.supabase.co/functions/v1/jobs/callback"
            ))
            self.assertFalse(srv._callback_url_allowed(
                "https://other.example/functions/v1/jobs/callback"
            ))

    def test_allow_unsafe_dev_escape(self):
        with self._env(ALLOW_UNSAFE_CALLBACK="1"):
            self.assertTrue(srv._callback_url_allowed("https://any/cb"))
            self.assertTrue(srv._callback_url_allowed(
                "http://127.0.0.1:9/callback"
            ))


if __name__ == "__main__":
    unittest.main()
