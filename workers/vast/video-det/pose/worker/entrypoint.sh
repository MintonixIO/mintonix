#!/usr/bin/env bash
# Worker entrypoint: calibrate → run pose estimation over the whole video →
# write a results file. The input video is the first arg (default /in/input.mp4)
# and the output goes to $OUT (default /out/poses.npz).
set -euo pipefail

VIDEO="${1:-${VIDEO:-/in/input.mp4}}"
OUT="${OUT:-/out/poses.npz}"

exec python3 /app/process_video.py \
    --video   "$VIDEO" \
    --out     "$OUT" \
    --engine  "${ENGINE:-/app/yolo26x-pose-int8-b16.engine}" \
    --ceiling "${CEILING:-1040}" \
    --conf    "${CONF:-0.15}" \
    --threads "${THREADS:-1}" \
    ${VCPUS:+--vcpus "$VCPUS"} \
    ${WORKERS:+--workers "$WORKERS"}
