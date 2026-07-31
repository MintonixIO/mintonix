#!/usr/bin/env python3
"""Unit tests for purge id batching helpers in load_to_supabase."""

from __future__ import annotations

import importlib
import sys
import unittest
from unittest import mock


class LoadPurgeHelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # load_to_supabase imports requests at module load; stub if missing.
        cls._requests_stub = None
        if "requests" not in sys.modules:
            cls._requests_stub = mock.MagicMock()
            sys.modules["requests"] = cls._requests_stub
        os_env = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_KEY": "test-service-key",
        }
        cls._env_patch = mock.patch.dict("os.environ", os_env)
        cls._env_patch.start()
        if "load_to_supabase" in sys.modules:
            del sys.modules["load_to_supabase"]
        cls.mod = importlib.import_module("load_to_supabase")

    @classmethod
    def tearDownClass(cls):
        cls._env_patch.stop()
        if cls._requests_stub is not None:
            del sys.modules["requests"]

    def test_postgrest_in_list_quotes(self):
        self.assertEqual(
            self.mod.postgrest_in_list(["a", "b"]),
            '("a","b")',
        )

    def test_chunked_batch_size(self):
        ids = [str(i) for i in range(120)]
        chunks = list(self.mod.chunked(ids, batch_size=50))
        self.assertEqual(len(chunks), 3)
        self.assertEqual(len(chunks[0]), 50)
        self.assertEqual(len(chunks[1]), 50)
        self.assertEqual(len(chunks[2]), 20)

    def test_filter_existing_ids_uses_batches_and_owner_filter(self):
        calls = []

        def fake_select(table, columns, order, params=None):
            calls.append(params)
            raw = params["id"].removeprefix("in.")
            ids = [p.strip('"') for p in raw.strip("()").split(",") if p]
            return [{"id": i} for i in ids if int(i) % 2 == 0]

        ids = [str(i) for i in range(12)]
        kept = self.mod.filter_existing_ids(ids, fake_select, batch_size=5)
        self.assertEqual(kept, ["0", "2", "4", "6", "8", "10"])
        self.assertEqual(len(calls), 3)  # 5+5+2
        for params in calls:
            self.assertEqual(params["owner_id"], "is.null")
            self.assertTrue(params["id"].startswith("in."))


if __name__ == "__main__":
    unittest.main()
