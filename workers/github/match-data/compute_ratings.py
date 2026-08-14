#!/usr/bin/env python3
"""Fetch BWF matches from Supabase, compute form ratings, upsert results.

Run after the catalog load in match-data.yml. Service role only.

    SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python3 compute_ratings.py
    python3 compute_ratings.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import requests

import ratings

SELECT = (
    "tournament,match_date,"
    "team1_player1,team1_player2,team2_player1,team2_player2,"
    "team1_player1_country,team1_player2_country,"
    "team2_player1_country,team2_player2_country,"
    "g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2"
)
SELECT_NO_COUNTRY = (
    "tournament,match_date,"
    "team1_player1,team1_player2,team2_player1,team2_player2,"
    "g1_t1,g1_t2,g2_t1,g2_t2,g3_t1,g3_t2"
)


def _client() -> tuple[str, dict]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    return url, headers


def fetch_matches(url: str, headers: dict) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    select = SELECT
    while True:
        r = requests.get(
            f"{url}/rest/v1/matches",
            headers=headers,
            params={
                "select": select,
                "owner_id": "is.null",
                "order": "id",
                "limit": 1000,
                "offset": offset,
            },
            timeout=60,
        )
        if r.status_code == 400 and select == SELECT and "country" in (r.text or ""):
            # Migration not applied yet — degrade to name-only identity.
            print("  country columns missing; fetching without them", file=sys.stderr)
            select = SELECT_NO_COUNTRY
            rows = []
            offset = 0
            continue
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        offset += 1000
    return rows


def upsert(url: str, headers: dict, table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        return 0
    total = 0
    hdrs = {**headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
    for i in range(0, len(rows), 500):
        batch = rows[i : i + 500]
        for attempt in range(6):
            r = requests.post(
                f"{url}/rest/v1/{table}",
                headers=hdrs,
                params={"on_conflict": on_conflict},
                json=batch,
                timeout=60,
            )
            if r.status_code in (200, 201, 204):
                total += len(batch)
                break
            if r.status_code in (429, 500, 502, 503) and attempt < 5:
                time.sleep(2 ** attempt)
                continue
            print(f"  {table}: {r.status_code} {r.text[:300]}", file=sys.stderr)
            r.raise_for_status()
    return total


def replace_table(url: str, headers: dict, table: str, rows: list[dict], on_conflict: str) -> int:
    """Full refresh: delete all rows then upsert the new board.

    Ratings are a derived snapshot of the whole catalog, not a per-match
    incremental write. A leftover entity that dropped below the match floor
    must disappear.
    """
    for attempt in range(6):
        r = requests.delete(
            f"{url}/rest/v1/{table}",
            headers={**headers, "Prefer": "return=minimal"},
            params={"entity_key": "not.is.null"},
            timeout=60,
        )
        if r.status_code in (200, 204):
            break
        if r.status_code in (429, 500, 502, 503) and attempt < 5:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
    return upsert(url, headers, table, rows, on_conflict)


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Compute BWF form ratings into Supabase")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    url, headers = _client()
    print("Fetching BWF matches…")
    raw = fetch_matches(url, headers)
    print(f"  {len(raw)} rows")

    result = ratings.compute_ratings(raw)
    print(
        f"  clean={result.clean_count} dropped={result.dropped} "
        f"glicko={len(result.glicko)} individuals={len(result.individuals)}"
    )

    glicko_rows = [
        {
            "discipline": r.discipline,
            "kind": r.kind,
            "entity_key": r.entity_key,
            "display_name": r.display_name,
            "country": r.country,
            "mu": round(r.mu, 4),
            "rd": round(r.rd, 4),
            "sigma": round(r.sigma, 6),
            "peak_mu": round(r.peak_mu, 4),
            "peak_rd": round(r.peak_rd, 4),
            "rank_score": round(r.rank_score, 4),
            "matches": r.matches,
            "wins": r.wins,
            "losses": r.losses,
            "last_day": r.last_day,
            "web_id": r.web_id,
        }
        for r in result.glicko
    ]
    ind_rows = [
        {
            "discipline": r.discipline,
            "entity_key": r.entity_key,
            "display_name": r.display_name,
            "country": r.country,
            "mu": round(r.mu, 4),
            "sigma": round(r.sigma, 6),
            "exposure": round(r.exposure, 4),
            "matches": r.matches,
            "web_id": r.web_id,
        }
        for r in result.individuals
    ]

    if args.dry_run:
        print("DRY RUN — not writing")
        tops = sorted(result.glicko, key=lambda r: -r.rank_score)[:8]
        for r in tops:
            print(f"  {r.discipline} {r.kind:6} {r.display_name:28} μ={r.mu:.1f} RS={r.rank_score:.1f}")
        return

    n1 = replace_table(
        url, headers, "player_ratings", glicko_rows,
        "discipline,kind,entity_key",
    )
    n2 = replace_table(
        url, headers, "rating_individuals", ind_rows, "discipline,entity_key",
    )
    upsert(
        url,
        headers,
        "rating_runs",
        [
            {
                "match_count": len(raw),
                "clean_count": result.clean_count,
                "entity_count": len(glicko_rows) + len(ind_rows),
                "notes": f"glicko={n1} individuals={n2}",
            }
        ],
        "id",
    )
    print(f"Wrote {n1} player_ratings, {n2} rating_individuals")


if __name__ == "__main__":
    main()
