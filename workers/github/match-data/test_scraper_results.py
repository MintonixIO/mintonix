#!/usr/bin/env python3
"""Walkover / retirement rows stay in the scrape (ratings still drop them)."""

from __future__ import annotations

import importlib
import sys
import unittest


class ScraperResultTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if "scraper" in sys.modules:
            del sys.modules["scraper"]
        cls.s = importlib.import_module("scraper")

    def test_classify_walkover_and_retired(self):
        self.assertEqual(self.s.classify_result_text("w/o"), "walkover")
        self.assertEqual(self.s.classify_result_text("W/O"), "walkover")
        self.assertEqual(self.s.classify_result_text("walkover"), "walkover")
        self.assertEqual(self.s.classify_result_text("21–15 retired"), "retired")
        self.assertIsNone(self.s.classify_result_text("'''21'''–15"))

    def test_bracket_walkover_is_kept(self):
        content = """8TeamBracket
|RD1-team1='''{{flagicon|DEN}} [[Viktor Axelsen]]'''
|RD1-team2={{flagicon|JPN}} [[Kodai Naraoka]]
|RD1-score1=w/o
"""
        matches = self.s.extract_bracket_matches(
            content, ["Men's singles"], "2026 Test Open", "MS"
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["result"], "walkover")
        self.assertTrue(matches[0]["team1"]["is_winner"])
        self.assertEqual(matches[0]["team1"]["players"][0]["wiki_name"], "Viktor Axelsen")
        self.assertEqual(matches[0]["team2"]["players"][0]["wiki_name"], "Kodai Naraoka")

    def test_retired_set_keeps_points(self):
        parsed = self.s._parse_set_score("'''21'''–15 retired")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed[0]["score"], 21)
        self.assertEqual(parsed[1]["score"], 15)

    def test_group_walkover_is_kept(self):
        wikitext = """
==Men's singles==
===Group A===
{| class="wikitable"
! Date !! Player 1 !! Score !! Player 2 !! Set 1 !! Set 2 !! Set 3
|-
| 17 Dec
| '''[[Viktor Axelsen]] {{flagicon|DEN}}'''
| w/o
| {{flagicon|JPN}} [[Kodai Naraoka]]
|
|
|
|}
"""
        matches = self.s.extract_group_stage_matches(
            wikitext, 0, len(wikitext), "2026 BWF World Tour Finals", "MS", 2026
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["result"], "walkover")
        self.assertTrue(matches[0]["team1"]["players"])
        self.assertTrue(matches[0]["team2"]["players"])


if __name__ == "__main__":
    unittest.main()
