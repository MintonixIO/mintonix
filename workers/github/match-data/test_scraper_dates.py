#!/usr/bin/env python3
"""Infobox date-range + round interpolation (no live Wikipedia)."""

from __future__ import annotations

import importlib
import sys
import unittest


class InfoboxDateTests(unittest.TestCase):
    def setUp(self):
        if "scraper" in sys.modules:
            del sys.modules["scraper"]
        self.s = importlib.import_module("scraper")

    def test_same_month_range(self):
        a, b = self.s.parse_infobox_date_range("7–12 January", 2025)
        self.assertEqual(a, "2025-01-07")
        self.assertEqual(b, "2025-01-12")

    def test_cross_month(self):
        a, b = self.s.parse_infobox_date_range("28 January – 2 February", 2025)
        self.assertEqual(a, "2025-01-28")
        self.assertEqual(b, "2025-02-02")

    def test_year_crossing(self):
        a, b = self.s.parse_infobox_date_range("29 December – 3 January", 2025)
        self.assertEqual(a, "2024-12-29")
        self.assertEqual(b, "2025-01-03")

    def test_explicit_years(self):
        a, b = self.s.parse_infobox_date_range(
            "29 December 2024 – 3 January 2025", 2025
        )
        self.assertEqual(a, "2024-12-29")
        self.assertEqual(b, "2025-01-03")

    def test_start_date_templates(self):
        a, b = self.s.parse_infobox_date_range(
            "{{Start date|2025|1|7}} – {{End date|2025|1|12}}", 2025
        )
        self.assertEqual(a, "2025-01-07")
        self.assertEqual(b, "2025-01-12")

    def test_single_day(self):
        a, b = self.s.parse_infobox_date_range("15 June", 2024)
        self.assertEqual(a, "2024-06-15")
        self.assertEqual(b, "2024-06-15")

    def test_empty(self):
        self.assertEqual(self.s.parse_infobox_date_range("", 2024), (None, None))

    def test_compact_range_does_not_eat_year(self):
        # "2024 – 3 January" must not parse as days 24–3.
        a, b = self.s.parse_infobox_date_range("2024 – 3 January", 2024)
        self.assertEqual(a, "2024-01-03")
        self.assertEqual(b, "2024-01-03")


    def test_final_is_last_day(self):
        d = self.s.date_for_round("Final", "2025-01-07", "2025-01-12")
        self.assertEqual(d, "2025-01-12")

    def test_qual_is_first_day(self):
        d = self.s.date_for_round("Qualifying", "2025-01-07", "2025-01-12")
        self.assertEqual(d, "2025-01-07")

    def test_r32_is_inside_window(self):
        d = self.s.date_for_round("Round of 32", "2025-01-07", "2025-01-12")
        self.assertGreaterEqual(d, "2025-01-07")
        self.assertLess(d, "2025-01-12")

    def test_assign_keeps_group_stage_exact_date(self):
        matches = [
            {"round": "Group A", "date": "2024-12-17"},
            {"round": "Final", "date": None},
        ]
        info = {"dates": "11–17 December"}
        self.s.assign_bracket_dates(matches, info, 2024)
        self.assertEqual(matches[0]["date"], "2024-12-17")
        self.assertEqual(matches[1]["date"], "2024-12-17")

    def test_parse_infobox_badminton_event(self):
        wt = (
            "{{short description|x}}\n"
            "{{Infobox badminton event\n"
            "|name           = 2026 All England Open\n"
            "|dates          = 3–8 March\n"
            "|venue          = Arena\n"
            "}}\n"
        )
        info = self.s.parse_infobox(wt)
        self.assertEqual(info.get("dates"), "3–8 March")

    def test_parse_infobox_tournament_legacy_name(self):
        info = self.s.parse_infobox(
            "{{Infobox tournament\n|dates = 1–6 July\n}}\n"
        )
        self.assertEqual(info.get("dates"), "1–6 July")

    def test_assign_from_badminton_event_infobox(self):
        matches = [
            {"round": "Final", "date": None},
            {"round": "First round", "date": None},
        ]
        info = self.s.parse_infobox(
            "{{Infobox badminton event\n|dates = 3–8 March\n}}\n"
        )
        self.s.assign_bracket_dates(matches, info, 2026)
        self.assertEqual(info["_date_start"], "2026-03-03")
        self.assertEqual(info["_date_end"], "2026-03-08")
        self.assertEqual(matches[0]["date"], "2026-03-08")
        self.assertEqual(matches[1]["date"], "2026-03-05")



if __name__ == "__main__":
    unittest.main()
