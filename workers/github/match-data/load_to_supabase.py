#!/usr/bin/env python3
"""
Loads BWF scraped JSON into Supabase via the PostgREST API.

Target schema: see schema.md (nations, players, matches, match_players).
All writes are idempotent upserts keyed on a natural unique column, so
re-running never duplicates rows.

Usage:
    SUPABASE_URL=https://yourproject.supabase.co \
    SUPABASE_SERVICE_KEY=your-service-role-key \
    python3 load_to_supabase.py --json-file bwf_2026_results.json

The service role key bypasses RLS — never expose it to the frontend.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import date

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# When True, every write primitive is a no-op: main() becomes a read-only pass
# that reports what *would* change. Set from --dry-run in main(). Guarding the
# two write seams (the POST below and the DELETE in reconcile) is what makes it
# structurally impossible for a dry run to mutate the DB.
DRY_RUN = False


def upsert(table, rows, on_conflict, batch_size=500):
    """Upsert rows in batches, retrying on rate-limit / server errors.

    `on_conflict` names the unique column(s) PostgREST resolves duplicates on.
    Only the columns present in each row are written, so columns omitted here
    (e.g. avatar_url, flag_url) keep any value backfilled out-of-band.
    """
    if not rows:
        return 0
    if DRY_RUN:
        return 0  # read-only: caller computes the diff separately
    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}
    params = {"on_conflict": on_conflict}
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
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
    """Fetch all rows with pagination. `params` adds PostgREST filters (e.g.
    {"season": "eq.2026"})."""
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


def reconcile_match_players(mp_rows, scope_mids, id_to_key=None):
    """Delete match_players that exist in the DB but not in `mp_rows`.

    `mp_rows` is the authoritative link set for the matches in the current load.
    Reconciliation is restricted to `scope_mids` — the match_ids whose roster
    came back complete this run — so a transient parse/lookup gap that drops a
    player from an otherwise-loaded match can never delete that player's correct
    link. `auth` is still built from the full `mp_rows` so a trusted match's
    surviving pairs are recognised. Returns the number of stale links removed.
    """
    if not mp_rows or not scope_mids:
        return 0
    auth = {(r["match_id"], r["player_id"]) for r in mp_rows}
    mids = sorted(scope_mids)
    # current links for the loaded matches
    existing = []
    for i in range(0, len(mids), 200):
        inlist = "(" + ",".join(str(m) for m in mids[i : i + 200]) + ")"
        offset = 0
        while True:
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/match_players",
                headers=HEADERS,
                params={"select": "match_id,player_id", "match_id": f"in.{inlist}",
                        "limit": 1000, "offset": offset},
                timeout=60,
            )
            r.raise_for_status()
            chunk = r.json()
            existing.extend(chunk)
            if len(chunk) < 1000:
                break
            offset += 1000
    stale = {}
    for row in existing:
        pair = (row["match_id"], row["player_id"])
        if pair not in auth:
            stale.setdefault(row["match_id"], []).append(row["player_id"])
    if DRY_RUN:
        total = sum(len(p) for p in stale.values())
        if total:
            print(f"  [dry-run] would remove {total} stale match_players "
                  f"across {len(stale)} match(es):")
            for mid, pids in list(stale.items())[:10]:
                label = (id_to_key or {}).get(mid, f"match_id={mid}")
                print(f"      - {label}: {len(pids)} link(s)")
        return total
    removed = 0
    for mid, pids in stale.items():
        inlist = "(" + ",".join(str(p) for p in pids) + ")"
        for attempt in range(6):
            r = requests.delete(
                f"{SUPABASE_URL}/rest/v1/match_players",
                headers={**HEADERS, "Prefer": "return=minimal"},
                params={"match_id": f"eq.{mid}", "player_id": f"in.{inlist}"},
                timeout=60,
            )
            if r.status_code in (200, 204):
                removed += len(pids)
                break
            if r.status_code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
    return removed


def delete_matches(mids, batch_size=100):
    """Delete match rows by id; match_players follow via ON DELETE CASCADE.

    Used by the finished-only purge to remove matches the current scrape sees as
    cleanly unfinished (no winner, no scores). Returns the number deleted.
    """
    if not mids:
        return 0
    removed = 0
    for i in range(0, len(mids), batch_size):
        batch = mids[i : i + batch_size]
        inlist = "(" + ",".join(str(m) for m in batch) + ")"
        for attempt in range(6):
            r = requests.delete(
                f"{SUPABASE_URL}/rest/v1/matches",
                headers={**HEADERS, "Prefer": "return=minimal"},
                params={"id": f"in.{inlist}"},
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


def player_name(p):
    """Canonical, dedup-stable name: wiki page title when present, else display."""
    return (p.get("wiki_name") or p.get("display_name") or "").strip()


_MONTHS = {m.lower(): i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def to_iso_date(raw, season):
    """Normalize a scraped date to ISO 'YYYY-MM-DD' for the date column.

    Accepts a date already in ISO form (newer scraper output) and passes it
    through; converts a yearless wikitable date ('17 Dec', from older scraped
    JSON) using the season year so it isn't silently bound to the load year.
    Returns None if absent or unparseable.
    """
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

    Returns (cols, games_won, (w1, w2)) where w1/w2 are games won per side,
    so the caller can fall back to game counts when the markup didn't bold a
    winner on the team field itself.
    """
    cols = {f"g{n}_t{s}": None for n in (1, 2, 3) for s in (1, 2)}
    w1 = w2 = 0
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
    games_won = f"{w1}–{w2}" if (w1 or w2) else None
    return cols, games_won, (w1, w2)


def main():
    parser = argparse.ArgumentParser(description="Load BWF JSON into Supabase")
    parser.add_argument("--json-file", default="bwf_2026_results.json",
                        help="Path to scraped results JSON file")
    parser.add_argument("--videos-file", default=None,
                        help="Optional video_matches.json from find_youtube_videos.py; "
                             "folds video columns onto matches by match_key")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report the diff vs the current DB and write nothing")
    args = parser.parse_args()

    global DRY_RUN
    DRY_RUN = args.dry_run
    act = "Would upsert" if DRY_RUN else "Upserting"
    if DRY_RUN:
        print("DRY RUN — no writes will be made.\n")

    here = os.path.dirname(os.path.abspath(__file__))
    resolve = lambda p: p if os.path.isabs(p) else os.path.join(here, p)

    json_path = resolve(args.json_file)
    print(f"Loading {json_path} into Supabase...")
    data = json.load(open(json_path))
    season = data["season"]
    scraped_at = data["scraped_at"]

    # Optional video mapping: match_key -> {video_id, video_title, confidence}
    videos = {}
    if args.videos_file:
        vpath = resolve(args.videos_file)
        for v in json.load(open(vpath)):
            videos[v["match_key"]] = {
                "video_id": v.get("video_id"),
                "video_title": v.get("video_title"),
                "video_confidence": v.get("confidence"),
            }
        print(f"Loaded {len(videos)} video links from {vpath}")

    # --- 1. Collect nations, players, matches, links from the JSON ---
    nations = {}          # code -> {"code", "name"}
    players = {}          # name -> {"name", "country"}
    match_rows = []       # match dicts
    links = []            # {"_match_key", "name", "team_side"}
    incomplete_keys = set()  # match_keys whose roster came back partial this run
    unfinished_purge_keys = set()  # finished-only: cleanly-unfinished keys to purge

    for t in data["tournaments"]:
        tournament = t.get("title") or t.get("page")
        for m in t["matches"]:
            discipline = m["discipline"]
            rnd = m["round"]
            match_idx = m.get("match_idx", 0)
            # section_path distinguishes matches in split draws (Top half /
            # Section 1, ...), where match_idx restarts within each section.
            # Without it the key collides ~4x and isn't unique. See schema.md.
            section = "/".join(m.get("section_path") or [])
            match_key = f"{season}|{tournament}|{discipline}|{section}|{rnd}|{match_idx}"

            score_cols, games_won, (w1, w2) = games_to_columns(m.get("games", []))
            winner = 1 if m["team1"].get("is_winner") else (2 if m["team2"].get("is_winner") else None)
            # Group-stage rows bold only the score column, not the team field, so
            # fall back to the per-game win counts when neither team is flagged.
            if winner is None and w1 != w2:
                winner = 1 if w1 > w2 else 2

            # Persist finished matches only. A match with no determined winner is
            # an unplayed draw slot (TBD/placeholder roster → 'p' idx) or a not-
            # yet-played fixture; skip it entirely — no match row, no player links.
            # If it also carries no game scores it's *cleanly* unfinished, so flag
            # the key to purge any stale copy already in the DB (below). A winner-
            # less match that DOES have scores is in-progress, or a transient
            # winner-parse gap on a real result — we neither insert nor purge it,
            # so a genuinely finished row is never deleted on a flaky parse.
            if winner is None:
                if not any(v is not None for v in score_cols.values()):
                    unfinished_purge_keys.add(match_key)
                continue

            row = {
                "match_key": match_key,
                "season": season,
                "tournament": tournament,
                "discipline": discipline,
                "section": section,
                "round": rnd,
                "match_idx": match_idx,
                "match_date": to_iso_date(m.get("date"), season),
                "team1_seed": m.get("seed1"),
                "team2_seed": m.get("seed2"),
                "winner": winner,
                "games_won": games_won,
                "scraped_at": scraped_at,
                # Video columns are applied later (see apply_videos) so a missing
                # or degraded mapping can't wipe existing links; omitting them
                # here preserves the DB value, like flag_url / avatar_url.
                **score_cols,
            }
            match_rows.append(row)

            for side, team_key in ((1, "team1"), (2, "team2")):
                for p in m[team_key]["players"]:
                    name = player_name(p)
                    if not name:
                        # A blank player name means the roster didn't fully parse;
                        # don't let reconcile treat this match as authoritative.
                        incomplete_keys.add(match_key)
                        continue
                    country = (p.get("country") or None)
                    if country and country not in nations:
                        nations[country] = {"code": country, "name": country}
                    if name not in players:
                        players[name] = {"name": name, "country": country}
                    links.append({"_match_key": match_key, "name": name, "team_side": side})

    # --- 2. Upsert nations (omit flag_url to preserve backfills) ---
    print(f"{act} {len(nations)} nations...")
    upsert("nations", list(nations.values()), on_conflict="code")

    # --- 3. Upsert players (omit avatar_url to preserve backfills) ---
    print(f"{act} {len(players)} players...")
    upsert("players", list(players.values()), on_conflict="name")
    p_map = {r["name"]: r["id"] for r in select("players", "id,name", "id")}

    # --- 4. Upsert matches (dedup on match_key so a single batch never
    #        carries the same conflict target twice) ---
    seen_keys = set()
    deduped = []
    for row in match_rows:
        if row["match_key"] in seen_keys:
            continue
        seen_keys.add(row["match_key"])
        deduped.append(row)
    if len(deduped) != len(match_rows):
        print(f"  WARNING: dropped {len(match_rows) - len(deduped)} duplicate match_key rows")
    match_rows = deduped

    # Decide whether to (re)apply video columns. Omitting them — like flag_url /
    # avatar_url — preserves whatever's already in the DB, so a missing or
    # degraded video mapping can never wipe existing links. We only apply when a
    # mapping is present, covers at least one of this season's matches, and isn't
    # a drastic shrink versus what's already stored (a sign of a degraded fetch).
    apply_videos = False
    matched_now = sum(1 for r in match_rows if r["match_key"] in videos) if videos else 0
    if videos:
        existing_videos = count_rows("matches",
                                     {"season": f"eq.{season}", "video_id": "not.is.null"})
        if matched_now == 0 and existing_videos:
            print(f"  WARNING: video mapping covers 0 of {season}'s matches but DB has "
                  f"{existing_videos}; skipping video update to avoid wiping links")
        elif existing_videos and matched_now < existing_videos * 0.5:
            print(f"  WARNING: video coverage would drop {existing_videos}→{matched_now} "
                  f"(>50%); skipping video update to avoid wiping links")
        else:
            apply_videos = True
    if apply_videos:
        for row in match_rows:
            v = videos.get(row["match_key"])
            row["video_id"] = v["video_id"] if v else None
            row["video_title"] = v["video_title"] if v else None
            row["video_confidence"] = v["video_confidence"] if v else None
        print(f"  Applying {matched_now} video links")

    print(f"{act} {len(match_rows)} matches...")
    upsert("matches", match_rows, on_conflict="match_key")
    db_matches_rows = select("matches", "id,match_key,winner", "id")
    m_map = {r["match_key"]: r["id"] for r in db_matches_rows}
    # Keys whose DB row is itself resultless — the only rows the purge may delete.
    db_unfinished_keys = {r["match_key"] for r in db_matches_rows if r["winner"] is None}

    # --- 5. Upsert match_players (dedup on match_id+player_id) ---
    mp_seen = set()
    mp_rows = []
    for link in links:
        mid = m_map.get(link["_match_key"])
        pid = p_map.get(link["name"])
        if not mid or not pid:
            # Player resolved to no id (upsert/lookup miss): the match's roster is
            # incomplete this run, so don't let reconcile delete its other links.
            if mid and not pid:
                incomplete_keys.add(link["_match_key"])
            continue
        key = (mid, pid)
        if key in mp_seen:
            continue
        mp_seen.add(key)
        mp_rows.append({"match_id": mid, "player_id": pid, "team_side": link["team_side"]})

    print(f"{act} {len(mp_rows)} match_players...")
    upsert("match_players", mp_rows, on_conflict="match_id,player_id")

    # Reconcile: drop links that are no longer in the source for the matches we
    # just loaded, so a corrected roster (or a re-keyed match) doesn't leave
    # stale players attached. Bounded to this file's matches whose roster parsed
    # completely — matches with a partial roster this run are skipped so a
    # transient gap can't delete correct links. A no-op when rosters are unchanged.
    incomplete_mids = {m_map[k] for k in incomplete_keys if k in m_map}
    scope_mids = {r["match_id"] for r in mp_rows} - incomplete_mids
    if incomplete_mids:
        print(f"  Skipping reconcile for {len(incomplete_mids)} matches with partial rosters")
    id_to_key = {v: k for k, v in m_map.items()} if DRY_RUN else None
    stale = reconcile_match_players(mp_rows, scope_mids, id_to_key)
    if stale and not DRY_RUN:
        print(f"  Reconciled: removed {stale} stale match_players")

    # Finished-only purge: drop matches the DB still holds that *both* this scrape
    # and the DB agree are resultless (no winner, no scores). Clears legacy
    # placeholder rows and draws loaded before a result existed. Requiring the DB
    # row to also be winner-null — like reconcile's paranoia about transient gaps —
    # means a genuinely finished row whose markup flakes to no-result this run is
    # never deleted; that case is left for manual cleanup. match_players follow via
    # ON DELETE CASCADE. In steady state the filter prevents new unfinished inserts,
    # so this is a no-op once the DB is clean.
    purge_mids = {m_map[k]: k for k in unfinished_purge_keys
                  if k in m_map and k in db_unfinished_keys}
    if DRY_RUN:
        purged = len(purge_mids)
        if purged:
            print(f"  [dry-run] would purge {purged} unfinished match(es) from the DB:")
            for k in list(purge_mids.values())[:10]:
                print(f"      - {k}")
    else:
        purged = delete_matches(list(purge_mids.keys()))
        if purged:
            print(f"  Purged {purged} unfinished matches from the DB")

    if DRY_RUN:
        # New entities fall out of the pre-write maps/selects: a collected key
        # absent from p_map / m_map (built from a read of the un-mutated DB) is
        # new. For keys already present, compare the writable columns to count
        # field-level changes. scraped_at is excluded — it changes every run.
        existing_codes = {r["code"] for r in select("nations", "code", "code")}
        new_nations = [c for c in nations if c not in existing_codes]
        new_players = [n for n in players if n not in p_map]

        score_keys = [f"g{n}_t{s}" for n in (1, 2, 3) for s in (1, 2)]
        cmp_cols = ["match_date", "team1_seed", "team2_seed", "winner",
                    "games_won"] + score_keys
        if apply_videos:
            cmp_cols += ["video_id", "video_title", "video_confidence"]
        db_matches = {r["match_key"]: r for r in select(
            "matches", ",".join(["match_key"] + cmp_cols), "id",
            params={"season": f"eq.{season}"})}
        norm = lambda v: None if v is None else str(v)
        new_matches, changed = [], []
        for row in match_rows:
            db = db_matches.get(row["match_key"])
            if db is None:
                new_matches.append(row["match_key"])
                continue
            d = [c for c in cmp_cols if norm(row.get(c)) != norm(db.get(c))]
            if d:
                changed.append((row["match_key"], d))

        print(f"\n===== DRY RUN — diff vs current DB (season {season}) =====")
        print("Nothing was written.\n")
        print(f"  New matches:        {len(new_matches)}")
        for k in new_matches[:5]:
            print(f"      + {k}")
        print(f"  Changed matches:    {len(changed)}")
        for k, d in changed[:5]:
            print(f"      ~ {k}  ({', '.join(d)})")
        print(f"  New players:        {len(new_players)}")
        print(f"  New nations:        {len(new_nations)}")
        if videos and apply_videos:
            print(f"  Video links:        would set/refresh {matched_now} match(es)")
        elif videos:
            print(f"  Video links:        skipped by guard (see warning above)")
        print(f"  Stale links removed:{stale}  (detail above, if any)")
        print(f"  Unfinished purged:  {purged}  (detail above, if any)")
        return

    print("\nDone!")
    print(f"  Nations:            {len(nations)}")
    print(f"  Players:            {len(players)}")
    print(f"  Matches:            {len(match_rows)}")
    print(f"  Match-Player links: {len(mp_rows)}")


if __name__ == "__main__":
    main()
