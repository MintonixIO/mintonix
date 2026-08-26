#!/usr/bin/env python3
"""Unit tests for ratings.py — lock 1.1 / 1.2 / 1.3 and homonym identity."""

from __future__ import annotations

import math
import unittest

import ratings as R


def row(
    *,
    tournament="2024 Indonesia Open · MS · Final",
    t1="Viktor Axelsen",
    t1c="DEN",
    t2="Kodai Naraoka",
    t2c="JPN",
    t1b=None,
    t1bc=None,
    t2b=None,
    t2bc=None,
    g=((21, 15), (21, 18)),
    date=None,
):
    r = {
        "tournament": tournament,
        "match_date": date,
        "team1_player1": t1,
        "team1_player2": t1b,
        "team2_player1": t2,
        "team2_player2": t2b,
        "team1_player1_country": t1c,
        "team1_player2_country": t1bc,
        "team2_player1_country": t2c,
        "team2_player2_country": t2bc,
        "g1_t1": None,
        "g1_t2": None,
        "g2_t1": None,
        "g2_t2": None,
        "g3_t1": None,
        "g3_t2": None,
    }
    for i, (a, b) in enumerate(g, start=1):
        r[f"g{i}_t1"] = a
        r[f"g{i}_t2"] = b
    return r


class NameNormalizationTests(unittest.TestCase):
    def test_underscore_space_nfkd_alias(self):
        # Yilü → Yilu (NFKD) → wang yilyu (alias)
        self.assertEqual(R.normalize_name("Wang_Yilü"), "wang yilyu")
        self.assertEqual(R.normalize_name("Wang Yilu"), "wang yilyu")
        self.assertEqual(R.normalize_name("wang yilü"), "wang yilyu")

    def test_generic_suffix_stripped(self):
        self.assertEqual(R.normalize_name("Brian Yang (badminton)"), "brian yang")
        self.assertEqual(R.normalize_name("Lin Chun-yi (player)"), "lin chun-yi")

    def test_born_year_kept_as_disambiguator(self):
        self.assertEqual(
            R.normalize_name("Chen Yu (badminton, born 1980)"),
            "chen yu (born 1980)",
        )
        self.assertEqual(
            R.normalize_name("Chen Yu (born 1983)"),
            "chen yu (born 1983)",
        )

    def test_an_se_young_aliases(self):
        self.assertEqual(R.normalize_name("An Se Young"), "an se-young")
        self.assertEqual(R.normalize_name("An Se-young"), "an se-young")
        self.assertEqual(R.normalize_name("An Seyoung"), "an se-young")

    def test_whitespace_collapse_lowercase(self):
        self.assertEqual(R.normalize_name("  Viktor   Axelsen  "), "viktor axelsen")

    def test_display_name_title_case(self):
        self.assertEqual(R.display_name("an se-young|kor"), "An Se-Young")
        self.assertEqual(R.display_name("wang yilyu"), "Wang Yilyu")
        self.assertEqual(R.display_name("chen yu (born 1980)|chn"), "Chen Yu (born 1980)")


class HomonymTests(unittest.TestCase):
    def test_same_name_different_country_are_distinct(self):
        a = R.entity_key("Chen Yu", "CHN")
        b = R.entity_key("Chen Yu", "TPE")
        self.assertNotEqual(a, b)
        self.assertTrue(a.startswith("chen yu|"))
        self.assertTrue(b.startswith("chen yu|"))

    def test_same_name_same_country_merge(self):
        self.assertEqual(
            R.entity_key("Viktor Axelsen", "DEN"),
            R.entity_key("viktor_axelsen (badminton)", "Denmark"),
        )

    def test_wiki_born_year_splits_without_country(self):
        a = R.entity_key("Chen Yu (badminton, born 1980)")
        b = R.entity_key("Chen Yu (born 1983)")
        self.assertNotEqual(a, b)

    def test_alias_does_not_fork_same_person(self):
        self.assertEqual(
            R.entity_key("Wang Yilü", "CHN"),
            R.entity_key("Wang Yilyu", "CHN"),
        )

    def test_pair_order_independent(self):
        a = R.entity_key("Liang Wei Keng", "CHN")
        b = R.entity_key("Wang Chang", "CHN")
        self.assertEqual(R.pair_key(a, b), R.pair_key(b, a))


class AbbrevIdentityTests(unittest.TestCase):
    def test_hyphen_and_pinyin_initials(self):
        self.assertEqual(R.given_initials("won-ho"), "wh")
        self.assertEqual(R.given_initials("yufei"), "yf")
        self.assertTrue(R.is_abbrev_given("w-h"))
        self.assertFalse(R.is_abbrev_given("won-ho"))

    def test_unique_abbrev_collapses_before_ratings(self):
        rows = [
            row(
                tournament="2026 Japan Open · MD · Final",
                t1="Kim Won-ho",
                t1c="KOR",
                t1b="Seo Seung-jae",
                t1bc="KOR",
                t2="Goh Sze Fei",
                t2c="MAS",
                t2b="Nur Izzuddin",
                t2bc="MAS",
            ),
            row(
                tournament="2026 All England Open · MD · Final",
                t1="Kim W-h",
                t1c="KOR",
                t1b="Seo S-j",
                t1bc="KOR",
                t2="Goh S F",
                t2c="MAS",
                t2b="Nur Izzuddin",
                t2bc="MAS",
            ),
        ]
        cleaned = R.assign_days(R.clean_matches(R.apply_canonical_names(rows)))
        keys = {k for m in cleaned for k in (*m.side1, *m.side2)}
        kim = [k for k in keys if "kim" in k]
        self.assertEqual(len(kim), 1, kim)
        self.assertTrue(kim[0].startswith("kim won-ho"))

    def test_ambiguous_initials_stay_split(self):
        rows = [
            row(t1="Sung Yu-hsuan", t1c="TPE", t2="A", t2c="JPN"),
            row(
                tournament="2024 Malaysia Open · MS · Final",
                t1="Sung Yi-hao",
                t1c="TPE",
                t2="B",
                t2c="JPN",
            ),
            row(
                tournament="2024 Denmark Open · MS · Final",
                t1="Sung Y-h",
                t1c="TPE",
                t2="C",
                t2c="JPN",
            ),
        ]
        out = R.apply_canonical_names(rows)
        self.assertEqual(out[2]["team1_player1"], "Sung Y-h")


class UniqueCountryFillTests(unittest.TestCase):
    def test_unique_country_fills_missing_flag(self):
        rows = [
            row(t1="Viktor Axelsen", t1c="DEN", t2="Kodai Naraoka", t2c="JPN"),
            row(
                tournament="2024 Malaysia Open · MS · Final",
                t1="Viktor Axelsen",
                t1c=None,
                t2="Lee Zii Jia",
                t2c="MAS",
            ),
        ]
        filled = R.apply_inferred_countries(rows)
        self.assertEqual(
            R.normalize_country(filled[1]["team1_player1_country"]), "den"
        )
        keys = {k for m in R.clean_matches(filled) for k in (*m.side1, *m.side2)}
        axelsen = [k for k in keys if k.startswith("viktor axelsen")]
        self.assertEqual(axelsen, ["viktor axelsen|den"])

    def test_true_homonyms_not_filled_into_each_other(self):
        rows = [
            row(t1="Chen Yu", t1c="CHN", t2="A", t2c="JPN"),
            row(
                tournament="2024 Malaysia Open · MS · Final",
                t1="Chen Yu",
                t1c="TPE",
                t2="B",
                t2c="KOR",
            ),
            row(
                tournament="2024 Japan Open · MS · Final",
                t1="Chen Yu",
                t1c=None,
                t2="C",
                t2c="INA",
            ),
        ]
        inferred = R.infer_unique_countries(rows)
        self.assertNotIn("chen yu", inferred)
        filled = R.apply_inferred_countries(rows)
        self.assertFalse(filled[2]["team1_player1_country"])
        cleaned = R.clean_matches(filled)
        chen_keys = {k for m in cleaned for k in (*m.side1, *m.side2) if k.startswith("chen yu")}
        self.assertEqual(chen_keys, {"chen yu|chn", "chen yu|tpe", "chen yu"})


class CleaningTests(unittest.TestCase):
    def test_drops_bye_and_incomplete_doubles(self):
        vs_bye = row(t2="Bye", t2c=None)
        wo = row(t2="Walkover", t2c=None)
        incomplete_md = row(
            tournament="2024 Indonesia Open · MD · Final",
            t1="Liang Wei Keng",
            t1b=None,
            t2="Kim Astro",
            t2b="Seo Partner",
            t2c="KOR",
            t2bc="KOR",
        )
        full_md = row(
            tournament="2024 Indonesia Open · MD · Final",
            t1="Liang Wei Keng",
            t1b="Wang Chang",
            t1bc="CHN",
            t2="Kim Astro",
            t2b="Seo Partner",
            t2c="KOR",
            t2bc="KOR",
        )
        cleaned = R.clean_matches([vs_bye, wo, incomplete_md, full_md])
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].disc, "MD")
        self.assertEqual(len(cleaned[0].side1), 2)
        self.assertEqual(len(cleaned[0].side2), 2)

    def test_drops_alias_self_match(self):
        cleaned = R.clean_matches(
            [
                row(
                    t1="An Se Young",
                    t1c="KOR",
                    t2="An Se-young",
                    t2c="Korea",
                )
            ]
        )
        self.assertEqual(cleaned, [])

    def test_drops_incomplete_and_walkover(self):
        incomplete = row(g=((21, 15),))
        walkover = row(g=())
        one_all = row(g=((21, 15), (15, 21)))
        good = row()
        cleaned = R.clean_matches([incomplete, walkover, one_all, good])
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0].winner, 1)

    def test_drops_unknown_discipline(self):
        cleaned = R.clean_matches(
            [row(tournament="2024 Thomas Cup · Final")]
        )
        self.assertEqual(cleaned, [])

    def test_drops_duplicate_same_tournament_names_scores(self):
        a = row()
        b = row()  # identical
        cleaned = R.clean_matches([a, b])
        self.assertEqual(len(cleaned), 1)

    def test_keeps_same_names_different_scores(self):
        a = row(g=((21, 15), (21, 18)))
        b = row(g=((21, 19), (19, 21), (21, 15)))
        cleaned = R.clean_matches([a, b])
        self.assertEqual(len(cleaned), 2)

    def test_winner_is_first_to_two_games(self):
        m = R.clean_matches(
            [row(g=((19, 21), (21, 10), (21, 18)))]
        )[0]
        self.assertEqual(m.winner, 1)
        self.assertLess(m.s_win, 0.96)  # 2–1, not a blowout


class ChronologyTests(unittest.TestCase):
    def test_round_order_table(self):
        self.assertEqual(R.round_order("Qualifying"), 0)
        self.assertEqual(R.round_order("Group A"), 1)
        self.assertEqual(R.round_order("Round of 64"), 2)
        self.assertEqual(R.round_order("R32"), 3)
        self.assertEqual(R.round_order("Round of 16"), 4)
        self.assertEqual(R.round_order("Quarter-final"), 5)
        self.assertEqual(R.round_order("Semi-final"), 6)
        self.assertEqual(R.round_order("Bronze medal"), 7)
        self.assertEqual(R.round_order("Final"), 8)

    def test_day_formula(self):
        rows = [
            row(tournament="2024 Indonesia Open · MS · Final"),
            row(
                tournament="2024 Malaysia Open · MS · Round of 32",
                t2="Lee Zii Jia",
                t2c="MAS",
            ),
            row(
                tournament="2023 All England · MS · Final",
                t2="Anthony Ginting",
                t2c="INA",
            ),
        ]
        cleaned = R.assign_days(R.clean_matches(rows))
        # Sorted by (year, round_order, tournament)
        years = [m.year for m in cleaned]
        self.assertEqual(years, sorted(years))
        for i, m in enumerate(cleaned):
            expected = m.year * 400 + m.round_order * 30 + (i % 30)
            self.assertEqual(m.day, expected)

    def test_same_year_final_after_r32(self):
        rows = [
            row(tournament="2024 Japan Open · MS · Final"),
            row(tournament="2024 Japan Open · MS · Round of 32", t2="Kento Momota"),
        ]
        cleaned = R.assign_days(R.clean_matches(rows))
        by_round = {m.round_order: m for m in cleaned}
        self.assertLess(by_round[3].day, by_round[8].day)


class WeightAndScoreTests(unittest.TestCase):
    def test_super100_before_china_masters(self):
        # Baoji must not inherit Super 750 from "China Masters"
        self.assertAlmostEqual(R.tournament_tier_weight("2024 Baoji China Masters · MS · Final"), 0.30)
        self.assertAlmostEqual(R.tournament_tier_weight("2024 Ruichang China Masters · WS · R32"), 0.30)
        self.assertAlmostEqual(R.tournament_tier_weight("2024 China Masters · MS · Final"), 0.85)

    def test_super1000_string_is_not_super100(self):
        self.assertAlmostEqual(
            R.tournament_tier_weight("2024 BWF World Tour Super 1000 · MS · Final"),
            0.95,
        )
        self.assertAlmostEqual(
            R.tournament_tier_weight("2024 Akita Masters Super 100 · MS · Final"),
            0.30,
        )

    def test_worlds_final_weight(self):
        w = R.match_weight("2024 BWF World Championships · MS · Final", "Final")
        self.assertAlmostEqual(w, 1.00)

    def test_super1000_final_and_super100_r32(self):
        self.assertAlmostEqual(
            R.match_weight("2024 Indonesia Open · MS · Final", "Final"), 0.95
        )
        self.assertAlmostEqual(
            R.match_weight("2024 Ruichang Masters Super 100 · MS · Round of 32", "Round of 32"),
            0.30 * 0.92,
        )

    def test_blowout_s_near_one(self):
        s = R.score_result([(21, 5), (21, 7)], 1)
        self.assertGreater(s, 0.98)

    def test_tight_three_setter_s_near_085(self):
        s = R.score_result([(21, 19), (19, 21), (21, 19)], 1)
        self.assertLess(s, 0.90)
        self.assertGreater(s, 0.84)


class EngineSmokeTests(unittest.TestCase):
    def test_winner_rating_rises(self):
        rows = []
        for i in range(16):
            rows.append(
                row(
                    tournament=f"2024 Test Open {i} · MS · Final",
                    t1="Ace Player",
                    t1c="DEN",
                    t2=f"Foe {i}",
                    t2c="JPN",
                    g=((21, 10), (21, 12)),
                )
            )
        result = R.compute_ratings(rows)
        ace = next(r for r in result.glicko if r.entity_key.startswith("ace player"))
        self.assertGreater(ace.mu, 1500)
        self.assertGreaterEqual(ace.matches, 15)
        self.assertEqual(ace.wins, 16)

    def test_extreme_rating_gap_does_not_overflow(self):
        # Repro: math.exp overflow in _E after a huge internal μ gap.
        self.assertTrue(0.0 < R._E(800.0, -800.0, 0.01) < 1.0)
        self.assertTrue(0.0 < R._E(-800.0, 800.0, 0.01) < 1.0)
        p = R.GlickoPlayer(key="ace")
        p.mu = 1500.0 + 800.0 * R.SCALE
        p.rd = 30.0
        R._weighted_glicko_update(p, -800.0, 0.01, 0.99, 1.0)
        self.assertTrue(math.isfinite(p.mu))
        self.assertTrue(math.isfinite(p.rd))
        self.assertTrue(math.isfinite(p.sigma))

    def test_long_win_streak_stays_finite(self):
        rows = []
        for i in range(400):
            rows.append(
                row(
                    tournament=f"2020 Test Open {i} · MS · Final",
                    t1="Ace Player",
                    t1c="DEN",
                    t2=f"Foe {i}",
                    t2c="JPN",
                    g=((21, 5), (21, 3)),
                )
            )
        result = R.compute_ratings(rows)
        ace = next(r for r in result.glicko if r.entity_key.startswith("ace player"))
        self.assertTrue(math.isfinite(ace.mu))
        self.assertTrue(math.isfinite(ace.rd))
        self.assertTrue(math.isfinite(ace.sigma))
        self.assertGreater(ace.mu, 1500)
        self.assertLess(ace.mu, 4000)

    def test_homonyms_rated_separately(self):
        rows = []
        for i in range(16):
            rows.append(
                row(
                    tournament=f"2024 Event {i} · MS · Final",
                    t1="Chen Yu",
                    t1c="CHN",
                    t2=f"Opp A {i}",
                    t2c="JPN",
                )
            )
            rows.append(
                row(
                    tournament=f"2024 Event {i} · MS · Semi-final",
                    t1="Chen Yu",
                    t1c="TPE",
                    t2=f"Opp B {i}",
                    t2c="KOR",
                    g=((10, 21), (12, 21)),  # TPE Chen Yu loses
                )
            )
        result = R.compute_ratings(rows)
        chn = [r for r in result.glicko if r.entity_key == "chen yu|chn"]
        tpe = [r for r in result.glicko if r.entity_key == "chen yu|tpe"]
        self.assertEqual(len(chn), 1)
        self.assertEqual(len(tpe), 1)
        self.assertGreater(chn[0].mu, tpe[0].mu)

    def test_doubles_pair_and_individual_boards(self):
        rows = []
        for i in range(16):
            rows.append(
                row(
                    tournament=f"2024 Super 1000 Pair Cup · MD · Final",
                    t1="Liang Wei Keng",
                    t1c="CHN",
                    t1b="Wang Chang",
                    t1bc="CHN",
                    t2=f"Opp {i} A",
                    t2c="INA",
                    t2b=f"Opp {i} B",
                    t2bc="INA",
                )
            )
        result = R.compute_ratings(rows)
        pairs = [r for r in result.glicko if r.discipline == "MD" and r.kind == "pair"]
        inds = [r for r in result.individuals if r.discipline == "MD"]
        self.assertTrue(pairs)
        self.assertTrue(inds)
        self.assertIn(" / ", pairs[0].entity_key)


if __name__ == "__main__":
    unittest.main()
