# Mintonix — Data Flows

Four independent pipelines. Two touch the **match-data DB** (content metadata),
two touch **B2 storage via the CDN** (user video bytes). The design rule that
ties the storage flows together: **B2 credentials live in exactly one place —
the Cloudflare Worker.** Everything else moves through one-time capabilities
(signed view tokens, presigned URLs, HMAC job tokens).

```
                        ┌──────────────────────────────────────────┐
                        │  SUPABASE  (DB + Edge Functions)           │
                        │  matches / players / … tables              │
                        │  cdn-access · normalize-video · -callback  │
                        └──────────────────────────────────────────┘
      metadata plane  ▲                                   ▲  storage-control plane
  (1) match-data ─────┘                     (2)(3)(4) ────┘
                                                    │
                                     ┌──────────────┴───────────────┐
                                     │  Cloudflare Worker (CDN)      │  ◀─ only B2 creds
                                     │  /presign  ·  GET /<key>?t=   │
                                     └──────────────┬───────────────┘
                                                    │ free egress (Bandwidth Alliance)
                                              ┌─────┴─────┐
                                              │  Backblaze │
                                              │  B2 bucket │
                                              └───────────┘
```

---

## 1. Match-data collection  (GitHub Actions → Supabase DB)

Pure metadata. No storage, no users. Runs weekly (cron) or on PR/push scoped to
`workers/github/match-data/**`. PR → **dev DB apply**; push to `master` /
schedule → **prod DB, apply**.

```mermaid
flowchart LR
  WP[Wikipedia<br/>BWF World Tour]
  YT[YouTube<br/>BWF channel]

  subgraph GHA["GitHub Actions runner (workers/github/match-data)"]
    direction TB
    S[scraper.py<br/>→ bwf_*_results.json]
    FV[fetch_bwf_videos.py<br/>→ bwf_videos.json]
    FY[find_youtube_videos.py<br/>match vids → video_matches.json]
    L[load_to_supabase.py<br/>upsert matches on hashed id]
    S --> FY
    FV --> FY
    FY --> L
  end

  WP --> S
  YT --> FV

  subgraph DB["Supabase Postgres"]
    T3[(matches<br/>owner_id null = BWF)]
    T5[(jobs)]
    T3 --- T5
  end

  L -->|service key<br/>PR=dev apply · master=prod apply| DB
```

Loads are **idempotent** (`matches.id = sha256(match_key)`). Catalog only —
does not enqueue GPU jobs. See `workers/github/match-data/schema.md`.

---

## 2. Video upload  (browser → B2, direct)

The client asks the orchestrator for a presigned PUT, then uploads **straight to
B2** — bytes never pass through Supabase or the Worker on this path.

```mermaid
sequenceDiagram
  participant C as Browser (user)
  participant O as cdn-access<br/>(Supabase fn)
  participant W as CF Worker /presign
  participant B as Backblaze B2

  C->>O: POST cdn-access {op:"upload", key}<br/>Authorization: user JWT
  Note over O: 1. getUser() → uid (401 if none)<br/>2. key must start users/<uid>/ (403)
  O->>W: POST /presign {key, op:PUT}<br/>Bearer PRESIGN_SERVICE_TOKEN
  Note over W: holds B2 read+write key<br/>SigV4-signs a presigned PUT
  W-->>O: presigned PUT url + expiresAt
  O-->>C: {url, method:PUT, key, expiresAt}
  C->>B: PUT file → url  (direct, cross-origin)
  Note over C,B: needs B2 bucket CORS allowing<br/>PUT from app origin
```

Objects live at `users/<uid>/<match_id>/{original.mp4, normalized.mp4,
thumbnail.jpg, annotation.json, …}` (see supabase/README.md). Access control is a
**prefix check**, no DB lookup.

---

## 3. Video preprocess  (compute pathway, credential-free worker)

Kicks off a GPU transcode on a Vast worker that holds **no credentials** — it
gets presigned URLs + an HMAC callback token in the job envelope.

```mermaid
sequenceDiagram
  participant Cron as jobs/dispatch<br/>(pipeline token)
  participant W as CF Worker /presign
  participant V as Vast worker<br/>(GPU, no creds)
  participant B as Backblaze B2
  participant K as jobs/callback<br/>(HMAC job token)

  Cron->>Cron: dispatch_next_job RPC → claim job
  Note over Cron: prefix = bwf/<match_id>/ or users/<uid>/<match_id>/
  Cron->>W: /presign GET + MULTIPART + PUT
  W-->>Cron: input_url, output_upload (parts), thumbnail_upload_url
  Note over Cron: mint HMAC job token<br/>{job_id,match_id,stage,attempt} aud=jobs-callback
  Cron->>V: POST /normalize/sync envelope
  V->>B: GET input_url (parallel Range) → NVDEC/nvenc
  V->>B: multipart part PUTs → Complete normalized.mp4
  V->>B: PUT thumbnail.jpg (single)
  V->>K: POST result Bearer callback_token
  Note over K: verify token + complete_job RPC
  K-->>V: 200 ack
```

> **Current state:** `jobs` edge function routes normalize → detect; analyze is
> a follow-up. Large objects use CDN `op=MULTIPART`. Callback settles via
> `complete_job`.

The transcode target: **≤1920×1080, ≤30 fps, H.264/yuv420p, AAC**.

---

## 4. Video delivery  (browser → CF edge cache → B2)

Token-gated, **cached** streaming. The orchestrator mints a short-lived Ed25519
view token locally (it holds the private key); the Worker only verifies (public
key) and proxies from B2 through Cloudflare's edge cache.

```mermaid
sequenceDiagram
  participant C as Browser (user)
  participant O as cdn-access fn
  participant W as CF Worker  GET /<key>?t=
  participant Cache as CF edge cache
  participant B as Backblaze B2

  C->>O: POST cdn-access {op:"delivery", key}<br/>user JWT
  Note over O: authn + prefix check<br/>sign Ed25519 token {key, exp} (private key)
  O-->>C: {url: cdn/<key>?t=<jwt>, expiresAt}
  C->>W: GET cdn/<key>?t=<jwt>  (+ Range)
  Note over W: verify JWT (public key)<br/>exp + claims.key === path
  W->>Cache: cf.cacheKey = clean path (token stripped)
  alt cache HIT
    Cache-->>C: 206/200 from edge
  else MISS
    W->>B: SigV4 GET (signQuery)
    B-->>Cache: fill (free egress)
    Cache-->>C: bytes
  end
```

Cache key is the **path only** (token stripped) → every viewer shares one cached
copy; `Range`/seek served from the edge. Token TTL is short (minutes); the cached
object lives much longer (`CACHE_TTL_SECONDS`).

---

## Trust boundary (why the storage flows look the way they do)

| Component | Holds | Can it… |
|---|---|---|
| **cdn-access / normalize-*** (Supabase fns) | Ed25519 **private** key · `/presign` service token · HMAC `JOB_TOKEN_SECRET` | mint view tokens & presign-requests ✔ · touch B2 directly ✗ |
| **CF Worker** (edge) | B2 **read+write** key · Ed25519 **public** key · service token | read/write B2 ✔ · mint view tokens ✗ |
| **Vast / ML / analysis workers** | nothing (one-time presigned URLs + callback token per job) | — |

Asymmetric view token ⇒ orchestrator **mints**, edge only **verifies**. Every
token / presign / job-token is **bound to one `key`**, so none can be replayed
against another object.
