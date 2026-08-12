#!/usr/bin/env python3
"""
Load BWF scraped JSON into Supabase `matches` (match-centric pipeline schema).

Canonical schema: supabase/README.md + migration
`20260712000000_init_match_pipeline.sql`.

- One row per finished match on `matches` (no nations / players / match_players).
- `id` = sha256(utf-8 match_key).hexdigest() — stable re-scrape key; scores are
  not part of the hash.
- Internal `match_key` is loader-only (never a DB column):
    season|tournament|discipline|section|round|match_idx
- YouTube links from find_youtube_videos.py become `source_url` when coverage
  is healthy; degraded mappings never wipe existing URLs.
- Catalog upsert only. Does NOT call matches-ingest / enqueue GPU jobs
  (ARCHITECTURE.md: metadata load vs pipeline enqueue are separate).
- After upsert, purges re-keyed orphans: BWF rows that share this load's
  (tournament, roster) under a different id (match_key scheme drift).
  One-shot full-catalog collapse: ``--purge-duplicates-only``.

Usage:
    SUPABASE_URL=https://yourproject.supabase.co \\
    SUPABASE_SERVICE_KEY=your-service-role-key \\
    python3 load_to_supabase.py --json-file bwf_2026_results.json \\
        --videos-file video_matches.json

    python3 load_to_supabase.py --purge-duplicates-only

The service role key bypasses RLS — never expose it to the frontend.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date

import requests

from match_key import bwf_match_id, match_key_from_scraped

SUPABASE_URL = ""
SUPABASE_KEY = ""
HEADERS: dict[str, str] = {}

# When True, every write primitive is a no-op: main() becomes a read-only pass
# that reports what *would* change. Set from --dry-run in main().
DRY_RUN = False


def _configure_client() -> None:
    global SUPABASE_URL, SUPABASE_KEY, HEADERS
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars")
    HEADERS = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }

# Writable match columns (omit status/probe fields so a re-scrape never clobbers
# pipeline progress). source_url is applied only when video coverage is healthy.
MATCH_UPSERT_COLS = (
    "id",
    "tournament",
    "match_date",
    "team1_player1",
    "team1_player2",
    "team2_player1",
    "team2_player2",
    "g1_t1", "g1_t2",
    "g2_t1", "g2_t2",
    "g3_t1", "g3_t2",
    "source_url",
)


def youtube_url(video_id: str | None) -> str | None:
    if not video_id:
        return None
    return f"https://www.youtube.com/watch?v={video_id}"


def upsert(table, rows, on_conflict, batch_size=500):
    """Upsert rows in batches, retrying on rate-limit / server errors.

    Only columns present on each row are written (PostgREST merge-duplicates).
    Rows are grouped by key set first — PostgREST rejects mixed-key arrays
    with PGRST102 ("All object keys must match").
    """
    if not rows:
        return 0
    if DRY_RUN:
        return 0
    # Group by identical key sets so each POST body is homogeneous.
    by_keys: dict[frozenset[str], list] = {}
    for row in rows:
        by_keys.setdefault(frozenset(row.keys()), []).append(row)

    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}
    params = {"on_conflict": on_conflict}
    total = 0
    for group in by_keys.values():
        for i in range(0, len(group), batch_size):
            batch = group[i : i + batch_size]
            for attempt in range(6):
                r = requests.post(
                    f"{SUPABASE_URL}/rest/v1/{table}",
                    headers=headers,
                    params=params,
                    json=batch,
                    timeout=60,
                )
                if r.status_code in (200, 201, 204):
                    total += len(batch)
                    break
                if r.status_code in (429, 500, 502, 503) and attempt < 5:
                    wait = 2 ** attempt
                    print(f"  {table}: {r.status_code}, retry in {wait}s...")
                    time.sleep(wait)
                    continue
                print(f"  {table}: {r.status_code} {r.text[:300]}")
                r.raise_for_status()
    return total


def select(table, columns, order, params=None):
    """Fetch all rows with pagination. `params` adds PostgREST filters."""
    rows = []
    offset = 0
    while True:
        q = {"select": columns, "order": order, "limit": 1000, "offset": offset}
        if params:
            q.update(params)
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=HEADERS,
            params=q,
            timeout=60,
        )
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    return rows


def count_rows(table, filters):
    """Exact count of rows matching `filters` (PostgREST count=exact header)."""
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Prefer": "count=exact", "Range": "0-0"},
        params={"select": "id", **filters},
        timeout=60,
    )
    r.raise_for_status()
    cr = r.headers.get("Content-Range", "")
    return int(cr.split("/")[-1]) if "/" in cr else len(r.json())


# Keep id=in.(…) GET/DELETE URLs short (64-char hashes × N values).
ID_BATCH_SIZE = 50


def postgrest_in_list(ids):
    """PostgREST `in` filter value for text PKs: ("a","b")."""
    return "(" + ",".join(f'"{x}"' for x in ids) + ")"


def chunked(ids, batch_size=ID_BATCH_SIZE):
    """Yield successive slices of ids (pure helper for purge/delete batches)."""
    for i in range(0, len(ids), batch_size):
        yield ids[i : i + batch_size]


def filter_existing_ids(ids, select_fn, batch_size=ID_BATCH_SIZE):
    """
    Return the subset of ids that exist as BWF rows (owner_id is null).
    select_fn(table, columns, order, params) must return row dicts with `id`.
    """
    existing = set()
    for batch in chunked(ids, batch_size):
        inlist = postgrest_in_list(batch)
        for r in select_fn(
            "matches",
            "id",
            "id",
            params={"id": f"in.{inlist}", "owner_id": "is.null"},
        ):
            existing.add(r["id"])
    return [i for i in ids if i in existing]


def delete_matches(ids, batch_size=ID_BATCH_SIZE):
    """Delete BWF match rows by id (owner_id null only); jobs cascade."""
    if not ids:
        return 0
    if DRY_RUN:
        return len(ids)
    removed = 0
    for batch in chunked(ids, batch_size):
        inlist = postgrest_in_list(batch)
        for attempt in range(6):
            r = requests.delete(
                f"{SUPABASE_URL}/rest/v1/matches",
                headers={**HEADERS, "Prefer": "return=minimal"},
                params={"id": f"in.{inlist}", "owner_id": "is.null"},
                timeout=60,
            )
            if r.status_code in (200, 204):
                removed += len(batch)
                break
            if r.status_code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
    return removed


def roster_key(row: dict) -> tuple[str, ...]:
    """Order-independent player identity for a flat matches row."""
    return tuple(
        sorted(
            n
            for n in (
                row.get("team1_player1"),
                row.get("team1_player2"),
                row.get("team2_player1"),
                row.get("team2_player2"),
            )
            if n
        )
    )


def _has_pipeline_progress(row: dict) -> bool:
    """True if the row looks past pure catalog metadata."""
    if row.get("status") and row["status"] != "pending":
        return True
    return any(
        row.get(k) is not None
        for k in ("duration_sec", "width", "height", "fps")
    )


def prefer_catalog_row(a: dict, b: dict) -> dict:
    """Pick the survivor when two BWF rows are the same logical match.

    Priority: pipeline progress → source_url → newest created_at → larger id.
    """
    ap, bp = _has_pipeline_progress(a), _has_pipeline_progress(b)
    if ap != bp:
        return a if ap else b
    au, bu = bool(a.get("source_url")), bool(b.get("source_url"))
    if au != bu:
        return a if au else b
    ac, bc = a.get("created_at") or "", b.get("created_at") or ""
    if ac != bc:
        return a if ac > bc else b
    return a if (a.get("id") or "") >= (b.get("id") or "") else b


def find_rekeyed_orphan_ids(match_rows: list[dict]) -> list[str]:
    """IDs of BWF rows that match this load's (tournament, roster) under an old id.

    Content-addressed ``matches.id`` changes when match_key construction changes
    (e.g. section full-path → leaf). Upsert only inserts the new hash; the old
    row remains. Scope the search to tournament labels present in this load so
    other seasons are untouched.
    """
    if not match_rows:
        return []
    keep_ids = {r["id"] for r in match_rows}
    by_tour: dict[str, set[tuple[str, ...]]] = {}
    for r in match_rows:
        tour = r.get("tournament")
        rk = roster_key(r)
        if not tour or not rk:
            continue
        by_tour.setdefault(tour, set()).add(rk)

    orphan_ids: list[str] = []
    for tour, rosters in by_tour.items():
        db_rows = select(
            "matches",
            "id,tournament,team1_player1,team1_player2,team2_player1,team2_player2,"
            "source_url,status,duration_sec,width,height,fps,created_at",
            "id",
            params={"owner_id": "is.null", "tournament": f"eq.{tour}"},
        )
        for db in db_rows:
            if db["id"] in keep_ids:
                continue
            if roster_key(db) in rosters:
                orphan_ids.append(db["id"])
    return orphan_ids


def find_global_duplicate_orphan_ids() -> list[str]:
    """Scan all BWF rows and return ids to drop so each (tournament, roster) is unique.

    Used for one-shot cleanup after a match_key scheme change. Keeps the preferred
    row per cluster (see prefer_catalog_row).
    """
    db_rows = select(
        "matches",
        "id,tournament,team1_player1,team1_player2,team2_player1,team2_player2,"
        "source_url,status,duration_sec,width,height,fps,created_at",
        "created_at",
        params={"owner_id": "is.null"},
    )
    clusters: dict[tuple, list[dict]] = {}
    for r in db_rows:
        tour = r.get("tournament")
        rk = roster_key(r)
        if not tour or not rk:
            continue
        clusters.setdefault((tour, rk), []).append(r)

    orphan_ids: list[str] = []
    for group in clusters.values():
        if len(group) < 2:
            continue
        keep = group[0]
        for other in group[1:]:
            keep = prefer_catalog_row(keep, other)
        for r in group:
            if r["id"] != keep["id"]:
                orphan_ids.append(r["id"])
    return orphan_ids


def player_name(p):
    """Canonical name: wiki page title when present, else display."""
    return (p.get("wiki_name") or p.get("display_name") or "").strip()


def team_slots(team: dict) -> tuple[str | None, str | None]:
    """Map a scraped team roster to (player1, player2); singles → player2 None."""
    names = [player_name(p) for p in (team.get("players") or []) if player_name(p)]
    p1 = names[0] if len(names) > 0 else None
    p2 = names[1] if len(names) > 1 else None
    return p1, p2


_MONTHS = {
    m.lower(): i
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        start=1,
    )
}


def to_iso_date(raw, season):
    """Normalize a scraped date to ISO 'YYYY-MM-DD' for the date column."""
    if not raw:
        return None
    raw = raw.strip()
    if re.match(r"\d{4}-\d{2}-\d{2}$", raw):
        return raw
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)", raw)
    if not m:
        return None
    mon = _MONTHS.get(m.group(2)[:3].lower())
    if not mon:
        return None
    try:
        return date(season, mon, int(m.group(1))).isoformat()
    except ValueError:
        return None


def games_to_columns(games):
    """Map the scraped games list to flat g{n}_t{side} score columns.

    Returns (cols, (w1, w2, n1, n2)) where:
      w1/w2 — games won from per-game is_winner bold flags
      n1/n2 — games won from numeric score comparison
    """
    cols = {f"g{n}_t{s}": None for n in (1, 2, 3) for s in (1, 2)}
    w1 = w2 = 0
    n1 = n2 = 0
    for g in games:
        n = g.get("game")
        if n not in (1, 2, 3):
            continue
        s1 = (g.get("score1") or {}).get("score")
        s2 = (g.get("score2") or {}).get("score")
        cols[f"g{n}_t1"] = s1
        cols[f"g{n}_t2"] = s2
        if (g.get("score1") or {}).get("is_winner"):
            w1 += 1
        if (g.get("score2") or {}).get("is_winner"):
            w2 += 1
        if s1 is not None and s2 is not None:
            try:
                a, b = int(s1), int(s2)
            except (TypeError, ValueError):
                continue
            if a > b:
                n1 += 1
            elif b > a:
                n2 += 1
    return cols, (w1, w2, n1, n2)


def resolve_winner(match: dict, score_cols: dict, w1: int, w2: int, n1: int, n2: int):
    """Determine winner without relying solely on wiki bold markup.

    Order: team bold → per-game bold counts → games_won field → numeric sets.
    """
    if match.get("team1", {}).get("is_winner"):
        return 1
    if match.get("team2", {}).get("is_winner"):
        return 2
    if w1 != w2:
        return 1 if w1 > w2 else 2
    gw = match.get("games_won")
    if isinstance(gw, (list, tuple)) and len(gw) == 2:
        try:
            a, b = int(gw[0]), int(gw[1])
            if a != b:
                return 1 if a > b else 2
        except (TypeError, ValueError):
            pass
    if n1 != n2:
        return 1 if n1 > n2 else 2
    # Last resort: any non-null score columns imply in-progress, not finished.
    _ = score_cols
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Load BWF JSON into Supabase matches (flat pipeline schema)"
    )
    parser.add_argument(
        "--json-file",
        default="bwf_2026_results.json",
        help="Path to scraped results JSON file",
    )
    parser.add_argument(
        "--videos-file",
        default=None,
        help="Optional video_matches.json from find_youtube_videos.py; "
        "sets source_url from YouTube id when coverage is healthy",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report the diff vs the current DB and write nothing",
    )
    parser.add_argument(
        "--purge-duplicates",
        action="store_true",
        help="One-shot: collapse BWF rows that share (tournament, roster) under "
        "different ids (re-keyed orphans). Can run without --json-file load by "
        "passing --purge-duplicates alone (uses empty load path when combined "
        "with --skip-load).",
    )
    parser.add_argument(
        "--purge-duplicates-only",
        action="store_true",
        help="Only run global duplicate collapse; do not load a scrape file",
    )
    args = parser.parse_args()

    _configure_client()

    global DRY_RUN
    DRY_RUN = args.dry_run
    act = "Would upsert" if DRY_RUN else "Upserting"
    if DRY_RUN:
        print("DRY RUN — no writes will be made.\n")

    if args.purge_duplicates_only:
        print("Scanning BWF catalog for (tournament, roster) duplicate ids...")
        orphan_ids = find_global_duplicate_orphan_ids()
        print(f"  Found {len(orphan_ids)} orphan id(s) to remove")
        if orphan_ids:
            for i in orphan_ids[:12]:
                print(f"      - {i[:20]}…")
            if len(orphan_ids) > 12:
                print(f"      … and {len(orphan_ids) - 12} more")
            removed = delete_matches(orphan_ids)
            print(
                f"  {'Would purge' if DRY_RUN else 'Purged'} "
                f"{removed} re-keyed duplicate match(es)"
            )
        else:
            print("  Catalog already unique on (tournament, roster)")
        return

    here = os.path.dirname(os.path.abspath(__file__))
    resolve = lambda p: p if os.path.isabs(p) else os.path.join(here, p)

    json_path = resolve(args.json_file)
    print(f"Loading {json_path} into Supabase matches...")
    data = json.load(open(json_path))
    season = data["season"]
    # season is only used for match_key stability and dry-run messaging.

    # Optional video mapping: match_key -> video_id
    videos: dict[str, str] = {}
    if args.videos_file:
        vpath = resolve(args.videos_file)
        for v in json.load(open(vpath)):
            vid = v.get("video_id")
            if vid:
                videos[v["match_key"]] = vid
        print(f"Loaded {len(videos)} video links from {vpath}")

    match_rows = []
    unfinished_purge_keys = set()

    for t in data["tournaments"]:
        tournament = t.get("title") or t.get("page")
        for m in t["matches"]:
            discipline = m["discipline"]
            rnd = m["round"]
            score_cols, (w1, w2, n1, n2) = games_to_columns(m.get("games", []))
            # Prefer scraper-emitted match_key; recompute with leaf section if absent.
            match_key = m.get("match_key") or match_key_from_scraped(
                season, tournament, m
            )
            winner = resolve_winner(m, score_cols, w1, w2, n1, n2)

            # Persist finished matches only (same policy as the old loader).
            if winner is None:
                if not any(v is not None for v in score_cols.values()):
                    unfinished_purge_keys.add(match_key)
                continue

            t1p1, t1p2 = team_slots(m["team1"])
            t2p1, t2p2 = team_slots(m["team2"])
            # Compact catalog label; identity is the hashed match_key, not this.
            tournament_label = f"{tournament} · {discipline} · {rnd}"

            row = {
                "id": bwf_match_id(match_key),
                "_match_key": match_key,  # stripped before write
                "tournament": tournament_label,
                "match_date": to_iso_date(m.get("date"), season),
                "team1_player1": t1p1,
                "team1_player2": t1p2,
                "team2_player1": t2p1,
                "team2_player2": t2p2,
                **score_cols,
            }
            match_rows.append(row)

    # Dedup on id (collision would mean duplicate match_key).
    seen_ids = set()
    deduped = []
    for row in match_rows:
        if row["id"] in seen_ids:
            continue
        seen_ids.add(row["id"])
        deduped.append(row)
    if len(deduped) != len(match_rows):
        print(
            f"  WARNING: dropped {len(match_rows) - len(deduped)} "
            "duplicate match id rows"
        )
    match_rows = deduped

    # Video / source_url guard: scope to *this load's* ids, not global BWF count.
    # Comparing a single-season file to all-time URL counts freezes updates after
    # year rollover / multi-season history.
    apply_videos = False
    matched_now = (
        sum(1 for r in match_rows if r["_match_key"] in videos) if videos else 0
    )
    if videos:
        load_ids = [r["id"] for r in match_rows]
        existing_in_load = 0
        if load_ids:
            # PostgREST: count rows among this load that already have source_url.
            # Chunk id list to stay under URL length limits.
            chunk = 50
            for i in range(0, len(load_ids), chunk):
                part = load_ids[i : i + chunk]
                inlist = "(" + ",".join(f'"{x}"' for x in part) + ")"
                existing_in_load += count_rows(
                    "matches",
                    {
                        "owner_id": "is.null",
                        "source_url": "not.is.null",
                        "id": f"in.{inlist}",
                    },
                )
        if matched_now == 0 and existing_in_load:
            print(
                f"  ERROR: video mapping covers 0 matches in this load but "
                f"{existing_in_load} of these rows already have source_url; "
                f"skipping source_url update"
            )
            if not DRY_RUN:
                # Non-zero so CI surfaces frozen video maps (catalog upsert still runs).
                print(
                    "  (continuing catalog upsert without source_url; "
                    "fix the video map)"
                )
        elif existing_in_load and matched_now < existing_in_load * 0.5:
            print(
                f"  ERROR: source_url coverage within this load would drop "
                f"{existing_in_load}→{matched_now} (>50%); skipping source_url update"
            )
        else:
            apply_videos = True
    if apply_videos:
        for row in match_rows:
            vid = videos.get(row["_match_key"])
            url = youtube_url(vid)
            if url:
                row["source_url"] = url
        print(f"  Applying {matched_now} source_url links")

    # Build write payloads with a fixed key set (PostgREST PGRST102: every
    # object in a bulk body must share the same keys). Catalog columns only;
    # source_url is a second pass so we never send null and wipe existing URLs.
    # owner_id is always omitted so upsert never reassigns BWF rows.
    base_cols = tuple(c for c in MATCH_UPSERT_COLS if c != "source_url")
    write_rows = [{k: row[k] for k in base_cols} for row in match_rows]
    source_url_rows = [
        {"id": row["id"], "source_url": row["source_url"]}
        for row in match_rows
        if apply_videos and "source_url" in row
    ]

    print(f"{act} {len(write_rows)} matches...")
    upsert("matches", write_rows, on_conflict="id")
    if source_url_rows:
        print(f"{act} {len(source_url_rows)} source_url values...")
        upsert("matches", source_url_rows, on_conflict="id")

    # Re-key orphan purge: match_key scheme changes (section full-path → leaf,
    # roster-stable match_idx, …) mint new sha256 ids while old rows remain.
    # Drop BWF rows that share this load's (tournament, roster) under another id.
    rekey_orphan_ids = find_rekeyed_orphan_ids(write_rows)
    if rekey_orphan_ids:
        if DRY_RUN:
            print(
                f"  [dry-run] would purge {len(rekey_orphan_ids)} "
                "re-keyed duplicate match(es)"
            )
            for i in rekey_orphan_ids[:10]:
                print(f"      - {i[:20]}…")
        else:
            purged_rekey = delete_matches(rekey_orphan_ids)
            if purged_rekey:
                print(
                    f"  Purged {purged_rekey} re-keyed duplicate match(es) "
                    "(same tournament + roster, old id)"
                )
    if args.purge_duplicates:
        # Full catalog scan in addition to load-scoped rekey purge (covers
        # seasons not in this file that still carry historical double-ids).
        extra = [
            i for i in find_global_duplicate_orphan_ids()
            if i not in set(rekey_orphan_ids)
        ]
        if extra:
            if DRY_RUN:
                print(
                    f"  [dry-run] would purge {len(extra)} additional "
                    "global catalog duplicate(s)"
                )
            else:
                n = delete_matches(extra)
                print(f"  Purged {n} additional global catalog duplicate(s)")

    # Finished-only purge: keys the scrape sees as cleanly unfinished, if a
    # leftover row with that id still exists (legacy placeholders). Jobs cascade.
    purge_ids = [bwf_match_id(k) for k in unfinished_purge_keys]
    if purge_ids:
        # Only delete ids that actually exist — filter via id=in.(…) batches
        # instead of loading every BWF match id into memory.
        purge_ids = filter_existing_ids(purge_ids, select)
    if purge_ids:
        if DRY_RUN:
            print(f"  [dry-run] would purge {len(purge_ids)} unfinished match(es)")
            for i in purge_ids[:10]:
                print(f"      - {i[:16]}…")
        else:
            purged = delete_matches(purge_ids)
            if purged:
                print(f"  Purged {purged} unfinished matches from the DB")
    else:
        purged = 0

    if DRY_RUN:
        cmp_cols = [
            "tournament",
            "match_date",
            "team1_player1",
            "team1_player2",
            "team2_player1",
            "team2_player2",
            "g1_t1", "g1_t2", "g2_t1", "g2_t2", "g3_t1", "g3_t2",
        ]
        if apply_videos:
            cmp_cols.append("source_url")
        db_matches = {
            r["id"]: r
            for r in select(
                "matches",
                ",".join(["id"] + cmp_cols),
                "id",
                params={"owner_id": "is.null"},
            )
        }
        norm = lambda v: None if v is None else str(v)
        new_matches, changed = [], []
        for row in write_rows:
            db = db_matches.get(row["id"])
            if db is None:
                new_matches.append(row["id"])
                continue
            d = [c for c in cmp_cols if c in row and norm(row.get(c)) != norm(db.get(c))]
            if d:
                changed.append((row["id"], d))

        print(f"\n===== DRY RUN — diff vs current DB (season {season}) =====")
        print("Nothing was written.\n")
        print(f"  New matches:        {len(new_matches)}")
        for k in new_matches[:5]:
            print(f"      + {k[:24]}…")
        print(f"  Changed matches:    {len(changed)}")
        for k, d in changed[:5]:
            print(f"      ~ {k[:24]}…  ({', '.join(d)})")
        if videos and apply_videos:
            print(f"  source_url links:   would set/refresh {matched_now} match(es)")
        elif videos:
            print("  source_url links:   skipped by guard (see warning above)")
        print(f"  Unfinished purged:  {len(purge_ids)}")
        return

    print("\nDone!")
    print(f"  Matches upserted:   {len(write_rows)}")
    if apply_videos:
        print(f"  source_url applied: {matched_now}")


if __name__ == "__main__":
    main()
