# Match-data → Supabase

The weekly scraper loads **finished BWF matches** into the shared product table
`matches` defined by the pipeline migration
(`supabase/migrations/20260712000000_init_match_pipeline.sql`). Full column
semantics live in **[supabase/README.md](../../../supabase/README.md)**.

There is **no** separate `nations` / `players` / `match_players` graph and no
`match_key` column. Catalog identity is a content hash of the scraper's
stable key (see below). Construction is shared in `match_key.py`.

## What the loader writes

| column | source |
|--------|--------|
| `id` | `sha256(utf-8 match_key).hexdigest()` |
| `owner_id` | always omitted (NULL = system/BWF) |
| `tournament` | `"{title} · {discipline} · {round}"` |
| `match_date` | scraped date → ISO |
| `team1_player1`, `team1_player2` | roster side 1 (singles → p2 null) |
| `team2_player1`, `team2_player2` | roster side 2 |
| `g1_t1`…`g3_t2` | set scores |
| `source_url` | optional; from `video_matches.json` → `https://www.youtube.com/watch?v=…` when coverage is healthy |

Pipeline fields (`status`, `duration_sec`, `width`, `height`, `fps`) are **not**
touched — a re-scrape must not reset normalize progress.

## Internal match key (not a DB column)

```
match_key = "{season}|{tournament}|{discipline}|{section}|{round}|{match_idx}"
```

- **`section`** = **leaf** of `section_path` (last heading only), not the full
  breadcrumb — intermediate wiki heading renames must not re-key rows.
- **`match_idx`** = roster-stable `r{sha1[:10]}` from normalized player names,
  or positional `p{n}` for bye/unparseable rosters.
- Scraper emits `match_key` on each match; finder/loader reuse it.

The loader hashes this string for `matches.id` so re-scrapes hit the same row
and the same B2 prefix (`bwf/<id>/`).

**Scores are not part of the hash** (Wikipedia score corrections must not mint
a new id).

## Finished-only policy

A match is finished when a winner can be determined from, in order:

1. Team bold (`is_winner`)
2. Per-game bold flags
3. Group-stage `games_won` pair
4. Numeric set scores (games comparison)

If none apply and there are no scores, the hashed id is a purge candidate.
Winner-less matches that *do* have scores are left alone (in-progress or
flaky parse).

## Video mapping

`find_youtube_videos.py` is offline and writes `video_matches.json`
(`match_key` → YouTube id). The loader folds those into `source_url` only when
coverage is healthy **within this load's match ids** (not vs global BWF URL
count):

1. At least one of this file's matches is covered, and
2. Coverage does not drop by more than 50% vs existing `source_url` among
   **these** ids.

Otherwise existing URLs are preserved (columns omitted from the upsert).

## What this job does *not* do

- Does **not** call `matches-ingest` or enqueue GPU jobs. Catalog metadata and
  pipeline enqueue are separate (see ARCHITECTURE.md §2a).
- Does **not** write `annotation.json` or touch B2.
- Does **not** create player graph tables (removed in the match-centric schema).

## CLI

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… \
  python3 load_to_supabase.py \
    --json-file bwf_2026_results.json \
    --videos-file video_matches.json

# Local / manual: report diff only
python3 load_to_supabase.py --json-file … --videos-file … --dry-run
```

CI (`match-data.yml`) **always applies** (no `--dry-run`): PR → dev project,
master/schedule → prod.
