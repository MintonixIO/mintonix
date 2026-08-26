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
| **HTTP** | `POST /detect/sync` → **202** `{ "request_id" }` once the job thread is running (PyWorker → FastAPI). Callback is the settle path. |
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
| `server.py` | FastAPI: `/detect/sync` (202), `/health`, `/benchmark/ping` (200) |
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
  `/opt/worker-env`. Entrypoint starts `server.py` then **immediately**
  `exec python -m worker` (port 3000). It does **not** wait for `/health`
  and does **not** run `sign_cert` / openssl. Detect **requires**
  `USE_SSL=false` (HTTP) plus WG `launch_args`
  `--env '-e USE_SSL=false -e UNSECURED=1'`. TLS certs are **never
  minted** in this image: `USE_SSL=true` without restoring **post-bind**
  `sign_cert` will fail (entrypoint exits 1 rather than exec a broken TLS
  worker). Do **not** re-add blocking `sign_cert` before bind — that
  delayed port 3000 past Vast's ~15s window. PyWorker `on_load` is
  `VideoDetector loaded`; autoscaler probe is `POST /benchmark/ping` →
  HTTP **200** (`/detect/sync` is 202 and is not a benchmark).
- Product engines must match the image’s TensorRT / CUDA stack
  (TRT 10.8.0.43 / CUDA 12.8: NGC `tensorrt:25.01-py3` builder,
  `cuda:12.8.0-runtime-ubuntu24.04` final stage). Do not ship the NGC devel
  image. Worker-env pins `setuptools<82` so vastai's PyWorker can
  `from distutils.util import strtobool` (Ubuntu 24.04 dropped stdlib
  distutils; apt python3-setuptools does not seed `/opt/worker-env`).
  Without it `BenchmarkConfig` is silently `None`. Runtime apt uses
  `libglib2.0-0t64` for OpenCV on the t64 glibc transition.
- **Model bake-in:** GitHub Actions mints CDN delivery URLs
  (`ops/model-urls` + `models/MANIFEST.json`) and bakes weights into
  `/app/models`. Neither GHA nor runtime workers hold B2 keys. Details:
  [models/README.md](models/README.md).
- Env knobs for models and batching live in `detect/config.py` /
  `DetectConfig.from_env()` and Dockerfile defaults (`POSE_ENGINE`,
  `SHUTTLE_ENGINE`, overlap / parallel flags). Engines only — no `.pt`.

## Vast serverless (DEV)

Product path is serverless: `jobs/dispatch` → endpoint **VIDEO-DETECTION-DEV**
→ `POST /detect/sync` (HTTP **202**) → B2 + `jobs/callback`. Do not treat
SSH / `debug.py` as a pass. Keep **endpoint definitions**. Destroy leftover
**instances** after the job. No idle 5090 pool (`min_load` stays `0`).

Verified `GET https://console.vast.ai/api/v0/…` (2026-08-25):

| Resource | Name | Id |
|---|---|---|
| Endpoint | `VIDEO-DETECTION-DEV` | **32501** |
| Template | `Video-Detection-DEV` | **531046** (`hash_id` `71c7d04745b2cd0ef0d7ecbb7698576a`) |
| Workergroup | detect | **41743** |
| Image | `ghcr.io/mintonixio/video-det:staging` | template `image` + `tag` |
| Endpoint (protect) | `VIDEO-PREPROCESS-DEV` | **33262** — never destroy |

Detect endpoint 32501 and WG 41743 both have `min_load=0`. **Do not set
`min_load=1`.** Endpoint `max_workers=1`, `cold_workers=0`.
`inactivity_timeout` on **32501 is `1.0`** (Task 7: `1800` respawned 5090s
after DELETE). Idle stop is not a substitute for DELETE after callback.
`GET /api/v0/instances/` must be `instances_found=0` when no detect job is
running.

WG 41743 `launch_args` (proof): `--env '-e USE_SSL=false -e UNSECURED=1'`.
Image default is already `USE_SSL=false`; keep the launch_args so a template
env cannot flip TLS back on. Detect **requires** that pair. Enabling
`USE_SSL=true` without a **post-bind** `sign_cert` path fails closed
(entrypoint logs an error and exits 1).

### GHCR docker login (template 531046)

`ghcr.io/mintonixio/video-det` is private (unauthenticated manifest → 401).
Cold pull without registry auth is host-luck and can stall for tens of minutes.

`GET /users/0/templates/` id **531046** currently:

| Field | Value |
|---|---|
| `docker_login_repo` | `""` |
| `docker_login_user` | `""` |
| `docker_login_pass` | `""` |

A GitHub PAT with `read:packages` (org-SSO authorized) was **not** present in
operator secrets, so login was not applied. When a token exists, set it on the
template (never commit the PAT). Edit uses `hash_id` from GET:

```http
PUT https://console.vast.ai/api/v0/template/
Authorization: Bearer $VAST_API_KEY
Content-Type: application/json

{
  "hash_id": "71c7d04745b2cd0ef0d7ecbb7698576a",
  "docker_login_repo": "ghcr.io",
  "docker_login_user": "MintonixIO",
  "docker_login_pass": "<org PAT, read:packages>"
}
```

`docker_login_user` is the GitHub user or org that owns the PAT (prior working
template on this account used `MintonixIO` + `docker_login_repo=ghcr.io`).
After a successful PUT, `GET /users/0/templates/` must show
`docker_login_user` non-empty. **PUT template changes `hash_id`.** WG 41743
currently binds `template_hash=71c7d04745b2cd0ef0d7ecbb7698576a`; the
workergroup must then be pointed at the new hash — but see the PUT rule
below. Re-read `hash_id` from GET immediately before any edit.

### `:staging` is a moving tag

CI (`.github/workflows/vast-worker.yml`) builds
`ghcr.io/mintonixio/video-det:sha-<gitsha>`, tests that digest, then moves
`:staging` (PR) / `:latest` (master) onto it with `imagetools create`. The
DEV template stores `image=ghcr.io/mintonixio/video-det` and `tag=staging`.
GET templates has **no** separate image-digest field. After a promote, pin
by PUTting `tag` to the immutable `sha-<gitsha>` (or `image` to
`ghcr.io/mintonixio/video-det@sha256:<digest>` if Vast accepts a digest ref).
**Do not promote `:staging` while a detect worker is pulling or a detect job
is processing.**

### Workergroup 41743 filters

Live Task 7 proof (`GET /api/v0/workergroups/` id **41743**; do not PUT
to “fix” these while a job is live):

| Filter | Op | Value |
|---|---|---|
| `gpu_name` | **eq** | **RTX 5090** |
| `gpu_frac` | **eq** | **1** |
| `inet_down` | **gte** | **512** |
| `inet_up` | **gte** | **512** |
| `reliability2` | **gte** | **0.97** |
| `machine_id` | **neq** | **136820** |
| `verified` | eq | true |
| `rentable` | eq | true |
| `rented` | eq | false |
| `num_gpus` | eq | 1 |
| `dph_total` | lt | 0.45 |
| `disk_space` | gte | 50 |
| `direct_port_count` | gte | 2 |

Also on that row: `gpu_ram=32`, `template_id=531046`,
`template_hash=71c7d04745b2cd0ef0d7ecbb7698576a`,
`launch_args=--env '-e USE_SSL=false -e UNSECURED=1'`.

Tighter filters (`inet_down gte 2500`, `reliability2 gte 0.99`) starved
offers. `gpu_frac=0.5` on machine **136820** crash-looped. A PUT of
`search_query` / `search_params` **can recycle workers** (observed
`48635039` → `48635838` mid-job). **Forbidden while a detect job is
processing.**

### Destroy leftover GPUs after callback

After `jobs/callback` (**success or failed**):

1. `GET /api/v0/instances/` (and/or `get_endpoint_workers` id **32501**).
2. `DELETE /api/v0/instances/{id}/` for leftover detect instances.

Never delete endpoint definitions:

- **Do not** `DELETE /api/v0/endptjobs/32501/` (`VIDEO-DETECTION-DEV`)
- **Do not** `DELETE /api/v0/endptjobs/33262/` (`VIDEO-PREPROCESS-DEV`)
- **Do not** delete workergroups 41743 / 41742 or templates 531046 / 531045

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — full detect worker design
- [pose/README.md](pose/README.md) — pose engine package
- [../video-preprocess/README.md](../video-preprocess/README.md) — previous stage
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md) — system job contract / stages
- [../../../supabase/README.md](../../../supabase/README.md) — `jobs` / `complete_job`
