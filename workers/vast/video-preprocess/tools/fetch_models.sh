#!/usr/bin/env bash
# Download product detect weights into ./models/ via CDN delivery URLs.
#
# Flow (Bandwidth Alliance free egress):
#   1. POST Supabase ops/model-urls (pipeline token) → short-lived CDN URLs
#   2. GET each URL through Cloudflare data plane (B2 → CF free, edge-cached)
#   3. Verify optional sha256/bytes from models/MANIFEST.json
#
# Required env (CI naming matches match-data / GitHub Environments):
#   SUPABASE_URL              e.g. https://xxxx.supabase.co
#     — or SUPABASE_PROJECT_REF (URL becomes https://<ref>.supabase.co)
#   SUPABASE_SERVICE_KEY      service role key; sent as x-pipeline-token
#     — edge PIPELINE_SERVICE_TOKEN must be set to this same value
#     — PIPELINE_SERVICE_TOKEN still accepted as a local alias
#
# Optional:
#   MODEL_DIR                 default: <worker>/models
#   MODELS_URL_PATH           default: /functions/v1/ops/model-urls
#   CURL_MAX_TIME             default: 600 (per file)
#
# Does NOT use B2 credentials (those stay on the CDN worker only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="${MODEL_DIR:-$ROOT/models}"
MANIFEST="${MODEL_DIR}/MANIFEST.json"
MODELS_URL_PATH="${MODELS_URL_PATH:-/functions/v1/ops/model-urls}"
CURL_MAX_TIME="${CURL_MAX_TIME:-600}"

die() { echo "fetch_models: ERROR: $*" >&2; exit 1; }

[[ -f "$MANIFEST" ]] || die "missing $MANIFEST"

if [[ -z "${SUPABASE_URL:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
fi
[[ -n "${SUPABASE_URL:-}" ]] || die "SUPABASE_URL (or SUPABASE_PROJECT_REF) is not set"

# Prefer the GitHub/env name used across Mintonix CI; keep pipeline token alias.
PIPELINE_AUTH_TOKEN="${SUPABASE_SERVICE_KEY:-${PIPELINE_SERVICE_TOKEN:-}}"
[[ -n "${PIPELINE_AUTH_TOKEN}" ]] || die "SUPABASE_SERVICE_KEY (or PIPELINE_SERVICE_TOKEN) is not set"

command -v curl >/dev/null || die "curl required"
command -v python3 >/dev/null || die "python3 required"

BASE="${SUPABASE_URL%/}"
ENDPOINT="${BASE}${MODELS_URL_PATH}"

# Build full B2/CDN keys from MANIFEST b2_prefix + file names.
mapfile -t KEYS < <(python3 - <<'PY' "$MANIFEST"
import json, sys
m = json.load(open(sys.argv[1]))
prefix = m["b2_prefix"].strip("/")
for f in m["files"]:
    print(f"{prefix}/{f['name']}")
PY
)
[[ ${#KEYS[@]} -gt 0 ]] || die "MANIFEST has no files"

echo "fetch_models: minting ${#KEYS[@]} CDN delivery URL(s) via $ENDPOINT"

KEYS_JSON="$(python3 -c 'import json,sys; print(json.dumps({"keys": sys.argv[1:]}))' "${KEYS[@]}")"
MINT_RESP="$(curl -sS -f -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-pipeline-token: ${PIPELINE_AUTH_TOKEN}" \
  -d "$KEYS_JSON")" || die "ops/model-urls request failed"

# Parse urls map → download each file.
mkdir -p "$MODEL_DIR"
python3 - <<'PY' "$MINT_RESP" "$MODEL_DIR" "$MANIFEST" "$CURL_MAX_TIME"
import hashlib, json, os, subprocess, sys
from pathlib import Path

mint = json.loads(sys.argv[1])
model_dir = Path(sys.argv[2])
manifest = json.load(open(sys.argv[3]))
max_time = sys.argv[4]
urls = mint.get("urls") or {}
if not urls:
    print("fetch_models: empty urls in response:", mint, file=sys.stderr)
    sys.exit(1)

prefix = manifest["b2_prefix"].strip("/")
name_by_key = {f"{prefix}/{f['name']}": f for f in manifest["files"]}

for key, url in urls.items():
    entry = name_by_key.get(key)
    if not entry:
        print(f"fetch_models: unexpected key {key}", file=sys.stderr)
        sys.exit(1)
    dest = model_dir / entry["name"]
    print(f"fetch_models: GET {key} → {dest.name}")
    # Follow redirects only if CDN ever issues them; view tokens are on the URL.
    r = subprocess.run(
        [
            "curl", "-fsSL",
            "--max-time", max_time,
            "-o", str(dest),
            url,
        ],
        check=False,
    )
    if r.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
        print(f"fetch_models: download failed for {entry['name']}", file=sys.stderr)
        sys.exit(1)

errors = []
for entry in manifest["files"]:
    path = model_dir / entry["name"]
    if not path.is_file():
        errors.append(f"missing {path.name}")
        continue
    size = path.stat().st_size
    expect_bytes = entry.get("bytes")
    if expect_bytes is not None and int(expect_bytes) != size:
        errors.append(f"{path.name}: size {size} != manifest {expect_bytes}")
    expect_sha = entry.get("sha256")
    if expect_sha:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        got = h.hexdigest()
        if got.lower() != str(expect_sha).lower():
            errors.append(f"{path.name}: sha256 mismatch")
    print(f"  ok {path.name}  bytes={size}")

if errors:
    print("fetch_models: verification failed:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print("fetch_models: DONE expiresAt=", mint.get("expiresAt"))
PY

echo "fetch_models: all files present under $MODEL_DIR"
