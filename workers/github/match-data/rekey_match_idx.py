#!/usr/bin/env python3
"""OBSOLETE — do not run.

This one-shot rekeyed the *legacy* match_data schema (`match_key` / integer
`match_idx` → stable text idx). The match-centric pipeline dropped those
columns; identity is now `matches.id = sha256(match_key).hexdigest()` computed
in `load_to_supabase.py` on every load.

Kept only so old docs/commands fail loudly instead of half-applying.
"""
import sys

sys.exit(
    "rekey_match_idx.py is obsolete under the match-centric schema "
    "(see workers/github/match-data/schema.md). Re-run the scraper + "
    "load_to_supabase.py instead."
)
