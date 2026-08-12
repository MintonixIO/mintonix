# Baked model cache (`/app/models`)

Product detect weights are **not** in git. CI mints **CDN delivery URLs** via
Supabase `ops/model-urls`, downloads through Cloudflare (Bandwidth Alliance
free B2→CF egress + edge cache), and the Dockerfile copies them into the image.

| File | Env | Role |
|------|-----|------|
| `yolo26x-pose.engine` | `POSE_ENGINE` | Pose TRT (FP16) |
| `tracknetv5.pt` | `SHUTTLE_CKPT` | TrackNet checkpoint |
| `tracknetv5_fp16_b48.engine` | `SHUTTLE_ENGINE` | TrackNet TRT (FP16, batch 48) |

Canonical listing: **[MANIFEST.json](MANIFEST.json)**.

## Why CDN delivery (not B2 keys / not `/presign` GET)

| Path | Egress | Credentials on GHA |
|------|--------|--------------------|
| **CDN `GET /key?t=jwt`** (this design) | B2→CF free, cacheable | `PIPELINE_SERVICE_TOKEN` only |
| Direct B2 S3 / `/presign` GET | Client→B2 (paid path) | B2 keys or presign service token |

B2 credentials stay **only** on the Cloudflare CDN worker. GHA never holds them.

## Object layout (B2 keys)

Bucket is environment-specific (`mintonix-dev` or `mintonix-prod`). Keys are flat:

```
s3://mintonix-dev/models/yolo26x-pose.engine
s3://mintonix-dev/models/tracknetv5.pt
s3://mintonix-dev/models/tracknetv5_fp16_b48.engine

s3://mintonix-prod/models/…
```

`MANIFEST.json` `b2_prefix` is `models` (no version folder). Engines are
**TensorRT + GPU arch specific**. Export on a host that matches the product
image / target GPU, then re-upload under `models/`.

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
{ "keys": ["models/yolo26x-pose.engine", "models/tracknetv5.pt", "…"] }
```

→ short-lived CDN URLs → `curl` each URL into `./models/`.

## Upload a new version (ops)

Still need write access to the private bucket (ops machine or `/presign` PUT).
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

## CI secrets (GitHub)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Edge project that runs `ops` + can mint CDN JWTs |
| `PIPELINE_SERVICE_TOKEN` | Auth for `ops/model-urls` |

Edge secrets already needed for mint: `CDN_JWT_PRIVATE_KEY`, `CDN_BASE_URL`
(same as `cdn-access`). Optional: `MODELS_DELIVERY_TOKEN_TTL_SECONDS` (default 1800).
