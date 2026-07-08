#!/usr/bin/env bash
# Run the worker on one video. Mounts the input read-only and an ./out dir for
# results. --shm-size is required: the decode ring lives in /dev/shm and the
# Docker default (64 MB) is far too small.
#
#   ./run.sh /path/to/video.mp4 [out_dir]
set -euo pipefail

VIDEO="${1:?usage: ./run.sh <video> [out_dir]}"
OUTDIR="${2:-$PWD/out}"
TAG="${TAG:-pose-worker:latest}"
mkdir -p "$OUTDIR"

docker run --rm \
    --gpus all \
    --shm-size=2g \
    -v "$(realpath "$VIDEO")":/in/input.mp4:ro \
    -v "$(realpath "$OUTDIR")":/out \
    "$TAG" /in/input.mp4

echo "Results in $OUTDIR/poses.npz (+ poses.json)"
