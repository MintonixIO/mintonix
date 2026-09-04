# Baked model cache (`/app/models`)

Product detect weights are **not** in git. CI mints **CDN delivery URLs** via
Supabase `ops/model-urls`, downloads through Cloudflare (Bandwidth Alliance
free B2→CF egress + edge cache), and the Dockerfile copies them into the image.

| File | Env | Role |
|------|-----|------|
| `yolo26x-pose.engine` | `POSE_ENGINE` | Pose TRT (FP16, batch 16, imgsz 640) |
| `tracknetv5_fp16_b48.engine` | `SHUTTLE_ENGINE` | TrackNet TRT (FP16, batch 48) |

Product path is **engines only** — no PyTorch `.pt` fallback.

Canonical listing: **[MANIFEST.json](MANIFEST.json)** (sha256/bytes plus
`trt_version`, `cuda_tag`, `gpu_arch`, `builder_image`). Rebuild and re-upload
when those pins change.

Baked **2026-08-25** on RTX 5090 (`sm_120`): TensorRT **10.8.0.43** (pip
`tensorrt==10.8.0.43`, same as NGC `tensorrt:25.01-py3`). `load_engine` both
files returned `ICudaEngine` (pose 2 IO tensors; shuttle 2 IO tensors). NGC
24.11 / TRT 10.6.0 cannot build sm_120 engines (`Error 9: Target GPU SM 120
is not supported`). Slim runtime copies this TRT into
`nvidia/cuda:12.8.0-runtime-ubuntu24.04`. Rebuild when `MANIFEST.json` pins
change.

## Why CDN delivery (not B2 keys / not `/presign` GET)

| Path | Egress | Credentials on GHA |
|------|--------|--------------------|
| **CDN `GET /key?t=jwt`** (this design) | B2→CF free, cacheable | `SUPABASE_SERVICE_KEY` only (same value as edge `PIPELINE_SERVICE_TOKEN`) |
| Direct B2 S3 / `/presign` GET | Client→B2 (paid path) | B2 keys or presign service token |

B2 credentials stay **only** on the Cloudflare CDN worker. GHA never holds them.

## Object layout (B2 keys)

Bucket is environment-specific (`mintonix-dev` or `mintonix-prod`). Keys are flat:

```
s3://mintonix-dev/models/yolo26x-pose.engine
s3://mintonix-dev/models/tracknetv5_fp16_b48.engine

s3://mintonix-prod/models/…
```

`MANIFEST.json` `b2_prefix` is `models` (no version folder). Engines are
**TensorRT + GPU arch specific**. Export with `pose/export_trt.py` (defaults:
FP16 / batch 16 / imgsz 640) and `tools/export_tracknet_trt.py`
(`SHUTTLE_TRT_BATCH=48`) on a host matching `builder_image` + `gpu_arch`, then
re-upload under `models/`.

## Local / CI download

Same naming as match-data / GitHub Environments:

```bash
export SUPABASE_URL=https://xxxx.supabase.co   # or SUPABASE_PROJECT_REF=xxxx
export SUPABASE_SERVICE_KEY=...                # service role; edge PIPELINE_SERVICE_TOKEN = same value

cd workers/vast/video-preprocess
bash tools/fetch_models.sh
```

(`PIPELINE_SERVICE_TOKEN` is still accepted as a local alias for the service key.)

This calls:

```http
POST {SUPABASE_URL}/functions/v1/ops/model-urls
x-pipeline-token: <SUPABASE_SERVICE_KEY>
{ "keys": ["models/yolo26x-pose.engine", "models/tracknetv5_fp16_b48.engine"] }
```

→ short-lived CDN URLs → `curl` each URL into `./models/`.

## Upload a new version (ops)

DEV first (`mintonix-dev`). Prefer `/presign` PUT when `B2_*` keys are not on
the ops machine (`PRESIGN_SERVICE_TOKEN` + `CDN_PRESIGN_URL`, same pattern as
`scripts/annotate_and_ingest.py` `cdn_control`):

```bash
# keys: models/yolo26x-pose.engine  models/tracknetv5_fp16_b48.engine
# POST $CDN_PRESIGN_URL  {op:PUT, key}  → curl --upload-file the engine
```

Helper that uses B2 S3 API (ops-only keys, not for CI):

```bash
export B2_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
export B2_REGION=us-east-005
export B2_BUCKET=mintonix-dev   # or mintonix-prod
export B2_ACCESS_KEY_ID=...
export B2_SECRET_ACCESS_KEY=...

bash tools/upload_models_to_b2.sh /path/to/engine/dir
# paste printed sha256/bytes into MANIFEST.json; commit MANIFEST only
```

## CI secrets (GitHub Environment — same as match-data)

| Name | Kind | Purpose |
|------|------|---------|
| `SUPABASE_PROJECT_REF` | variable | Derives `https://<ref>.supabase.co` for ops |
| `SUPABASE_SERVICE_KEY` | secret | Auth for `ops/model-urls` (`x-pipeline-token`) |

`video-preprocess` CI selects **dev** on PR and **prod** on master (via
`vast-worker.yml` `environment`), matching match-data / supabase workflows.

Edge secrets already needed for mint: `CDN_JWT_PRIVATE_KEY`, `CDN_BASE_URL`
(same as `cdn-access`), and **`PIPELINE_SERVICE_TOKEN` set to the service role
key** (same bytes as `SUPABASE_SERVICE_KEY`). Optional:
`MODELS_DELIVERY_TOKEN_TTL_SECONDS` (default 1800).
