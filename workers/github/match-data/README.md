# match-data (GitHub / BWF catalog scraper)

Weekly **catalog** worker: scrape BWF World Tour results, optionally attach
YouTube coverage, and upsert finished matches into Supabase `matches`.

This path is **metadata only**. It does **not** call `matches-ingest`, does not
enqueue GPU jobs, and does not touch B2. Pipeline enqueue is a separate step
(ops / screen_ingest / product flow) — see root
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md).

| | |
|---|---|
| **Runtime** | Python 3 on GitHub Actions (or local) |
| **Writes** | Supabase `matches` via service role (PostgREST) |
| **Does not write** | `jobs`, pgmq, B2 |
| **Identity** | `matches.id = sha256(match_key)` so re-scrapes upsert |

## Pipeline role

```
Wikipedia / MediaWiki  →  scraper.py  →  bwf_<year>_results.json
YouTube search         →  find_youtube_videos.py  →  video_matches.json
                           load_to_supabase.py  →  matches rows (owner_id NULL = BWF)
```

After rows exist, operators (or product tooling) enqueue normalize via the
ingest/ops path when a `source_url` or B2 original is ready.

## Scripts

| Script | Role |
|--------|------|
| `scraper.py` | Current-season BWF World Tour scrape → `bwf_<year>_results.json` |
| `find_youtube_videos.py` | Map matches → YouTube ids → `video_matches.json` |
| `load_to_supabase.py` | Upsert finished matches; fold in video links when healthy |
| `load_all.sh` | Loop all `bwf_*_results.json` through the loader |
| `match_key.py` | Stable key construction + `bwf_match_id` hash (shared) |
| `rekey_match_idx.py` | Maintenance: recompute key / idx if policy changes |
| `fetch_bwf_videos.py` | Related video helper (see script docstring) |

Loader column mapping and finished-only policy:
[`schema.md`](schema.md). Full Postgres shape:
[`supabase/README.md`](../../../supabase/README.md).

## Environment

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_SERVICE_KEY="<service_role key>"   # never ship to clients
```

Optional: install deps from `requirements.txt`.

## Local usage

```bash
cd workers/github/match-data

# 1) Scrape current season
python3 scraper.py

# 2) Optional: find YouTube coverage
python3 find_youtube_videos.py   # see script flags / inputs

# 3) Dry-run then load
python3 load_to_supabase.py \
  --json-file bwf_2026_results.json \
  --videos-file video_matches.json \
  --dry-run

python3 load_to_supabase.py \
  --json-file bwf_2026_results.json \
  --videos-file video_matches.json

# Collapse re-keyed catalog duplicates (same tournament + roster, old id)
python3 load_to_supabase.py --purge-duplicates-only --dry-run
python3 load_to_supabase.py --purge-duplicates-only

# Or every season file present:
./load_all.sh
```

## Match identity (not a DB column)

```
match_key = "{season}|{tournament}|{discipline}|{section}|{round}|{match_idx}"
matches.id = sha256(utf-8 match_key).hexdigest()
```

- **Scores are not in the hash** — Wikipedia score edits must not mint a new id.
- **Section** is the leaf heading only (stable against breadcrumb renames).
- B2 prefix for catalog video later: `bwf/<matches.id>/`.

## Design rules

1. **Finished-only** — do not insert open brackets as product rows (see `schema.md`).
2. **Catalog upsert only** — never reset `status` / probe fields owned by the GPU pipeline.
3. **Degraded video maps do not wipe** existing `source_url` values.
4. **Service role only** on the loader — bypasses RLS by design.

## See also

- [`schema.md`](schema.md) — column map + finished policy
- [`supabase/README.md`](../../../supabase/README.md) — `matches` / RPCs
- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — ingest vs enqueue split
- [`workers/cloudflare/cdn`](../../cloudflare/cdn/README.md) — storage delivery (not used by this worker)
- [`workers/vast/video-normalization`](../../vast/video-normalization/README.md) — first GPU stage after enqueue
