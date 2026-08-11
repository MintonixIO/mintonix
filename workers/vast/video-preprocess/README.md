# video-preprocess

Vast.ai serverless worker for the pipeline **normalize** stage.

```text
YouTube URL → BWF:  download → [CFR if VFR] → court detect → encode_ranges
B2 / local  → user: download → encode_full
Both: upload normalized.mp4 (multipart) + thumbnail.jpg + preprocess-log.json
```

**Annotation is always required**: `court.corners` (4 points, TL→TR→BR→BL) and
`court.net_poles` (2 points, left/right net-pole tops). Path mode is derived
from `input_url` (YouTube → BWF; local/B2 → user), not from annotation presence.

| File | Role |
|---|---|
| `job.py` | Pipeline (download → process → upload) |
| `io_util.py` | Download / multipart upload |
| `normalize.py` | ffmpeg encode + thumbnail |
| `bwf/` | Court detect + frame shifts |
| `worker_info.py` | Cheap host/GPU fingerprint for preprocess-log |
| `callback.py` | Result callback |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |
| `tools/debug.py` | Local debug only (not in image) |

## HTTP

- `GET /health`
- `POST /preprocess/sync` — job envelope from `jobs` dispatch

### Required body fields

| Field | Shape |
|---|---|
| `input_url` | YouTube, B2/CDN presign, or `file://` |
| `output_upload` | Multipart `{part_urls, complete_url, abort_url, part_size}` (or `file://` locally) |
| `thumbnail_upload_url` | Presigned PUT |
| `preprocess_log_upload_url` | Presigned PUT for `preprocess-log.json` |
| `annotation` | `{ court: { corners: [[x,y]×4], net_poles: [[x,y]×2] } }` |

## Debug (local)

```bash
# from this directory, with GPU + deps
python tools/debug.py /data/match.mp4 --annotation ./testdata/annotation.json
python tools/debug.py 'https://youtu.be/…' --annotation ./annotation.json --out ./debug-bwf
```

Local inputs always take the **user** path (full encode). YouTube takes **BWF**.

## Deploy

```bash
docker build -t video-preprocess .
docker run --gpus all -e CONTAINER_ID=0 -e USE_SSL=false -p 3000:3000 video-preprocess
```

Set `CALLBACK_URL_PREFIX` in production. Point the vast endpoint at this image
and set `VAST_PREPROCESS_ENDPOINT_NAME` on the jobs function
(legacy `VAST_NORMALIZE_ENDPOINT_NAME` still works).

## Tests

```bash
python -m unittest discover -v -s . -p 'test_*.py'
```
