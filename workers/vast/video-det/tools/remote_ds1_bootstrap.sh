#!/usr/bin/env bash
# Bootstrap ds1 eval on the GPU server after scp of bundle + samples.
# Usage (on server):
#   bash /opt/video-det/tools/remote_ds1_bootstrap.sh
set -euo pipefail

ROOT="${VIDEO_DET_ROOT:-/opt/video-det}"
DS1="${DS1_DIR:-/data/ds1}"
OUT="${OUT_DIR:-/tmp/ds1_eval}"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"
export ALLOW_FILE_URLS="${ALLOW_FILE_URLS:-1}"
export POSE_ENGINE="${POSE_ENGINE:-/app/models/yolo26x-pose.engine}"
export SHUTTLE_ENGINE="${SHUTTLE_ENGINE:-/app/models/tracknetv5_fp16_b48.engine}"

echo "=== host ==="
hostname
date
nvidia-smi || true
echo "ROOT=$ROOT DS1=$DS1 OUT=$OUT"
echo "POSE_ENGINE=$POSE_ENGINE SHUTTLE_ENGINE=$SHUTTLE_ENGINE"

if [[ ! -f "$DS1/ds1.mp4" ]]; then
  echo "missing $DS1/ds1.mp4" >&2
  exit 1
fi
if [[ ! -f "$POSE_ENGINE" ]]; then
  echo "WARN: pose engine missing at $POSE_ENGINE — list model dirs:" >&2
  ls -la /app/models /opt/models /data/models 2>/dev/null || true
  find / -name '*.engine' 2>/dev/null | head -20 || true
fi
if [[ ! -f "$SHUTTLE_ENGINE" ]]; then
  echo "WARN: shuttle engine missing at $SHUTTLE_ENGINE" >&2
  find / -name 'tracknetv5_fp16_b48.engine' 2>/dev/null | head -10 || true
fi

cd "$ROOT"
mkdir -p "$OUT"

PYTHON="${PYTHON:-python3}"
echo "using $PYTHON"
$PYTHON -c "import cv2; print('cv2', cv2.__version__)"

ANN_ARGS=()
if [[ -f "$DS1/annotation.json" ]]; then
  ANN_ARGS+=(--annotation "$DS1/annotation.json")
fi
if [[ -f "$DS1/preprocess-log.json" ]]; then
  ANN_ARGS+=(--preprocess-log "$DS1/preprocess-log.json")
fi

$PYTHON tools/run_ds1_eval.py \
  --video "$DS1/ds1.mp4" \
  --pose-ref "$DS1/pose.json" \
  --shuttle-ref "$DS1/shuttle.csv" \
  --out-dir "$OUT" \
  "${ANN_ARGS[@]}"

echo "=== done ==="
ls -la "$OUT"
cat "$OUT/metrics.json" 2>/dev/null || true
