# Baked model cache (`/app/models`)

Product detect weights are **not** in git. CI mints **CDN delivery URLs** via
Supabase `ops/model-urls`, downloads through Cloudflare (Bandwidth Alliance
free B2→CF egress + edge cache), and the Dockerfile copies them into the image.

| File | Env | Role |
|------|-----|------|
| `yolo26x-pose.engine` | `POSE_ENGINE` | Pose TRT (FP16) |
| `tracknetv5.pt` | `SHUTTLE_CKPT` | TrackNet checkpoint |
| `tracknetv5_fp16_b48.engine` | `SHUTTLE_ENGINE` | TrackNet TRT (FP16, batch 48) |

Canonical listing + object prefix: **[MANIFEST.json](MANIFEST.json)**.

## Why CDN delivery (not B2 keys / not `/presign` GET)

| Path | Egress | Credentials on GHA |
|------|--------|--------------------|
| **CDN `GET /key?t=jwt`** (this design) | B2→CF free, cacheable | `PIPELINE_SERVICE_TOKEN` only |
| Direct B2 S3 / `/presign` GET | Client→B2 (paid path) | B2 keys or presign service token |

B2 credentials stay **only** on the Cloudflare CDN worker. GHA never holds them.

## Object layout (B2 keys)

```
models/video-det/<version>/
  yolo26x-pose.engine
  tracknetv5.pt
  tracknetv5_fp16_b48.engine
```

`<version>` matches `b2_prefix` in `MANIFEST.json` (e.g.
`models/video-det/2026-08-11-fp16`).

Engines are **TensorRT + GPU arch specific**. Export on a host that matches the
product image base (`nvcr.io/nvidia/tensorrt:24.04-py3`) and the vast GPU
family, upload a new versioned prefix, update `MANIFEST.json`.

## Local / CI download

```bash
export SUPABASE_URL=https://xxxx.supabase.co
export PIPELINE_SERVICE_TOKEN=...   # same as jobs/dispatch

cd workers/vast/video-det
bash tools/fetch_models.sh
```

This calls:

```http
POST {SUPABASE_URL}/functions/v1/ops/model-urls
x-pipeline-token: <PIPELINE_SERVICE_TOKEN>
{ "keys": ["models/video-det/<ver>/yolo26x-pose.engine", ...] }
```

→ short-lived CDN URLs → `curl` each URL into `./models/`.

## Upload a new version (ops)

Still need write access to the private bucket (ops machine or `/presign` PUT).
Helper that uses B2 S3 API (ops-only keys, not for CI):

```bash
export B2_S3_ENDPOINT=... B2_REGION=... B2_BUCKET=...
export B2_ACCESS_KEY_ID=... B2_SECRET_ACCESS_KEY=...
export MODEL_VERSION=2026-08-11-fp16
bash tools/upload_models_to_b2.sh /path/to/engine/dir
# paste printed sha256/bytes into MANIFEST.json; commit MANIFEST only
```

## CI secrets (GitHub)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Edge project that runs `ops` + can mint CDN JWTs |
| `PIPELINE_SERVICE_TOKEN` | Auth for `ops/model-urls` |

Edge secrets already needed for mint: `CDN_JWT_PRIVATE_KEY`, `CDN_BASE_URL`
(same as `cdn-access`). Optional: `MODELS_DELIVERY_TOKEN_TTL_SECONDS` (default 1800).
