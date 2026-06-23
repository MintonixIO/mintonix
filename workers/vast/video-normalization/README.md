# video-normalization (vast.ai PyWorker)

Normalizes arbitrary source video to a consistent delivery spec:
**≤1920×1080, ≤30 fps, H.264 / yuv420p, AAC audio** — GPU-accelerated
(NVDEC decode → `scale_cuda` → `h264_nvenc`) with a CPU `libx264` fallback.

Deployed on **vast.ai serverless** using the
[PyWorker](https://github.com/vast-ai/pyworker) model.

## Architecture

A PyWorker is a thin proxy the vast autoscaler runs in front of a backend
"model server"; it does not do the work itself. So this worker is three pieces:

| File | Role | Depends on |
|---|---|---|
| `normalize.py` | Provider-neutral core: probe / build ffmpeg cmd / run / download / upload. | ffmpeg, `requests` only — **no** serverless SDK |
| `server.py` | FastAPI backend ("model server") on `127.0.0.1:18000`, exposes `POST /normalize/sync` + `GET /health`. | `normalize.py`, fastapi, uvicorn |
| `worker.py` | The vast PyWorker proxy: routes `/normalize/sync` to the backend, reports load, gates readiness on the backend log. | `vastai-sdk` |

`entrypoint.sh` starts the backend, then runs the PyWorker. `test_handler.py`
imports only `normalize.py`, so the unit + e2e tests run with no SDK installed.

## Request / response

The autoscaler delivers `{"input": {...}}`; the worker's `request_parser`
unwraps it, so the backend receives the inner object:

```json
POST /normalize/sync
{ "input_url": "https://…/source.mp4",
  "output_upload_url": "https://…/normalized.mp4",   // presigned PUT
  "request_id": "abc123" }
```
```json
200 { "request_id", "width", "height", "fps", "codec", "audio_codec",
      "pixel_fmt", "duration", "file_size", "source": {…}, "elapsed_sec" }
500 { "request_id", "error" }
```

`input_url` is downloaded (HTTP GET, or `file://` for local runs);
the result is uploaded to `output_upload_url` (HTTP PUT, or `file://`).

## Local development

```bash
# unit + e2e tests (no GPU, no vastai needed)
python -m unittest test_handler -v

# run the core directly on a local file
python normalize.py '{"input_url":"file:///abs/in.mp4","output_upload_url":"file:///abs/out.mp4"}'

# run the backend server standalone, then POST to it
python server.py
curl -s localhost:18000/normalize/sync \
  -H 'content-type: application/json' \
  -d '{"input_url":"file:///abs/in.mp4","output_upload_url":"file:///abs/out.mp4"}'
```

## Container / deploy

```bash
docker build -t video-normalization .
# GPU host: starts backend + PyWorker
docker run --rm --gpus all video-normalization
```

| Var | Default | Purpose |
|---|---|---|
| `MODEL_SERVER_PORT` | `18000` | Backend port the PyWorker proxies to |
| `MODEL_LOG` | `/var/log/portal/video-normalization.log` | Backend log the PyWorker tails for the `Application startup complete.` readiness line |

### Verified vs. not

**Verified:** the standalone container path above (`docker run --gpus all`) and the
in-image test suite (CI builds the image and runs `python -m unittest test_handler`).
The `vastai-sdk` imports and `WorkerConfig` construction in `worker.py` are
validated.

`worker.py` reaches the SDK's backend init and stops only at
`KeyError: 'CONTAINER_ID'` — an env var vast injects on a real serverless
instance — which confirms config, the mandatory `BenchmarkConfig`, and the
imports are all correct.

**Not yet verified (needs a live test deploy):**
- **Autoscaler env injection.** The SDK requires `CONTAINER_ID` (and
  `MASTER_TOKEN`, `REPORT_ADDR`, `WORKER_PORT`, …), injected by the platform.
  Confirm these reach the container under **docker ENTRYPOINT** launch mode, not
  just vast's `start_server.sh` flow.
- **Backend startup on managed serverless.** `start_server.sh` runs
  `python -m worker` but does **not** run `entrypoint.sh`, so on the managed flow
  something must still start `server.py`. Our self-contained ENTRYPOINT image
  starts both, which is why ENTRYPOINT launch mode is the intended path.
- **Module path.** `workers/vast/video-normalization` is not a valid
  `workers.<BACKEND>.worker` module path; ENTRYPOINT mode sidesteps this (it runs
  `worker.py` directly), but a `start_server.sh`-based deploy would need it
  resolved via `SERVER_DIR`.

Treat the first managed deploy as a smoke test of these points.

> The mandatory `BenchmarkConfig` runs a real transcode of the baked-in
> `sample.mov` at worker startup to measure capacity; override its source with
> `BENCHMARK_INPUT_URL` if needed.

## Performance

This workload is **decode-bound** — one 4K60 job saturates a single GPU's NVDEC
engine — so `worker.py` keeps each worker to one job at a time
(`allow_parallel_requests=False`) and lets the autoscaler add GPUs for
throughput. Full benchmarks (4090 vs 5080, segment-parallel single-file latency,
the “85 s floor”) are in [`FINDINGS.md`](./FINDINGS.md).
