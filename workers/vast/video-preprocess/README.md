# video-preprocess

Vast.ai serverless worker for the pipeline **normalize** stage.

```text
User:  download → encode_full → upload normalized.mp4 + thumbnail.jpg
BWF:   download → [CFR if VFR] → court detect → encode_ranges
       → upload normalized.mp4 + thumbnail.jpg + frame_ranges.csv
```

**BWF requires `annotation`** with `court.corners`. Scoreboard OCR is not used.

| File | Role |
|---|---|
| `job.py` | Pipeline (download → process → upload) |
| `io_util.py` | Download / upload (retries + multipart) |
| `normalize.py` | ffmpeg encode + thumbnail |
| `bwf/` | Court detect + frame map CSV |
| `callback.py` | Result callback |
| `server.py` / `worker.py` / `entrypoint.sh` | Vast HTTP harness |
| `tools/debug.py` | Local debug only (not in image) |

## HTTP

- `GET /health`
- `POST /preprocess/sync` — job envelope from `jobs` dispatch

## Debug (local)

```bash
# from this directory, with GPU + deps
python tools/debug.py /data/match.mp4
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
