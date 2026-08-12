#!/usr/bin/env python3
"""CLI behavior tests for scraper.py (no live Wikipedia)."""

from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from unittest import mock


class ScraperCliTests(unittest.TestCase):
    def setUp(self):
        # Fresh module each test so globals reset cleanly.
        if "scraper" in sys.modules:
            del sys.modules["scraper"]
        self.scraper = importlib.import_module("scraper")

    def test_refresh_and_no_cache_are_mutually_exclusive(self):
        with self.assertRaises(SystemExit) as cm:
            self.scraper.main(
                ["--year", "2010", "--refresh", "--no-cache", "--allow-empty"]
            )
        self.assertEqual(cm.exception.code, 2)

    def test_empty_season_exits_one_without_allow_empty(self):
        with mock.patch.object(
            self.scraper,
            "scrape_season",
            return_value={
                "total_tournaments": 0,
                "total_matches": 0,
                "total_skipped": 0,
            },
        ):
            with self.assertRaises(SystemExit) as cm:
                self.scraper.main(["--year", "2010"])
            self.assertEqual(cm.exception.code, 1)

    def test_allow_empty_does_not_exit_on_zero_tournaments(self):
        with mock.patch.object(
            self.scraper,
            "scrape_season",
            return_value={
                "total_tournaments": 0,
                "total_matches": 0,
                "total_skipped": 0,
            },
        ):
            # Should return normally (None).
            self.assertIsNone(
                self.scraper.main(["--year", "2010", "--allow-empty"])
            )

    def test_partial_season_exits_zero_with_warning(self):
        """≥1 tournament + skips → warn, exit 0 (not a hard failure)."""
        with mock.patch.object(
            self.scraper,
            "scrape_season",
            return_value={
                "total_tournaments": 3,
                "total_matches": 40,
                "total_skipped": 2,
            },
        ):
            self.assertIsNone(self.scraper.main(["--year", "2024"]))

    def test_empty_season_does_not_clobber_existing_json(self):
        """Failing closed must not overwrite a good bwf_<year>_results.json."""
        with tempfile.TemporaryDirectory() as tmp:
            good = {
                "season": 2010,
                "tournaments": [{"title": "keep-me"}],
                "stats": {
                    "total_tournaments": 1,
                    "total_matches": 5,
                    "total_skipped": 0,
                },
            }
            out_path = os.path.join(tmp, "bwf_2010_results.json")
            with open(out_path, "w") as f:
                json.dump(good, f)

            with mock.patch.object(self.scraper, "PROJECT_DIR", tmp):
                with mock.patch.object(
                    self.scraper, "enumerate_tournaments", return_value=([], "page")
                ):
                    stats = self.scraper.scrape_season(2010, allow_empty=False)

            self.assertEqual(stats["total_tournaments"], 0)
            with open(out_path) as f:
                preserved = json.load(f)
            self.assertEqual(preserved["tournaments"][0]["title"], "keep-me")

    def test_allow_empty_writes_empty_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "bwf_2010_results.json")
            with mock.patch.object(self.scraper, "PROJECT_DIR", tmp):
                with mock.patch.object(
                    self.scraper, "enumerate_tournaments", return_value=([], "page")
                ):
                    stats = self.scraper.scrape_season(2010, allow_empty=True)

            self.assertEqual(stats["total_tournaments"], 0)
            self.assertTrue(os.path.isfile(out_path))
            with open(out_path) as f:
                data = json.load(f)
            self.assertEqual(data["tournaments"], [])

    def test_successful_scrape_writes_via_atomic_replace(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_path = os.path.join(tmp, "bwf_2024_results.json")
            tournament = {
                "title": "2024 Test Open",
                "matches": [],
            }

            def fake_fetch(title):
                return {
                    "parse": {
                        "wikitext": "",
                        "title": title,
                        "pageid": 1,
                    }
                }

            with mock.patch.object(self.scraper, "PROJECT_DIR", tmp):
                with mock.patch.object(
                    self.scraper,
                    "enumerate_tournaments",
                    return_value=(["2024_Test_Open"], "season"),
                ):
                    with mock.patch.object(
                        self.scraper, "fetch_wikitext", side_effect=fake_fetch
                    ):
                        with mock.patch.object(
                            self.scraper,
                            "parse_tournament_page",
                            return_value=tournament,
                        ):
                            stats = self.scraper.scrape_season(
                                2024, allow_empty=False
                            )

            self.assertEqual(stats["total_tournaments"], 1)
            self.assertTrue(os.path.isfile(out_path))
            self.assertFalse(os.path.isfile(out_path + ".tmp"))

    def test_refresh_flag_sets_module_globals(self):
        with mock.patch.object(
            self.scraper,
            "scrape_season",
            return_value={
                "total_tournaments": 1,
                "total_matches": 2,
                "total_skipped": 0,
            },
        ):
            self.scraper.main(["--year", "2024", "--refresh"])
        self.assertTrue(self.scraper._cache_refresh)
        self.assertFalse(self.scraper._cache_disabled)

    def test_no_cache_flag_sets_module_globals(self):
        with mock.patch.object(
            self.scraper,
            "scrape_season",
            return_value={
                "total_tournaments": 1,
                "total_matches": 2,
                "total_skipped": 0,
            },
        ):
            self.scraper.main(["--year", "2024", "--no-cache"])
        self.assertFalse(self.scraper._cache_refresh)
        self.assertTrue(self.scraper._cache_disabled)


if __name__ == "__main__":
    unittest.main()
