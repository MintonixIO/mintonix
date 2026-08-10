# video-det (vast.ai — detect stage)

GPU worker for pipeline stage **`detect`**: download `normalized.mp4`, run pose
+ shuttle, upload `detections.json`, callback Supabase `jobs/callback`.

Workers hold **no** B2 or Supabase service credentials — only presigned URLs
and a single-use `callback_token`.

| | |
|---|---|
| **Stage** | `detect` (after `normalize`; MVP terminal → match `ready`) |
| **In** | `normalized.mp4` (presigned GET) |
| **Out** | `detections.json` (presigned PUT) |
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
| `Dockerfile` | TensorRT base + product image |
| `test_*.py` | Contract + pipeline unit tests |

## Wire contract (summary)

Inner envelope (jobs may wrap as `{ input: … }`):

```jsonc
{
  "request_id": "<job_id>",
  "input_url": "https://…",              // presigned GET or file://
  "output_upload_url": "https://…",      // presigned PUT or file://
  "callback_url": "https://…/functions/v1/jobs/callback",
  "callback_token": "<jwt>"
}
```

Callback body: `{ "request_id", "status": "success"|"failed", … }` — see root
[`ARCHITECTURE.md`](../../../ARCHITECTURE.md) § One job contract.

Output: frame-aligned pose + top-K shuttle candidates in source-frame UV
`[0,1]`. Full shape in [ARCHITECTURE.md](ARCHITECTURE.md).

## Local tests

CPU-safe tests (no GPU required for contract / pure logic):

```bash
cd workers/vast/video-det
python3 -m unittest test_contract.py test_io_util.py test_server_contract.py \
  test_detect_pipeline.py -v
```

GPU / TensorRT engine build and full e2e remain environment-specific (see
`pose/README.md` and the Dockerfile comments).

## Deploy notes

- vast serverless PyWorker pattern (same family as video-normalization):
  backend on localhost, PyWorker on the published port.
- Product pose engines must match the image’s TensorRT / CUDA stack
  (`Dockerfile` base: `nvcr.io/nvidia/tensorrt:24.04-py3`).
- Env knobs for models and batching live in `detect/config.py` /
  `DetectConfig.from_env()`.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — full detect worker design
- [pose/README.md](pose/README.md) — pose engine package
- [../video-normalization/README.md](../video-normalization/README.md) — previous stage
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) — system job contract / stages
- [../../../supabase/README.md](../../../supabase/README.md) — `jobs` / `complete_job`
