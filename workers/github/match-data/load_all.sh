#!/usr/bin/env bash
# Load every scraped season into Supabase, folding in matched video links.
# Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.
set -euo pipefail
cd "$(dirname "$0")"

: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?Set SUPABASE_SERVICE_KEY}"

for f in bwf_*_results.json; do
  echo "=== Loading $f ==="
  python3 load_to_supabase.py --json-file "$f" --videos-file video_matches.json
done
