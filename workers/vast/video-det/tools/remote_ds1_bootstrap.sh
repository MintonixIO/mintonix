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
export SHUTTLE_CKPT="${SHUTTLE_CKPT:-/app/models/tracknetv5.pt}"
export SHUTTLE_ENGINE="${SHUTTLE_ENGINE:-/app/models/tracknetv5_fp16_b48.engine}"

echo "=== host ==="
hostname
date
nvidia-smi || true
echo "ROOT=$ROOT DS1=$DS1 OUT=$OUT"
echo "POSE_ENGINE=$POSE_ENGINE SHUTTLE_CKPT=$SHUTTLE_CKPT"

if [[ ! -f "$DS1/ds1.mp4" ]]; then
  echo "missing $DS1/ds1.mp4" >&2
  exit 1
fi
if [[ ! -f "$POSE_ENGINE" ]]; then
  echo "WARN: pose engine missing at $POSE_ENGINE — list model dirs:" >&2
  ls -la /app/models /opt/models /data/models 2>/dev/null || true
  find / -name '*.engine' 2>/dev/null | head -20 || true
fi
if [[ ! -f "$SHUTTLE_CKPT" ]]; then
  echo "WARN: shuttle ckpt missing at $SHUTTLE_CKPT" >&2
  find / -name 'tracknetv5.pt' 2>/dev/null | head -10 || true
fi

cd "$ROOT"
mkdir -p "$OUT"

# Prefer python from env with torch+cv2
PYTHON="${PYTHON:-python3}"
echo "using $PYTHON"
$PYTHON -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"

$PYTHON tools/run_ds1_eval.py \
  --video "$DS1/ds1.mp4" \
  --pose-ref "$DS1/pose.json" \
  --shuttle-ref "$DS1/shuttle.csv" \
  --out-dir "$OUT"

echo "=== done ==="
ls -la "$OUT"
cat "$OUT/metrics.json" 2>/dev/null || true
