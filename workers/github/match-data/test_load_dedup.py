"""Unit tests for catalog re-key orphan helpers (no network)."""

from __future__ import annotations

import unittest

from load_to_supabase import prefer_catalog_row, roster_key


class RosterKeyTests(unittest.TestCase):
    def test_order_independent(self) -> None:
        a = {
            "team1_player1": "Alice",
            "team2_player1": "Bob",
        }
        b = {
            "team1_player1": "Bob",
            "team2_player1": "Alice",
        }
        self.assertEqual(roster_key(a), roster_key(b))

    def test_ignores_empty(self) -> None:
        row = {
            "team1_player1": "Alice",
            "team1_player2": None,
            "team2_player1": "Bob",
            "team2_player2": "",
        }
        self.assertEqual(roster_key(row), ("Alice", "Bob"))


class PreferCatalogRowTests(unittest.TestCase):
    def test_prefers_pipeline_progress(self) -> None:
        old = {
            "id": "a",
            "status": "ready",
            "source_url": None,
            "created_at": "2026-07-12T00:00:00Z",
        }
        new = {
            "id": "b",
            "status": "pending",
            "source_url": "https://youtube.com/watch?v=x",
            "created_at": "2026-07-31T00:00:00Z",
        }
        self.assertEqual(prefer_catalog_row(old, new)["id"], "a")

    def test_prefers_source_url_when_both_pending(self) -> None:
        old = {
            "id": "a",
            "status": "pending",
            "source_url": "https://youtube.com/watch?v=x",
            "created_at": "2026-07-12T00:00:00Z",
        }
        new = {
            "id": "b",
            "status": "pending",
            "source_url": None,
            "created_at": "2026-07-31T00:00:00Z",
        }
        self.assertEqual(prefer_catalog_row(old, new)["id"], "a")

    def test_prefers_newer_created_at(self) -> None:
        old = {
            "id": "a",
            "status": "pending",
            "source_url": None,
            "created_at": "2026-07-12T00:00:00Z",
        }
        new = {
            "id": "b",
            "status": "pending",
            "source_url": None,
            "created_at": "2026-07-31T00:00:00Z",
        }
        self.assertEqual(prefer_catalog_row(old, new)["id"], "b")


if __name__ == "__main__":
    unittest.main()
