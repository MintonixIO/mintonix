#!/usr/bin/env python3
"""Disk-cache behavior for scraper.fetch_wikitext (mocked network)."""

from __future__ import annotations

import importlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
from unittest import mock


class FetchWikitextCacheTests(unittest.TestCase):
    def setUp(self):
        if "scraper" in sys.modules:
            del sys.modules["scraper"]
        self.scraper = importlib.import_module("scraper")
        self._tmpdir = tempfile.TemporaryDirectory()
        self.scraper.CACHE_DIR = self._tmpdir.name
        self.scraper.CACHE_TTL_SEC = 3600
        self.scraper._cache_refresh = False
        self.scraper._cache_disabled = False
        self.page = "Test_Page_2024"
        self.payload = {
            "parse": {"title": self.page, "wikitext": "==Finals==", "pageid": 1}
        }

    def tearDown(self):
        self._tmpdir.cleanup()

    def _cache_path(self):
        safe = self.page.replace("/", "_").replace(" ", "_")
        return os.path.join(self.scraper.CACHE_DIR, safe + ".json")

    def _write_cache(self, mtime_offset=0):
        path = self._cache_path()
        with open(path, "w") as f:
            json.dump(self.payload, f)
        if mtime_offset:
            now = time.time()
            os.utime(path, (now + mtime_offset, now + mtime_offset))
        return path

    def test_cache_hit_skips_network(self):
        self._write_cache()
        with mock.patch("urllib.request.urlopen") as urlopen:
            out = self.scraper.fetch_wikitext(self.page)
            urlopen.assert_not_called()
        self.assertEqual(out["parse"]["title"], self.page)

    def test_stale_cache_refetches(self):
        self._write_cache(mtime_offset=-7200)  # older than TTL
        body = json.dumps(self.payload).encode()

        class Resp:
            def __enter__(self):
                return io.BytesIO(body)

            def __exit__(self, *a):
                return False

        with mock.patch("urllib.request.urlopen", return_value=Resp()) as urlopen:
            with mock.patch.object(self.scraper.time, "sleep"):
                out = self.scraper.fetch_wikitext(self.page)
            urlopen.assert_called_once()
        self.assertEqual(out["parse"]["pageid"], 1)

    def test_refresh_bypasses_fresh_cache(self):
        self._write_cache()
        self.scraper._cache_refresh = True
        body = json.dumps(
            {
                "parse": {
                    "title": self.page,
                    "wikitext": "refreshed",
                    "pageid": 99,
                }
            }
        ).encode()

        class Resp:
            def __enter__(self):
                return io.BytesIO(body)

            def __exit__(self, *a):
                return False

        with mock.patch("urllib.request.urlopen", return_value=Resp()):
            with mock.patch.object(self.scraper.time, "sleep"):
                out = self.scraper.fetch_wikitext(self.page)
        self.assertEqual(out["parse"]["pageid"], 99)
        # Still writes cache under refresh.
        with open(self._cache_path()) as f:
            disk = json.load(f)
        self.assertEqual(disk["parse"]["pageid"], 99)

    def test_no_cache_neither_reads_nor_writes(self):
        self._write_cache()
        self.scraper._cache_disabled = True
        body = json.dumps(
            {
                "parse": {
                    "title": self.page,
                    "wikitext": "live",
                    "pageid": 7,
                }
            }
        ).encode()

        class Resp:
            def __enter__(self):
                return io.BytesIO(body)

            def __exit__(self, *a):
                return False

        with mock.patch("urllib.request.urlopen", return_value=Resp()):
            with mock.patch.object(self.scraper.time, "sleep"):
                out = self.scraper.fetch_wikitext(self.page)
        self.assertEqual(out["parse"]["pageid"], 7)
        # Original on-disk payload unchanged (no write).
        with open(self._cache_path()) as f:
            disk = json.load(f)
        self.assertEqual(disk["parse"]["pageid"], 1)


if __name__ == "__main__":
    unittest.main()
