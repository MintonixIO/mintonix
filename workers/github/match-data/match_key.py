"""Shared BWF match_key construction (scraper → finder → loader).

Canonical form (not a DB column):
  season|tournament|discipline|section|round|match_idx

``section`` is the **leaf** of section_path (not the full breadcrumb) so
intermediate heading renames on Wikipedia do not re-key every match.
``match_idx`` is roster-stable (``r{sha1}``) or positional fallback (``p{n}``).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata


def normalize_player_name(name: str | None) -> str:
    """Stable-ish player token for roster anchors (NFKC, strip parentheticals)."""
    n = unicodedata.normalize("NFKC", name or "").strip().lower()
    n = re.sub(r"\s*\([^)]*\)\s*", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def section_leaf(section_path: list | tuple | None) -> str:
    """Stable section component for match_key: last path segment only."""
    path = list(section_path or [])
    return path[-1] if path else ""


def make_match_key(
    season,
    tournament,
    discipline,
    section,
    rnd,
    match_idx,
) -> str:
    return f"{season}|{tournament}|{discipline}|{section}|{rnd}|{match_idx}"


def match_key_from_scraped(
    season,
    tournament,
    match: dict,
) -> str:
    """Build match_key from a scraper match dict (uses leaf section)."""
    section = section_leaf(match.get("section_path"))
    return make_match_key(
        season,
        tournament,
        match["discipline"],
        section,
        match["round"],
        match.get("match_idx", 0),
    )


def bwf_match_id(match_key: str) -> str:
    """Content-addressed PK: full sha256 hex of the stable scraper key."""
    return hashlib.sha256(match_key.encode("utf-8")).hexdigest()
