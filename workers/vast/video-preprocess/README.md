# video-preprocess

Vast.ai GPU worker for **normalize + detect** in one image.

```text
YouTube / original
  → [BWF: CFR if needed + court NCC]
  → encode normalized.mp4
  → pose + shuttle on that local file
  → thumbnail.jpg, preprocess-log.json, detections.json
```

`POST /preprocess/sync` is the happy path (encode, then detect when
`detections_upload_url` or `local_output_dir` is set). `POST /detect/sync`
is detect-only retry against an existing `normalized.mp4`.

**Annotation is always required**: `court.corners` (4 points, TL→TR→BR→BL) and
`court.net_poles` (2 points, left/right net-pole tops).

| File | Role |
|---|---|
| `job.py` | Fused happy path (download → encode → optional detect → upload) |
| `detect_job.py` | Detect-only retry |
| `normalize.py` | ffmpeg encode + thumbnail |
| `bwf/` | Court NCC + frame shifts |
| `detect/` + `pose/` | VideoDetector, Engine JSON, TRT pose/shuttle |
| `io_util.py` | HTTPS download / upload |
| `callback.py` | Result callback |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |

## HTTP

- `GET /health` — 200 when TRT engines are loaded
- `POST /benchmark/ping` — 200 (PyWorker probe)
- `POST /preprocess/sync` — fused job; **202** held until GPU + callback finish
- `POST /detect/sync` — detect retry; same 202 hold

### `/preprocess/sync` production fields

| Field | Shape |
|---|---|
| `input_url` | YouTube or B2/CDN HTTPS presign |
| `output_upload` | Multipart `{part_urls, complete_url, abort_url, part_size}` |
| `thumbnail_upload_url` | Presigned HTTPS PUT |
| `preprocess_log_upload_url` | Presigned HTTPS PUT |
| `detections_upload_url` | Presigned HTTPS PUT for `detections.json` (fused). Omit for encode-only. |
| `annotation` | `{ court: { corners: [[x,y]×4], net_poles: [[x,y]×2] } }` |

### Local debug (no callback)

| Field | Shape |
|---|---|
| `local_source` | Absolute path to input video (skips download) |
| `local_output_dir` | Writes `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json`, `detections.json` |

**Not allowed with `callback_url`.**

## 5090 smoke (run server.py, not PyWorker)

Engines are TRT 10.8 / sm_120. Fetch them on the host before `docker build`
(or bind-mount `models/`):

```bash
cd workers/vast/video-preprocess
# needs SUPABASE_URL + SUPABASE_SERVICE_KEY (or PIPELINE_SERVICE_TOKEN)
bash tools/fetch_models.sh

docker build -t video-preprocess .

docker run --gpus all --rm -p 18000:18000 \
  -e CONTAINER_ID=0 \
  -e USE_SSL=false \
  -v /path/to/match.mp4:/data/match.mp4:ro \
  -v /path/to/out:/out \
  video-preprocess \
  /opt/worker-env/bin/python -u /app/server.py
```

Wait until logs show `VideoDetector loaded`, then:

```bash
curl -sS http://127.0.0.1:18000/health
# {"status":"ok","models_loaded":true}

curl -sS -X POST http://127.0.0.1:18000/preprocess/sync \
  -H 'Content-Type: application/json' \
  -d '{
    "request_id": "local-5090",
    "local_source": "/data/match.mp4",
    "local_output_dir": "/out",
    "annotation": {
      "court": {
        "corners": [[100,80],[1820,80],[1820,1000],[100,1000]],
        "net_poles": [[960,200],[960,900]]
      }
    }
  }'
```

Expect HTTP 202 then `/out/normalized.mp4`, `thumbnail.jpg`,
`preprocess-log.json`, `detections.json`. Use real court corners/net poles
from an `annotation.json` when you have one.

Detect-only retry against that output:

```bash
curl -sS -X POST http://127.0.0.1:18000/detect/sync \
  -H 'Content-Type: application/json' \
  -d '{
    "request_id": "local-5090-detect",
    "input_url": "file:///out/normalized.mp4",
    "output_upload_url": "file:///out/detections-retry.json",
    "annotation": { "court": { "corners": [[100,80],[1820,80],[1820,1000],[100,1000]], "net_poles": [[960,200],[960,900]] } }
  }'
```

`ALLOW_FILE_URLS=1` is on in the image. Local `file://` reads: `/app`, `/tmp`, `/data`, `/out`. Writes: `/tmp`, `/out` (never `/app`).

## Deploy (serverless)

```bash
docker build -t video-preprocess .
docker run --gpus all -e CONTAINER_ID=0 -e USE_SSL=false -p 3000:3000 video-preprocess
```

Set `CALLBACK_URL_PREFIX`. `VAST_PREPROCESS_ENDPOINT_NAME` on the jobs
function (legacy `VAST_NORMALIZE_ENDPOINT_NAME` still works). Detect retry
can use the same endpoint (`VAST_DETECT_ENDPOINT_NAME` falls back to it).

Requires `USE_SSL=false` and WG `launch_args`
`--env '-e USE_SSL=false -e UNSECURED=1'`.

## Tests

```bash
python -m unittest discover -v -s . -p 'test_*.py'
```
