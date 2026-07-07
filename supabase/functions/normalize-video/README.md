# Compute pathway — `normalize-video` + `normalize-callback`

Triggers a credential-free vast normalization job for one of the caller's videos
and receives its result. Two functions:

| Function | Auth | Role |
|---|---|---|
| `normalize-video` | user JWT (`verify_jwt`) | dispatcher: presign + mint job token + invoke Vast |
| `normalize-callback` | job token (HMAC) | receiver: verify token, record result |

## Flow

```
website ─ POST normalize-video {videoId, ext} (user JWT) ─▶ dispatcher
   1. getUser() → uid
   2. keys under users/<uid>/videos/<videoId>/  (uid from token, never body)
   3. Worker /presign ×3  → input_url(GET original.<ext>),
                            output_upload_url(PUT normalized.mp4),
                            thumbnail_upload_url(PUT thumbnail.jpg)
   4. mint HMAC job token  {jobId,uid,videoId,normalizedKey,…} aud=normalize-callback
   5. POST {input:{…urls…, callback_url, callback_token}} ─▶ Vast endpoint
                                                              │
   vast worker: download(input_url) → encode → PUT(output/thumbnail)  │
                → POST result + sha256 to callback_url (Bearer callback_token)
                                                              ▼
                                                    normalize-callback
   verify job token (HMAC, aud, exp) → record status + sha256 + probe metadata
```

The worker holds **no credential** — the presigned URLs and the `callback_token`
are one-time capabilities handed to it in the envelope, exactly like the CDN
delivery model. The `sha256` in the callback is **integrity metadata** (content
addressing / dedup); authorization is the token, not the hash.

## Secrets (project-wide, shared across functions)

Already set (from `cdn-access`): `PRESIGN_SERVICE_TOKEN`, `CDN_PRESIGN_URL`.

New:
```bash
supabase secrets set --project-ref <ref> \
  JOB_TOKEN_SECRET="$(openssl rand -base64 32)" \
  CALLBACK_URL="https://<ref>.supabase.co/functions/v1/normalize-callback" \
  VAST_ENDPOINT_URL="<your vast serverless endpoint>" \
  VAST_API_KEY="<your vast api key>"
```

## Deploy

```bash
supabase functions deploy normalize-video   --project-ref <ref>   # verify_jwt=true
supabase functions deploy normalize-callback --project-ref <ref> --no-verify-jwt
```
`normalize-callback` uses `--no-verify-jwt` because there is no Supabase user —
the worker authenticates with the job token, which the function verifies itself.

## ⚠️ Sync today; callback needs a worker change (not yet deployed)

- The dispatcher currently invokes Vast **synchronously** (holds the connection
  until the encode finishes). Fine to prove the pathway with a **short clip**;
  a real multi-minute encode will exceed the edge wall-clock limit.
- The `callback_url` / `callback_token` fields are already in the envelope, but
  **`server.py` does not use them yet**. To go async, add to the worker:
  1. after upload, `sha256` the normalized output;
  2. `POST` the result JSON (probe metadata + `sha256`) to `callback_url` with
     `Authorization: Bearer <callback_token>`;
  3. requires a Docker image rebuild + redeploy to Vast.
  Until then, the dispatcher's sync response carries the result.

## TODO

- `TODO(persist)` in `normalize-callback`: write a `video_jobs`/`videos` row
  (status, sha256, probe metadata) using the injected service-role key. Currently
  logs + acks so the auth path is exercisable without a table.
- Confirm the exact Vast serverless invocation shape (route protocol + key
  passing) against the deployed endpoint; the dispatcher's Vast call is a
  placeholder (`POST envelope`, `Authorization: Bearer VAST_API_KEY`).
