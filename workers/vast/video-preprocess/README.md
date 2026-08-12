# video-preprocess

Vast.ai serverless worker for the pipeline **normalize** stage.

```text
YouTube URL → BWF:  download → [CFR if VFR] → court detect → encode_ranges
B2 / CDN    → user: download → encode_full
Both: upload normalized.mp4 (multipart) + thumbnail.jpg + preprocess-log.json
Audio is kept on both paths.
```

**Annotation is always required**: `court.corners` (4 points, TL→TR→BR→BL) and
`court.net_poles` (2 points, left/right net-pole tops). Corners drive BWF court
detect; net poles are required pipeline contract fields (recorded in
`preprocess-log.json`, used by later stages). Path mode is derived from
`input_url` (YouTube → BWF; otherwise → user). `local_source` alone (no URL)
always takes the user path.

| File | Role |
|---|---|
| `job.py` | Pipeline (download → process → upload) |
| `io_util.py` | HTTPS download / multipart upload |
| `normalize.py` | ffmpeg encode + thumbnail |
| `bwf/` | Court detect + frame shifts |
| `worker_info.py` | Cheap host/GPU fingerprint for preprocess-log |
| `callback.py` | Result callback (failures fail the job) |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |
| `tools/debug.py` | Local debug only (not in image) |

## HTTP

- `GET /health`
- `POST /preprocess/sync` — job envelope from `jobs` dispatch

### Required body fields (production)

| Field | Shape |
|---|---|
| `input_url` | YouTube or B2/CDN HTTPS presign (`file://` not supported) |
| `output_upload` | Multipart `{part_urls, complete_url, abort_url, part_size}` |
| `thumbnail_upload_url` | Presigned HTTPS PUT |
| `preprocess_log_upload_url` | Presigned HTTPS PUT for `preprocess-log.json` |
| `annotation` | `{ court: { corners: [[x,y]×4], net_poles: [[x,y]×2] } }` |

`preprocess-log.json` holds frame shifts, timings, worker fingerprint, source +
output probes, encode metadata, and the validated annotation (corners + net
poles). The callback body stays thin (no full `frame_map`).

### Local debug / benchmark only

| Field | Shape |
|---|---|
| `local_source` | Absolute path to input video (skips download) |
| `local_output_dir` | Directory for `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json` |

**Not allowed with `callback_url`.** Production settlement always uploads to B2.
Benchmark and `tools/debug.py` use local fields without a callback.

## Debug (local)

```bash
python tools/debug.py /data/match.mp4 --annotation ./testdata/annotation.json
python tools/debug.py 'https://youtu.be/…' --annotation ./annotation.json --out ./debug-bwf
```

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
