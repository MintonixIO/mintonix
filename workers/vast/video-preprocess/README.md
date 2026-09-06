# video-preprocess

Vast.ai GPU worker for **normalize + detect** in one image. One callback
makes the match `ready`. `/detect/sync` is ops retry only.

```text
YouTube / original
  → [BWF: CFR if needed + court NCC]
  → encode normalized.mp4
  → pose + shuttle on that local file
  → thumbnail.jpg, preprocess-log.json, detections.json
  → one callback (jobs complete_job p_complete_stage=detect)
```

`POST /preprocess/sync` is the product path (encode + detect). Non-local
bodies **require** `detections_upload_url` (HTTP 422 otherwise). Local debug
is `local_source` / `local_output_dir` only. `POST /detect/sync` retries
detect against an existing `normalized.mp4`.

**Annotation is always required**: `court.corners` (4 points, TL→TR→BR→BL) and
`court.net_poles` (2 points, left/right net-pole tops).

| File | Role |
|---|---|
| `job.py` | Fused happy path (download → encode → detect → upload) |
| `detect_job.py` | Detect-only retry |
| `normalize.py` | ffmpeg encode + thumbnail |
| `bwf/` | Court NCC + frame shifts |
| `detect/` + `pose/` | VideoDetector, Engine JSON, TRT pose/shuttle |
| `io_util.py` | HTTPS download / upload |
| `callback.py` | Result callback |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |

## HTTP

- `GET /health` — 200 when TRT engines are loaded
- `POST /benchmark/ping` — 200 (PyWorker probe; no GPU)
- `POST /preprocess/sync` — fused job; **202** held until GPU + callback finish
- `POST /detect/sync` — detect retry; same 202 hold
- GPU routes **503** if models are not loaded; **429** if another job is running
- Non-local bodies require `detections_upload_url` (**422** otherwise)

### `/preprocess/sync` production fields

| Field | Shape |
|---|---|
| `input_url` | YouTube or B2/CDN HTTPS presign |
| `output_upload` | Multipart `{part_urls, complete_url, abort_url, part_size}` |
| `thumbnail_upload_url` | Presigned HTTPS PUT |
| `preprocess_log_upload_url` | Presigned HTTPS PUT |
| `detections_upload_url` | Presigned HTTPS PUT for `detections.json` (required unless local debug) |
| `annotation` | `{ court: { corners: [[x,y]×4], net_poles: [[x,y]×2] } }` |

### Local debug (no callback)

| Field | Shape |
|---|---|
| `local_source` | Absolute path to input video (skips download) |
| `local_output_dir` | Writes `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json`, and `detections.json` when a detector is loaded |

**Not allowed with `callback_url`.** Encode-only local debug is allowed when
engines are not loaded (`tools/debug.py` skips detect).

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
  -e UNSECURED=1 \
  -e ALLOW_FILE_URLS=1 \
  -e NVIDIA_VISIBLE_DEVICES=all \
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

Detect-only retry against that output (`ALLOW_FILE_URLS=1`):

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

Image default is `ALLOW_FILE_URLS=0`. Pass `-e ALLOW_FILE_URLS=1` for
`file://` debug. Reads: `/app`, `/tmp`, `/data`, `/out`. Writes: `/tmp`,
`/out` (never `/app`).

## Deploy (serverless)

```bash
docker build -t video-preprocess .
docker run --gpus all -e CONTAINER_ID=0 -e USE_SSL=false -e UNSECURED=1 \
  -p 3000:3000 video-preprocess
```

Jobs function env: **`VAST_PREPROCESS_ENDPOINT_NAME` only** (both
`/preprocess/sync` and `/detect/sync`).

Vast WG launch_args:

```text
--env '-e USE_SSL=false -e UNSECURED=1'
```

Also set `CALLBACK_URL_PREFIX` or `SUPABASE_URL` (callback allowlist
fail-closed). If the template defaults `NVIDIA_VISIBLE_DEVICES` to void,
set `NVIDIA_VISIBLE_DEVICES=all`. Engines are TRT 10.8 / sm_120.

## Tests

```bash
python -m unittest discover -v -s . -p 'test_*.py'
```
