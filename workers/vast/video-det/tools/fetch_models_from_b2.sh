#!/usr/bin/env bash
# Deprecated name — use fetch_models.sh (CDN delivery via Supabase ops/model-urls).
# Kept so older docs/CI snippets keep working.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "fetch_models_from_b2.sh: redirecting to fetch_models.sh (CDN delivery)" >&2
exec bash "$ROOT/fetch_models.sh" "$@"
