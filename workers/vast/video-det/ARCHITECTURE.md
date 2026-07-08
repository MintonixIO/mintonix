# Video Detection Worker — Architecture

## Overview

A vast.ai serverless GPU worker that downloads a video from Backblaze B2, runs
detection inference frame-by-frame, streams progress to the client via Supabase
Realtime, and uploads the result JSON back to B2.

B2 credentials never leave the Supabase Edge Function. The worker operates
entirely through presigned URLs and the public Supabase anon key.

---

## Actors

| Actor | Role |
|---|---|
| **Client** | Browser/app — submits jobs, subscribes to Realtime progress |
| **Edge Function** (`video-jobs`) | Single Deno function; mints URLs, submits to vast.ai, records completion |
| **Backblaze B2** | Object storage for input video and output detection JSON |
| **vast.ai Worker** | GPU container running the detection model |
| **Supabase DB** | `video_jobs` table — persists job state |
| **Supabase Realtime** | Broadcasts progress events to the subscribed client |

---

## Data Flow

```
Client
  │
  │  POST /functions/v1/video-jobs
  │  { input_b2_path }  +  user JWT
  ▼
Edge Function (video-jobs)
  │
  ├─ INSERT video_jobs { id, status: "pending", user_id, input_b2_path }
  │
  ├─ Mint B2 presigned GET  (input video,   TTL: 2h)
  ├─ Mint B2 presigned PUT  (output JSON,   TTL: 2h)
  ├─ Mint job_token = HMAC-SHA256(job_id, WORKER_SECRET)
  │
  ├─ POST https://api.vast.ai/v0/serverless/route/  { endpoint_id }
  │    └─ receives { worker_url }
  │
  ├─ UPDATE video_jobs SET status = "queued"
  │
  ├─ POST {worker_url}
  │    {
  │      job_id,
  │      input_url,      ← presigned GET  (video)
  │      output_url,     ← presigned PUT  (result JSON)
  │      callback_url,   ← .../video-jobs/{job_id}/complete
  │      job_token,
  │      supabase_url,
  │      supabase_anon_key,
  │      realtime_channel: "video-job:{job_id}"
  │    }
  │
  └─ Return { job_id } to client
          │
          ▼
       Client subscribes to Supabase Realtime channel  video-job:{job_id}


                    vast.ai Worker
                         │
                         ├─ GET input_url  →  download video from B2
                         │
                         ├─ Process frames  (detection model)
                         │
                         │   Every ~2 seconds:
                         ├─ POST https://{supabase_url}/realtime/v1/api/broadcast
                         │    Authorization: Bearer {supabase_anon_key}
                         │    {
                         │      channel: "video-job:{job_id}",
                         │      event:   "progress",
                         │      payload: {
                         │        progress:      0.0–1.0,
                         │        frames_done:   int,
                         │        frames_total:  int,
                         │        detections:    [{ frame, label, bbox, conf }]
                         │      }
                         │    }
                         │         └─ Supabase Realtime broadcasts to client ──┐
                         │                                                      │
                         ├─ PUT output_url  →  upload result JSON to B2        │
                         │                                                      │
                         └─ POST callback_url  (edge function, once)           │
                              {                                                 │
                                job_token,                                     │
                                status: "complete",                            │
                                output_b2_path                                 │
                              }                                                │
                                   │                                           │
                                   ▼                                           │
                             Edge Function  (/complete route)                  │
                                   │                                           │
                                   ├─ Verify job_token                        │
                                   ├─ UPDATE video_jobs SET                   │
                                   │    status = "complete",                  │
                                   │    output_b2_path = ...                  │
                                   └─ Final Realtime broadcast ───────────────┤
                                                                              │
Client receives events ◄──────────────────────────────────────────────────────┘
  { progress, frames_done, frames_total, detections }   (streaming)
  { status: "complete", output_b2_path }                (final)
```

---

## Edge Function Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/video-jobs` | Submit job, mint URLs, call vast.ai, return `job_id` |
| `POST` | `/video-jobs/:id/complete` | Worker signals completion; verify token, update DB, final broadcast |

Progress updates bypass the edge function entirely — the worker broadcasts
directly to Supabase Realtime.

---

## Payload Schemas

### Worker input (POSTed to vast.ai worker)

```jsonc
{
  "job_id": "uuid",
  "input_url": "https://b2.example.com/...?sig=...",   // presigned GET
  "output_url": "https://b2.example.com/...?sig=...",  // presigned PUT
  "callback_url": "https://<project>.supabase.co/functions/v1/video-jobs/<id>/complete",
  "job_token": "<hmac>",
  "supabase_url": "https://<project>.supabase.co",
  "supabase_anon_key": "<anon_key>",
  "realtime_channel": "video-job:<job_id>"
}
```

### Realtime progress broadcast (worker → Supabase, every ~2s)

```jsonc
{
  "channel": "video-job:<job_id>",
  "event": "progress",
  "payload": {
    "progress": 0.42,
    "frames_done": 126,
    "frames_total": 300,
    "detections": [
      { "frame": 124, "label": "car", "bbox": [x, y, w, h], "conf": 0.91 }
    ]
  }
}
```

### Completion callback (worker → Edge Function)

```jsonc
{
  "job_token": "<hmac>",
  "status": "complete",
  "output_b2_path": "jobs/<job_id>/result.json"
}
```

### Error callback (worker → Edge Function, on failure)

```jsonc
{
  "job_token": "<hmac>",
  "status": "failed",
  "error": "OOM during frame 312"
}
```

---

## Security

| Concern | Mechanism |
|---|---|
| B2 credentials | Never leave the edge function; worker receives only opaque signed URLs |
| Worker identity | `job_token = HMAC-SHA256(job_id \|\| WORKER_SECRET)` — minted per job, verified on completion callback |
| Realtime auth | Supabase anon key — already public (embedded in frontend); safe for broadcast |
| Service role key | Never passed to the worker |
| Replay attacks | `job_token` is single-use per job; completion route marks job terminal on first valid call |

---

## Supabase DB Schema

```sql
create table video_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users not null,
  status          text not null default 'pending',  -- pending | queued | processing | complete | failed
  input_b2_path   text not null,
  output_b2_path  text,
  progress        real default 0,
  error           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

---

## Worker File Structure

```
workers/vast/video-det/
├── handler.py        # FastAPI app: POST /process-video, runs detection in background task
├── worker.py         # PyWorker config wiring handler.py as the inference backend
├── detect.py         # Model loading and per-frame inference logic
├── broadcast.py      # Throttled Supabase Realtime broadcast helper
├── Dockerfile        # GPU base image, installs deps, entrypoint: worker.py
└── requirements.txt
```

---

## Key Constraints

| Constraint | Value / Reasoning |
|---|---|
| Presigned URL TTL | 2h minimum — must exceed queue wait + cold start + max video length |
| Progress broadcast interval | Every 2 seconds — balances UX smoothness against Realtime message volume |
| Worker upload before callback | Worker PUTs to B2 output URL *before* POSTing the completion callback |
| Stuck job cleanup | A Supabase cron (pg_cron) marks jobs still in `queued`/`processing` after 3h as `failed` |
| vast.ai cold start | Worker pool kept warm via PyWorker benchmark; first request may still wait for a ready worker |
