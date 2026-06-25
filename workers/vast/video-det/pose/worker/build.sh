#!/usr/bin/env bash
# Stage the prebuilt engine + shared pipeline modules into this build context
# (hardlink when possible → no copy cost / no extra disk for the 456 MB engine),
# then build the image.
set -euo pipefail
cd "$(dirname "$0")"

ROOT=".."
STAGED=(pipeline_decode.py calibrate_workers.py yolo26x-pose-int8-b16.engine)

for f in "${STAGED[@]}"; do
    if [[ ! -e "$ROOT/$f" ]]; then
        echo "ERROR: missing $ROOT/$f (run from the repo with the engine present)" >&2
        exit 1
    fi
    rm -f "./$f"
    ln "$ROOT/$f" "./$f" 2>/dev/null || cp "$ROOT/$f" "./$f"
done

TAG="${1:-pose-worker:latest}"
echo "Building $TAG ..."
docker build -t "$TAG" .
echo "Built $TAG"
