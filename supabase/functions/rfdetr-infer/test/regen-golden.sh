#!/usr/bin/env bash
# Regenerate the golden values in expected.json after an intentional model/alias
# change. Calls the Roboflow hosted API directly with the same model the edge
# function resolves rfdetr-seg-preview to (coco-dataset-vdnr1/26).
#
# Usage: ROBOFLOW_API_KEY=... ./regen-golden.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${ROBOFLOW_API_KEY:?set ROBOFLOW_API_KEY}"

b64=$(mktemp)
trap 'rm -f "$b64"' EXIT
base64 < fixture.jpg > "$b64"

curl -s -X POST \
  "https://serverless.roboflow.com/coco-dataset-vdnr1/26?api_key=${ROBOFLOW_API_KEY}&format=json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-binary "@${b64}" \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
ppl = sorted((p for p in d["predictions"] if p["class"] == "person"),
             key=lambda p: -p["confidence"])
top = ppl[0]
print(json.dumps({
  "image": d["image"],
  "person_count": len(ppl),
  "dominant_center": {"x": top["x"], "y": top["y"]},
  "dominant_confidence": round(top["confidence"], 3),
  "dominant_points": len(top.get("points", [])),
}, indent=2))
print("\nUpdate expected.json dominant_person.center to the values above.", file=sys.stderr)
'
