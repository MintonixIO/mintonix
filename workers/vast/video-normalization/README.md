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
| `worker.py` | The vast PyWorker proxy: routes `/normalize/sync` to the backend, reports load, gates readiness on the backend log. | `vastai` (vendor) |
| `start_server.sh` | Vendored from vast-ai/pyworker. Fills autoscaler env defaults, signs the instance TLS cert, builds the worker venv, and launches `python -m worker`. | — |

`entrypoint.sh` starts the backend (`server.py`), then `exec`s `start_server.sh`,
which launches the PyWorker. We hand off to `start_server.sh` rather than running
`python -m worker` ourselves because the SDK's `Worker` needs autoscaler env
(`WORKER_PORT`, `REPORT_ADDR`, `USE_SSL`) and a signed TLS cert that the script
provides — running the worker directly crash-loops on `KeyError: 'WORKER_PORT'`.
The script runs `worker.py` from `SERVER_DIR=/workspace/vast-pyworker` (pre-placed
in the image) in an isolated uv venv, so it never collides with the backend's
system-python deps. `test_handler.py` imports only `normalize.py`, so the unit +
e2e tests run with no SDK installed.

**Deploy must:** publish port 3000 (`-p 3000:3000`, so vast sets
`VAST_TCP_PORT_3000`); leave `BACKEND` and `USE_SYSTEM_PYTHON` unset.

## Request / response

The autoscaler delivers `{"input": {...}}`; the worker's `request_parser`
unwraps it, so the backend receives the inner object:

```json
POST /normalize/sync
{ "input_url": "https://…/source.mp4",                // presigned GET
  "request_id": "abc123",
  // exactly one output destination:
  "output_upload_url": "https://…/normalized.mp4",    // single presigned PUT, OR
  "output_upload": {                                  // parallel multipart (preferred)
    "part_urls":    ["https://…UploadPart&partNumber=1", "…"],
    "complete_url": "https://…CompleteMultipartUpload",
    "abort_url":    "https://…AbortMultipartUpload",
    "part_size":    67108864 } }
```
```json
200 { "request_id", "width", "height", "fps", "codec", "audio_codec",
      "pixel_fmt", "duration", "file_size", "source": {…}, "elapsed_sec" }
500 { "request_id", "error" }
```

`input_url` is downloaded (HTTP GET, or `file://` for local runs). Downloads use
parallel HTTP byte-ranges (`DL_CONNECTIONS`, default 8) when the server supports
Range, else a single stream — single-stream to B2 caps near ~27 MB/s on a fast
host, so parallelism is what reaches line rate.

The result is uploaded either to `output_upload`'s presigned **multipart** URLs
(parts PUT concurrently, `UL_CONNECTIONS`/`part_size`; the worker holds no
storage credentials — the caller presigns `create`/`upload_part`/`complete`/
`abort`) or, if only `output_upload_url` is given, a single presigned PUT (or
`file://` for local runs). On any multipart failure the worker POSTs `abort_url`;
a hard kill can still orphan an incomplete upload, so set a B2 lifecycle rule to
auto-abort incomplete multipart uploads.

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

**Verified:**
- In-image test suite (CI builds the image, runs `python -m unittest test_handler`).
- The full `entrypoint.sh` → `start_server.sh` → PyWorker chain, run locally in
  the image with dummy autoscaler env + `USE_SSL=false`: the venv builds, vendor
  `vastai` installs, the PyWorker boots, **healthchecks the backend `GET /health
  → 200` on a loop**, and the startup `BenchmarkConfig` runs a real `sample.mov`
  transcode (`max_perf` reported). This exercises everything except the two
  platform-only steps below.

**Not yet verified (needs a live deploy — platform-only):**
- **Real TLS cert signing** — `start_server.sh` POSTs a CSR to
  `console.vast.ai/api/v0/sign_cert?instance_id=$CONTAINER_ID`. Needs a real
  instance. If it fails, `UNSECURED=true` is the documented fallback.
- **Autoscaler registration** — the worker reporting to `REPORT_ADDR` with the
  injected `MASTER_TOKEN` and becoming routable. Confirmed locally only with a
  dummy token (no real registration).

Both depend on vast injecting `CONTAINER_ID` / `MASTER_TOKEN` / `PUBLIC_IPADDR` /
`VAST_TCP_PORT_3000` under docker ENTRYPOINT mode. `CONTAINER_ID` was observed
present on a real instance, a strong signal the rest are too.

> The mandatory `BenchmarkConfig` runs a real transcode of the baked-in
> `sample.mov` at worker startup to measure capacity; override its source with
> `BENCHMARK_INPUT_URL` if needed.

## Performance

This workload is **decode-bound** — one 4K60 job saturates a single GPU's NVDEC
engine — so `worker.py` keeps each worker to one job at a time
(`allow_parallel_requests=False`) and lets the autoscaler add GPUs for
throughput. Full benchmarks (4090 vs 5080, segment-parallel single-file latency,
the “85 s floor”) are in [`FINDINGS.md`](./FINDINGS.md).
