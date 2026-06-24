#!/usr/bin/env python3
"""
One-time migration: re-key existing matches to the stable, content-derived
match_idx (see scraper.assign_unique_match_idx).

The old match_idx was a positional ordinal; the new one is a roster hash. The
two formats are disjoint (old keys end in an integer, new ones in 'r<hash>' /
'p<n>'), so every new match_key differs from every old one and we can UPDATE the
keys IN PLACE — preserving each match's id, its match_players, and its video
columns. No rows are orphaned and no video links need re-matching.

Run AFTER applying 20260624000100_match_idx_stable_text.sql (which widens
match_idx to text). It also rewrites the on-disk artifacts so the next loader run
agrees with the DB:
  - bwf_<year>_results.json : match_idx rewritten to the new hash
  - video_matches.json      : match_key remapped old -> new

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 rekey_match_idx.py          # dry run
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 rekey_match_idx.py --apply   # write
"""
import argparse
import glob
import json
import os
import sys

from load_to_supabase import upsert, select  # imports also validate env vars
from scraper import assign_unique_match_idx

HERE = os.path.dirname(os.path.abspath(__file__))


def _key(season, tournament, m):
    section = "/".join(m.get("section_path") or [])
    return f"{season}|{tournament}|{m['discipline']}|{section}|{m['round']}|{m.get('match_idx', 0)}"


def build_keymap(results_paths):
    """Return ({old_key: (new_key, new_idx)}, [paths_to_rewrite]).

    Mutates each JSON's match_idx to the new value in memory and writes the file
    back only when --apply is passed (handled by the caller).
    """
    keymap = {}
    new_keys = set()
    collisions = []
    rewritten = {}  # path -> data
    for path in results_paths:
        data = json.load(open(path))
        season = data["season"]
        for t in data["tournaments"]:
            tournament = t.get("title") or t.get("page")
            matches = t["matches"]
            old_keys = [_key(season, tournament, m) for m in matches]
            assign_unique_match_idx(matches)  # rewrites m["match_idx"] in place
            for m, old_key in zip(matches, old_keys):
                new_key = _key(season, tournament, m)
                if new_key in new_keys:
                    collisions.append(new_key)
                new_keys.add(new_key)
                keymap[old_key] = (new_key, m["match_idx"])
        rewritten[path] = data
    return keymap, rewritten, collisions


def main():
    ap = argparse.ArgumentParser(description="Re-key matches to stable match_idx")
    ap.add_argument("--apply", action="store_true", help="Write to DB and JSON (default: dry run)")
    args = ap.parse_args()

    results_paths = sorted(glob.glob(os.path.join(HERE, "bwf_*_results.json")))
    if not results_paths:
        sys.exit("No bwf_*_results.json found")

    keymap, rewritten, collisions = build_keymap(results_paths)
    print(f"Computed {len(keymap)} key remappings from {len(results_paths)} files")
    if collisions:
        print(f"ABORT: {len(collisions)} new match_key collisions (duplicate rosters in a group):")
        for c in collisions[:20]:
            print(f"  {c}")
        sys.exit("Resolve collisions before applying.")

    # Map current DB rows to their new keys (only rows whose old key we know).
    db = select("matches", "id,match_key", "id")
    rows, unknown = [], 0
    for r in db:
        hit = keymap.get(r["match_key"])
        if hit:
            new_key, new_idx = hit
            rows.append({"id": r["id"], "match_key": new_key, "match_idx": new_idx})
        else:
            unknown += 1
    print(f"DB: {len(db)} matches, {len(rows)} will be re-keyed, "
          f"{unknown} have no mapping (left untouched)")

    vm_path = os.path.join(HERE, "video_matches.json")
    vm = json.load(open(vm_path)) if os.path.exists(vm_path) else []
    vm_remapped = sum(1 for v in vm if v.get("match_key") in keymap)
    vm_orphan = sum(1 for v in vm if v.get("match_key") not in keymap)
    print(f"video_matches.json: {len(vm)} links, {vm_remapped} remapped, {vm_orphan} unmapped")

    if not args.apply:
        print("\nDry run — nothing written. Re-run with --apply to commit.")
        return

    # 1. Re-key DB rows in place (upsert on id; merge-duplicates only touches the
    #    provided columns, so video_*, scores, winner, etc. are preserved).
    print(f"\nRe-keying {len(rows)} matches in the DB...")
    upsert("matches", rows, on_conflict="id")

    # 2. Rewrite on-disk results JSON with the new match_idx.
    for path, data in rewritten.items():
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Rewrote {len(rewritten)} results JSON files")

    # 3. Remap video_matches.json keys.
    for v in vm:
        hit = keymap.get(v.get("match_key"))
        if hit:
            v["match_key"] = hit[0]
    with open(vm_path, "w", encoding="utf-8") as f:
        json.dump(vm, f, ensure_ascii=False, indent=2)
    print(f"Rewrote {vm_path} ({vm_remapped} remapped)")
    print("\nDone.")


if __name__ == "__main__":
    main()
