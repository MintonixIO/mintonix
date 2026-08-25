# video-det (vast.ai — detect stage)

GPU worker for pipeline stage **`detect`**: download `normalized.mp4`, run pose
+ shuttle, upload `detections.json`, callback Supabase `jobs/callback`.

Workers hold **no** B2 or Supabase service credentials — only presigned URLs
and a single-use `callback_token`.

| | |
|---|---|
| **Stage** | `detect` (after `normalize`; MVP terminal → match `ready`) |
| **In** | `normalized.mp4` + `annotation.json` + `preprocess-log.json` (presigned GET) |
| **Out** | `detections.json` (presigned PUT; Engine envelope: meta + `segments` + `rallies` + `frames`) |
| **HTTP** | `POST /detect/sync` (PyWorker → FastAPI model server) |
| **Dispatcher** | `supabase/functions/jobs` → `STAGES.detect` |

Deep design (decode schedule, schemas, layers):
**[ARCHITECTURE.md](ARCHITECTURE.md)** in this directory.

## Pipeline role

```
normalize  →  detect (this worker)  →  analyze (not wired)
                  ↓
            detections.json
```

BWF valid-frames are already baked into `normalized.mp4` by the normalize
worker; detect always reads that single key.

## Layout

| Path | Role |
|------|------|
| `server.py` | FastAPI model server: `/detect/sync`, `/health` |
| `worker.py` | vast PyWorker proxy |
| `io_util.py` | Stream download / upload / callback |
| `detect/` | `VideoDetector`, pose adapter, shuttle (TrackNet) |
| `pose/` | YOLO pose TRT engine + letterbox |
| `tools/` | Eval / bench (not the product path) |
| `Dockerfile` | TensorRT base + product image (models baked in) |
| `models/` | `MANIFEST.json` + B2-fetched weights (not in git) |
| `tools/fetch_models.sh` | CI / local download via CDN delivery URLs |
| `test_*.py` | Contract + pipeline unit tests |

## Wire contract (summary)

Inner envelope (jobs may wrap as `{ input: … }`):

```jsonc
{
  "request_id": "<job_id>",
  "input_url": "https://…",              // presigned GET normalized.mp4
  "output_upload_url": "https://…",      // presigned PUT detections.json
  "annotation_url": "https://…",         // presigned GET annotation.json
  "preprocess_log_url": "https://…",     // presigned GET preprocess-log.json
  "callback_url": "https://…/functions/v1/jobs/callback",
  "callback_token": "<jwt>"
}
```

Callback body: `{ "request_id", "status": "success"|"failed", … }` — see root
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) § One job contract.

Output: Engine `detections.json` — `fps`/`width`/`height`, `segments[]`
(islands + scoreboard OCR), `rallies[]` (same-score islands with at most
one island between them), `frames[]` (pose + top-K shuttle UV `[0,1]`).
Full shape in [ARCHITECTURE.md](ARCHITECTURE.md).

Local debug (GPU host, same Engine writer as the server):

```bash
python3 debug.py /data/normalized.mp4 --out ./debug-detect \
  --annotation /data/annotation.json \
  --preprocess-log /data/preprocess-log.json
# Sidecars next to a local video are picked up automatically if flags omitted.
```

## Local tests

CPU-safe tests (no GPU required for contract / pure logic):

```bash
cd workers/vast/video-det
python3 -m unittest test_contract.py test_io_util.py test_server_contract.py \
  test_detect_pipeline.py test_segments.py -v
```

GPU / TensorRT engine build and full e2e remain environment-specific (see
`pose/README.md` and the Dockerfile comments).

## Deploy notes

- vast serverless PyWorker pattern (same family as video-preprocess):
  backend on localhost, PyWorker on the published port. Venv is baked at
  `/opt/worker-env`; entrypoint waits for `/health` 200 then execs the worker.
- Product engines must match the image’s TensorRT / CUDA stack
  (TRT 10.8.0.43 / CUDA 12.8: NGC `tensorrt:25.01-py3` builder,
  `cuda:12.8.0-runtime-ubuntu24.04` final stage). Do not ship the NGC devel
  image. Runtime apt must include `python3-setuptools` (Ubuntu 24.04 dropped
  `python3-distutils`) so vastai's PyWorker can import
  `distutils.util.strtobool`; without it `BenchmarkConfig` is silently `None`.
- **Model bake-in:** GitHub Actions mints CDN delivery URLs
  (`ops/model-urls` + `models/MANIFEST.json`) and bakes weights into
  `/app/models`. Neither GHA nor runtime workers hold B2 keys. Details:
  [models/README.md](models/README.md).
- Env knobs for models and batching live in `detect/config.py` /
  `DetectConfig.from_env()` and Dockerfile defaults (`POSE_ENGINE`,
  `SHUTTLE_ENGINE`, overlap / parallel flags). Engines only — no `.pt`.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — full detect worker design
- [pose/README.md](pose/README.md) — pose engine package
- [../video-preprocess/README.md](../video-preprocess/README.md) — previous stage
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) — system job contract / stages
- [../../../supabase/README.md](../../../supabase/README.md) — `jobs` / `complete_job`
