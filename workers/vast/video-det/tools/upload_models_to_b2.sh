#!/usr/bin/env bash
# Upload a directory of product detect weights to B2 and print MANIFEST fields.
#
# Usage:
#   export B2_*  (same as fetch_models_from_b2.sh)
#   export MODEL_VERSION=2026-08-11-fp16   # optional; default from MANIFEST or date
#   bash tools/upload_models_to_b2.sh /path/to/dir/with/engines
#
# Uploads to s3://$B2_BUCKET/models/video-det/$MODEL_VERSION/
# Prints sha256/bytes for pasting into models/MANIFEST.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT}/models/MANIFEST.json"
AWS_CLI="${AWS_CLI:-aws}"
SRC="${1:-}"

die() { echo "upload_models: ERROR: $*" >&2; exit 1; }
[[ -n "$SRC" && -d "$SRC" ]] || die "usage: $0 /path/to/model/dir"
[[ -f "$MANIFEST" ]] || die "missing $MANIFEST"

for v in B2_S3_ENDPOINT B2_REGION B2_BUCKET B2_ACCESS_KEY_ID B2_SECRET_ACCESS_KEY; do
  [[ -n "${!v:-}" ]] || die "$v is not set"
done

export AWS_ACCESS_KEY_ID="$B2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$B2_REGION"
unset AWS_SESSION_TOKEN || true

VERSION="${MODEL_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(python3 - <<'PY' "$MANIFEST"
import json, sys
m = json.load(open(sys.argv[1]))
print(m.get("version") or "")
PY
)"
fi
[[ -n "$VERSION" ]] || VERSION="$(date -u +%Y-%m-%d)"
PREFIX="models/video-det/${VERSION}"

mapfile -t FILES < <(python3 - <<'PY' "$MANIFEST"
import json, sys
m = json.load(open(sys.argv[1]))
for f in m["files"]:
    print(f["name"])
PY
)

echo "upload_models: ${SRC} → s3://${B2_BUCKET}/${PREFIX}/"
echo "--- MANIFEST snippets (paste into models/MANIFEST.json) ---"
echo "  \"version\": \"${VERSION}\","
echo "  \"b2_prefix\": \"${PREFIX}\","
echo "  \"files\": ["

first=1
for name in "${FILES[@]}"; do
  src_file="${SRC}/${name}"
  [[ -f "$src_file" ]] || die "required file missing: $src_file"
  sha="$(python3 - <<'PY' "$src_file"
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], "rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
print(h.hexdigest())
PY
)"
  bytes="$(wc -c <"$src_file" | tr -d ' ')"
  echo "upload_models: PUT ${name} (${bytes} bytes)"
  "$AWS_CLI" s3 cp \
    "$src_file" \
    "s3://${B2_BUCKET}/${PREFIX}/${name}" \
    --endpoint-url "$B2_S3_ENDPOINT" \
    --only-show-errors
  [[ $first -eq 1 ]] || echo "    ,"
  first=0
  cat <<EOF
    {
      "name": "${name}",
      "sha256": "${sha}",
      "bytes": ${bytes}
    }
EOF
done
echo "  ]"
echo "upload_models: DONE  prefix=${PREFIX}"
