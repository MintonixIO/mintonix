#!/usr/bin/env bash
# Scrape and load BWF World Tour seasons for a year range into Supabase.
#
# Defaults: 2018 (first BWF World Tour season on Wikipedia) through the
# current calendar year. Each season is written to bwf_<year>_results.json
# then upserted via load_to_supabase.py (match ids are season-scoped hashes).
#
# Scraper cache: historical loads pass --refresh so re-runs are not stuck on
# stale MediaWiki disk cache (default scraper TTL is 24h). Override with
# SCRAPER_CACHE_MODE=refresh|ttl|no-cache (default: refresh).
# Seasons that yield 0 tournaments fail (unless SCRAPER_ALLOW_EMPTY=1), including
# --skip-scrape when the existing JSON is empty.
#
# Requirements:
#   SUPABASE_URL
#   SUPABASE_SERVICE_KEY   (service role; same as load_all.sh / load_to_supabase.py)
#
# Usage:
#   export SUPABASE_URL=… SUPABASE_SERVICE_KEY=…
#   ./load_historical_years.sh                    # 2018 → current year
#   ./load_historical_years.sh --from 2020 --to 2024
#   ./load_historical_years.sh --from 2024 --to 2025 --dry-run
#   ./load_historical_years.sh --skip-scrape       # only load existing JSON
#   ./load_historical_years.sh --scrape-only       # write JSON, no DB writes
#
# Optional:
#   video_matches.json in this directory is passed to the loader when present
#   (same as load_all.sh). Historical seasons may have sparse video coverage.
#   SCRAPER_CACHE_MODE=refresh|ttl|no-cache  (default: refresh)
#   SCRAPER_ALLOW_EMPTY=1                    allow 0-tournament seasons
set -euo pipefail
cd "$(dirname "$0")"

FROM_YEAR=2018
TO_YEAR=""
SKIP_SCRAPE=0
SCRAPE_ONLY=0
DRY_RUN=0
VIDEOS_FILE="video_matches.json"
SCRAPER_CACHE_MODE="${SCRAPER_CACHE_MODE:-refresh}"
SCRAPER_ALLOW_EMPTY="${SCRAPER_ALLOW_EMPTY:-0}"

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM_YEAR="${2:?--from requires a year}"
      shift 2
      ;;
    --to)
      TO_YEAR="${2:?--to requires a year}"
      shift 2
      ;;
    --skip-scrape)
      SKIP_SCRAPE=1
      shift
      ;;
    --scrape-only)
      SCRAPE_ONLY=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --videos-file)
      VIDEOS_FILE="${2:?--videos-file requires a path}"
      shift 2
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage 1
      ;;
  esac
done

if [[ -z "$TO_YEAR" ]]; then
  TO_YEAR="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).year)')"
fi

if ! [[ "$FROM_YEAR" =~ ^[0-9]{4}$ && "$TO_YEAR" =~ ^[0-9]{4}$ ]]; then
  echo "Years must be four-digit integers (got --from $FROM_YEAR --to $TO_YEAR)" >&2
  exit 1
fi
if (( FROM_YEAR > TO_YEAR )); then
  echo "--from ($FROM_YEAR) must be <= --to ($TO_YEAR)" >&2
  exit 1
fi
if (( FROM_YEAR < 2018 )); then
  echo "Warning: BWF World Tour Wikipedia pages typically start at 2018; $FROM_YEAR may yield 0 tournaments." >&2
fi

if (( SCRAPE_ONLY == 0 )); then
  : "${SUPABASE_URL:?Set SUPABASE_URL}"
  : "${SUPABASE_SERVICE_KEY:?Set SUPABASE_SERVICE_KEY}"
fi

scraper_flags=()
case "$SCRAPER_CACHE_MODE" in
  refresh)
    scraper_flags+=(--refresh)
    ;;
  no-cache)
    scraper_flags+=(--no-cache)
    ;;
  ttl)
    # Use scraper default 24h TTL (no extra flags).
    ;;
  *)
    echo "Unknown SCRAPER_CACHE_MODE=$SCRAPER_CACHE_MODE (use refresh|ttl|no-cache)" >&2
    exit 1
    ;;
esac
if [[ "$SCRAPER_ALLOW_EMPTY" == "1" ]]; then
  scraper_flags+=(--allow-empty)
fi

echo "Historical load range: ${FROM_YEAR}–${TO_YEAR}"
echo "  skip-scrape=$SKIP_SCRAPE scrape-only=$SCRAPE_ONLY dry-run=$DRY_RUN"
echo "  scraper-cache=$SCRAPER_CACHE_MODE allow-empty=$SCRAPER_ALLOW_EMPTY"
echo

FAILED=()
LOADED=()

for year in $(seq "$FROM_YEAR" "$TO_YEAR"); do
  json="bwf_${year}_results.json"
  echo "============================================================"
  echo "Season $year"
  echo "============================================================"

  if (( SKIP_SCRAPE == 0 )); then
    echo ">>> Scraping $year …"
    set +e
    python3 scraper.py --year "$year" "${scraper_flags[@]+"${scraper_flags[@]}"}"
    scrape_ec=$?
    set -e
    if (( scrape_ec != 0 )); then
      echo "ERROR: scrape failed for $year (exit code $scrape_ec — empty season or network/parse error)" >&2
      FAILED+=("$year:scrape")
      continue
    fi
  elif [[ ! -f "$json" ]]; then
    echo "ERROR: --skip-scrape set but $json is missing" >&2
    FAILED+=("$year:missing-json")
    continue
  else
    echo ">>> Using existing $json"
  fi

  if [[ ! -f "$json" ]]; then
    echo "ERROR: expected $json after scrape" >&2
    FAILED+=("$year:no-json")
    continue
  fi

  # Empty-season defense on every path (scrape + --skip-scrape).
  if [[ "$SCRAPER_ALLOW_EMPTY" != "1" ]]; then
    tcount="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get('tournaments') or []))" "$json")"
    if [[ "$tcount" == "0" ]]; then
      echo "ERROR: $json has 0 tournaments" >&2
      FAILED+=("$year:empty")
      continue
    fi
  fi

  if (( SCRAPE_ONLY == 1 )); then
    echo ">>> Scrape-only: skipping Supabase load for $year"
    LOADED+=("$year:scraped")
    continue
  fi

  load_args=(--json-file "$json")
  if [[ -f "$VIDEOS_FILE" ]]; then
    load_args+=(--videos-file "$VIDEOS_FILE")
  fi
  if (( DRY_RUN == 1 )); then
    load_args+=(--dry-run)
  fi

  echo ">>> Loading $json into Supabase …"
  if python3 load_to_supabase.py "${load_args[@]}"; then
    LOADED+=("$year:loaded")
  else
    echo "ERROR: load failed for $year" >&2
    FAILED+=("$year:load")
  fi
  echo
done

echo "============================================================"
echo "Historical load summary"
echo "============================================================"
echo "  range:   ${FROM_YEAR}–${TO_YEAR}"
echo "  ok:      ${#LOADED[@]}  (${LOADED[*]:-none})"
echo "  failed:  ${#FAILED[@]}  (${FAILED[*]:-none})"

if (( ${#FAILED[@]} > 0 )); then
  exit 1
fi
