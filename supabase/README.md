# Supabase (schema, RPCs, edge functions)

Canonical data model for Mintonix match catalog + video processing.
Lives next to `migrations/` and `functions/`. Complements root
[`ARCHITECTURE.md`](../ARCHITECTURE.md) (system topology, trust model,
workers). Where the two disagree on table shape, **this file wins** for
Postgres.

Status: **implemented** — squashed init
`supabase/migrations/20260712000000_init_match_pipeline.sql` (tables + core
RPCs) plus additive `20260726000000_ops_set_stage.sql` /
`20260726010000_ops_set_stage_v2.sql` (`ops_set_stage`) and
`20260726020000_jobs_dispatch_cron.sql` (auto-drain cron); edge functions
`matches-ingest`, `jobs`, `cdn-access`, `ops`. Supersedes the multi-table video
pipeline and normalized match-data migrations (deleted). Dev reshape drops
legacy objects in the init migration; **prod** needs a planned cutover — see
[Prod migration runbook](#prod-migration-runbook).

---

## Design principles

1. **Two product tables.** `matches` is the domain object (catalog + video
   identity + coarse status). `jobs` is processing state for a pipeline run.
2. **B2 holds bytes.** No asset-registry table; paths are constructable from
   the match row. Annotations and labels are one JSON file in B2.
3. **No separate `videos` row.** One match ↔ one primary video (single-camera).
4. **Identity without a players graph (for now).** Four nullable name columns
   cover singles and doubles. A `players` table can come later if profiles and
   reverse lookups matter.
5. **Deterministic match ids where it helps.** BWF ids are content hashes so
   re-scrapes upsert cleanly. User match ids are owner-scoped and stable once
   created.
6. **Ownership encodes origin.** `owner_id IS NULL` ⇒ system/BWF;
   `owner_id` set ⇒ user. No `source_kind` column.
7. **Queue in Postgres.** Work is claimed from `jobs` with optional **pgmq**
   in front for visibility timeouts and fair multi-worker dispatch (see
   [Queues](#queues-pgmq)).

---

## Entity overview

```
matches  ──1:N──▶  jobs
   │
   └── constructable prefix ──▶  B2 objects

pgmq (optional but recommended)
  jobs_interactive  /  jobs_bulk
  message body: { "job_id": "<uuid>" }
```

| Object | Role |
|--------|------|
| `matches` | Everything about a match as a product object |
| `jobs` | One pipeline run; `stage` advances in place |
| B2 | Media + `annotation.json` + stage outputs |
| pgmq | Visibility-timeout queue; payload is only `job_id` |

---

## `matches`

One row = one match (BWF or user) and its primary video identity.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `text` **PK** | Deterministic hash for BWF; owner-scoped id for user (see [Ids](#ids)) |
| `owner_id` | `uuid` → `auth.users`, **nullable** | `NULL` = system/BWF; set = user-owned |
| `source_url` | `text`, nullable | YouTube (or similar) for **first** fetch; unused after original is in B2 |
| `tournament` | `text`, nullable | Composite display/context: `{name}-{discipline}-{round}` e.g. `2026 All England Open-WS-Final` |
| `match_date` | `date`, nullable | Part of BWF identity hash when known; useful in UI |
| `team1_player1` | `text`, nullable | |
| `team1_player2` | `text`, nullable | `NULL` for singles |
| `team2_player1` | `text`, nullable | |
| `team2_player2` | `text`, nullable | `NULL` for singles |
| `g1_t1` | `int`, nullable | Game 1 team1 score |
| `g1_t2` | `int`, nullable | Game 1 team2 score |
| `g2_t1` | `int`, nullable | |
| `g2_t2` | `int`, nullable | |
| `g3_t1` | `int`, nullable | Best-of-3 third game |
| `g3_t2` | `int`, nullable | |
| `status` | `text` NOT NULL DEFAULT `'pending'` | `pending` \| `processing` \| `ready` \| `failed` — UI rollup; per-run truth in `jobs` |
| `duration_sec` | `real`, nullable | Probe from normalize callback |
| `width` | `int`, nullable | |
| `height` | `int`, nullable | |
| `fps` | `real`, nullable | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Insert / first-seen time |

**Checks**

- `owner_id IS NULL` allowed only for system/BWF rows; user uploads must set
  `owner_id` (enforce in edge function and/or `CHECK` if you never store
  system rows with an owner).
- `status IN ('pending', 'processing', 'ready', 'failed')`.

**Derived (not stored)**

| Concept | How |
|---------|-----|
| Origin | `owner_id IS NULL` → BWF; else user |
| B2 prefix | see [B2 layout](#b2-layout) |
| Winner / games won | Compute from `g1_*`…`g3_*` at read time |
| Season / discipline / round | Encoded in `tournament` string for MVP; parse if filters appear later |

**Indexes**

- Partial BWF catalog: `(created_at DESC) WHERE owner_id IS NULL`
- Partial user library: `(owner_id, created_at DESC) WHERE owner_id IS NOT NULL`
  (also covers RLS `owner_id = auth.uid()` lookups)
- Partial active: `(status, created_at DESC) WHERE status IN ('pending', 'processing')`
- `match_date` for date-range browse
- optional prefix/trigram on `tournament` if browse-by-event matters

**Intentionally omitted from `matches`**

- `source_kind` — inferred from `owner_id`
- `b2_prefix` — constructable
- `match_key` — `id` is the natural key
- `season`, `discipline`, `section`, `round` — folded into `tournament` text
- seeds, `winner`, `games_won` — drop or derive
- YouTube title / confidence / separate scraped_at — use `source_url` + `created_at`
- `assets` jsonb / `video_assets` table — path convention
- `players` jsonb — four columns instead
- separate `videos` table — folded in

---

## `jobs`

One row = one **pipeline run** for a match. Stages
(`normalize` → `detect` → `analyze`) advance **in place** on this row via
`stage`; they are not separate job rows.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `uuid` **PK** DEFAULT `gen_random_uuid()` | Opaque work id (not content-hashed) |
| `match_id` | `text` NOT NULL → `matches(id)` ON DELETE CASCADE | |
| `status` | `text` NOT NULL DEFAULT `'queued'` | `queued` \| `processing` \| `complete` \| `failed` \| `canceled` |
| `stage` | `text` NOT NULL DEFAULT `'normalize'` | `normalize` \| `detect` \| `analyze` |
| `priority` | `int` NOT NULL DEFAULT `100` | Lower runs first: interactive ~10, bulk ~100 |
| `attempt` | `int` NOT NULL DEFAULT `0` | Incremented each dispatch claim |
| `error` | `text`, nullable | Last failure message (ops/debug) |
| `queue` | `text`, nullable | `jobs_interactive` \| `jobs_bulk` — which pgmq queue holds the live message |
| `msg_id` | `bigint`, nullable | In-flight pgmq message id (for archive / settle) |
| `queued_at` | `timestamptz`, nullable | |
| `started_at` | `timestamptz`, nullable | |
| `finished_at` | `timestamptz`, nullable | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

**Indexes**

- Partial unique: at most one **live** job per match  
  `UNIQUE (match_id) WHERE status IN ('queued', 'processing')`
- FK: `match_id` (joins + `ON DELETE CASCADE`)
- Partial: `(started_at) WHERE status = 'processing'` (capacity count)
- Partial: `(priority, created_at) WHERE status = 'queued'` (pgmq fallback /
  SKIP LOCKED)
- Live ordering still prefers pgmq interactive-before-bulk

**Intentionally omitted from `jobs`**

- `params` — stage config (e.g. valid-frames geometry) lives in B2
  `annotation.json` and/or is derived when building the worker envelope
- `progress` — live only via Supabase Realtime from the worker; not persisted

**Job id policy**

Use a random UUID. Do **not** hash `owner_id + time` (collisions, retries, and
BWF “owner” are awkward). Determinism belongs on `matches.id`, not job ids.

---

## Ids

### Match id (BWF)

Content-addressed so re-scrapes hit the same row and the same B2 prefix.

**Production loader** (`workers/github/match-data/match_key.py`):

```
match_key = "{season}|{tournament}|{discipline}|{section}|{round}|{match_idx}"
id        = hex(sha256(utf-8 match_key))   # full 64 hex
```

- `section` = **leaf** of the wiki section path (not the full breadcrumb)
- `match_idx` = roster-stable `r{sha1[:10]}` or positional `p{n}` for byes
- Scores / `source_url` are **not** in the hash

See `workers/github/match-data/schema.md`.

### Match id (user)

Stable once created; not required to be content-addressed:

- client-generated UUID, or
- `hex(sha256(owner_id || ":" || client_nonce))`

Created at upload-confirm / match-create time; never rewritten.

### Job id

`gen_random_uuid()`.

---

## B2 layout

Prefix is **not stored**. Construct:

```text
owner_id IS NULL  →  bwf/<match_id>/
owner_id set      →  users/<owner_id>/<match_id>/
```

Objects under the prefix:

```text
original.<ext>            raw source (upload or yt-dlp archive)
normalized.mp4            primary cleaned asset (full normalize OR BWF cut)
thumbnail.jpg
preprocess-log.json       frame shifts + worker fingerprint + stage timings
annotation.json           court geometry + player labels (single file)
detections.json           detect output
analysis.json             analyze output
```

### `annotation.json` (collapsed court + labels)

```jsonc
{
  "court": {
    "corners": [[x, y], [x, y], [x, y], [x, y]],  // TL → TR → BR → BL
    "net_poles": [[x, y], [x, y]],                // left, right (net pole tops)
    "scoreboard_crop": { "x", "y", "w", "h" },    // optional
    "score_sub_crop":  { "x", "y", "w", "h" },    // optional
    "row_split_y": 0                                // optional
  },
  "labels": [
    {
      "frame_idx": 0,
      "anchor": { "x": 0, "y": 0, "bbox": [0, 0, 0, 0] },
      "side": 1,
      "slot": 1
    }
  ]
}
```

`side` / `slot` point at the match roster columns
(`team1_player1` = side 1 slot 1, etc.). Clients write this file via
cdn-access presigned PUT (user prefix rule for user matches; BWF materialization
via service token / presets as needed).

Regenerated outputs should version keys (`…/v2/…`) or purge CDN cache if the
delivery layer caches by path.

---

## Queues (pgmq)

### Why a queue in front of vast

Vast has its own autoscaler queue. We still want Postgres-level:

- **Priority** — user uploads (`jobs_interactive`) before bulk BWF (`jobs_bulk`)
- **Visibility timeout** — if a worker dies without callback, the message
  reappears and the job can be re-dispatched (`attempt++`)
- **Spend cap** — dispatcher refuses to claim when too many jobs are
  `processing`
- **Single place to observe** “what’s waiting”

### Queues

| Queue | Use |
|-------|-----|
| `jobs_interactive` | User-initiated (uploads, re-runs); lower `priority` on the job row (~10) |
| `jobs_bulk` | BWF / scraper / backlog-style ingest; priority ~100 |

**Live dispatch order** is interactive queue then bulk (`pgmq.read`), not
`ORDER BY jobs.priority`. The `priority` column is metadata (and a fallback if
a future claim path uses `SKIP LOCKED` without pgmq). Choosing the queue is
what actually prioritizes user work over bulk.

Enable Supabase Queues (pgmq) on the project before migrations that
`pgmq.create(...)`.

Message body is minimal:

```json
{ "job_id": "<uuid>" }
```

Full payload is always the `jobs` row joined to `matches`.

### Claim path

1. Dispatcher (edge `jobs/dispatch`, cron or manual) authenticates with
   `PIPELINE_SERVICE_TOKEN`.
2. Prefer interactive queue, then bulk: `pgmq.read(queue, vt, 1)`.
3. Lock job row; skip/archive if already terminal.
4. Set `status = 'processing'`, `attempt = attempt + 1`, store `queue` +
   `msg_id`, set `matches.status = 'processing'` if it was `pending`.
5. Build worker envelope (presigned URLs from constructable prefix + stage),
   mint callback token, POST to vast.
6. On callback settle: `pgmq.archive` the message; on retryable failure,
   archive and `pgmq.send` again so the job is visible immediately.

**Visibility timeout (`vt`)** must exceed worst-case stage wall time (e.g. 3h
for download + 4K normalize + OCR). That timeout **is** the primary
“worker disappeared” retry mechanism.

### Soft caps

Dispatcher options (not table columns): `max` jobs per invoke,
`max_running` concurrent `processing` jobs (GPU spend ceiling), `vt`.

### Fallback without pgmq

If Queues are unavailable, claim with:

```sql
SELECT * FROM jobs
 WHERE status = 'queued'
 ORDER BY priority ASC, created_at ASC
 LIMIT 1
 FOR UPDATE SKIP LOCKED;
```

You lose visibility-timeout redelivery unless you add a lease column
(`lease_expires_at`) and a reaper. **pgmq is the preferred default.**

### Cron (dispatch drain)

**Auto-drain only.** A pg_cron job (`jobs-dispatch`, every minute) calls
`public.invoke_jobs_dispatch()`, which POSTs `/functions/v1/jobs/dispatch`
via pg_net. Nothing in this path enqueues work.

| May enqueue | Must not auto-enqueue |
|-------------|------------------------|
| `matches-ingest` (user confirm / intentional system ingest) | Catalog load (`load_to_supabase.py`) |
| `ops` set-stage with `enqueue=true` | Scraper / weekly match-data alone |
| `complete_job` next-stage / retry re-queue | Any “process all matches” cron |

Migration: `20260726020000_jobs_dispatch_cron.sql`.

**Per-project Vault setup** (once per env after `db push`; secrets never in git):

```sql
-- Full dispatch URL for this project:
select vault.create_secret(
  'https://<PROJECT_REF>.supabase.co/functions/v1/jobs/dispatch',
  'jobs_dispatch_url',
  'pg_cron → jobs/dispatch'
);

-- Same value as edge secret PIPELINE_SERVICE_TOKEN:
select vault.create_secret(
  '<PIPELINE_SERVICE_TOKEN>',
  'pipeline_service_token',
  'x-pipeline-token for jobs/dispatch'
);
```

If either secret is missing, the cron logs a WARNING and no-ops (safe right
after migrate). To rotate, update the Vault secret row (Dashboard → Database →
Vault, or `vault.update_secret`).

Verify:

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'jobs-dispatch';
-- after a minute with secrets set + something queued:
select id, status_code, created from net._http_response order by created desc limit 5;
```

Manual dispatch (manage.py / curl) still works; cron is the steady-state drain.

Default body: `{ "max": 2, "max_running": 2 }` (see `invoke_jobs_dispatch`).

---

## RPCs (atomic write paths)

Edge functions hold policy (auth, envelope shape, stage routing). RPCs make
the writes atomic. Exact signatures can evolve; the contracts are:

### `ingest_match(...)` (name TBD; replaces `ingest_video`)

In one transaction:

1. `INSERT` into `matches` (or upsert on `id` for BWF).
2. `INSERT` into `jobs` (`stage = 'normalize'`, `status = 'queued'`, priority/queue).
3. `pgmq.send` appropriate queue with `{ job_id }`; store `msg_id` on the job.

A match that needs processing never exists without a queue message (and vice
versa for the initial job).

### `dispatch_next_job(p_vt, p_max_running)`

Pop interactive then bulk; return job + match fields needed to build the
envelope; or `NULL` if nothing to do / at capacity.

### `complete_job(...)`

Settle a stage from the callback:

- Archive (or re-send) pgmq message.
- On success: advance `jobs.stage` and re-queue, **or** mark job `complete` and
  set `matches.status = 'ready'` (+ probe fields).
- On failure: set `error`; retry (re-queue, `status = 'queued'`) or terminal
  `failed` and roll up `matches.status`.
- First terminal write wins (idempotent callback).

Stage-specific config is **not** passed as a jobs.params blob long-term:
dispatcher loads `annotation.json` (presign GET) or uses match columns when
building the next envelope.

### `ops_set_stage(p_match_id, p_stage, p_enqueue, p_cancel_live)`

Service-role only. Manual per-match stage control (ops / `scripts/manage.py`).
Smoke: `scripts/smoke_ops_set_stage.sql` (local Supabase). Grants: `EXECUTE`
for `service_role` only — verify post-deploy that `authenticated` is denied.

| Arg | Meaning |
|-----|---------|
| `p_match_id` | Existing match |
| `p_stage` | `normalize` \| `detect` \| `analyze` — what runs next |
| `p_enqueue` | Default true. `true` → `jobs_interactive` + `pgmq.send`; `false` → job at stage, no pgmq (not dispatchable) |
| `p_cancel_live` | Default true. Fourth arg. If a live job is `processing` and this is false → reject (`live_processing`) without mutating |

**Behavior:**

1. Lock match; require it exists.
2. If live job is `processing` and `cancel_live=false` →
   `{ ok:false, rejected:true, reason:'live_processing' }` (**before** any archive/cancel).
3. Archive any in-flight pgmq message. **Archive exceptions fail the RPC**
   (do not leave a leftover message or double-send). `archive()=false`
   (already absent) is OK.
4. Live **queued** job: reuse the same row (`stage`, `status=queued`, `attempt=0`).
5. Live **processing** job (cancel allowed): mark row **`canceled`** (`msg_id`
   and `queue` cleared), then **INSERT a new `job_id`** at `p_stage`. Stale
   worker tokens bound to the old id/attempt cannot pass `complete_job` CAS.
6. No live job: `INSERT` a new jobs row at `p_stage`.
7. **enqueue=true:** `pgmq.send('jobs_interactive', {job_id})`, store `msg_id`, priority 10.
8. **enqueue=false:** `status=queued` but `msg_id=null`, `queue=null` — dispatch never claims it.
9. `matches.status → pending`.

One apply path sets stage + enqueue fields after cancel/reuse/insert (a
`unique_violation` on insert retries the live-job resolve with flags reset —
no duplicated body).

**`enqueue=false` footgun:** the row remains `status=queued` and still holds
the **one-live-per-match** unique index. `matches-ingest` / “Queue this match”
will return `already_queued` until you **Set stage** again with `enqueue=true`
(reuses the live row and `pgmq.send`s) or the job becomes terminal
(`complete` / `failed` / `canceled`).

**B2 purge is not this RPC.** On `/ops/set-stage` with `purge=true`, the edge
always applies stage with **`enqueue=false` first** (cancel/set under lock, not
dispatchable), then LIST+DELETE stage+later basenames, then — only if the
caller asked for `enqueue=true` — a second `ops_set_stage` to put the job on
`jobs_interactive`. That avoids dispatch racing deletes. `purge=false` stays a
single RPC with the requested enqueue. If purge fails after the first RPC,
stage is already set (`stage_set` in the 502 body) — re-run set-stage with
purge (or fix CDN); enqueue is deferred until purge succeeds.

**Live processing policy:** cancel (new `job_id`) or hard-fail if the operator
declines. Cancel does **not** stop the vast worker — late PUTs can still land.
If dual truth matters, use `enqueue=false`, wait for VT/worker timeout, inspect
B2, then re-run with `enqueue=true`.

Returns jsonb: `ok`, `match_id`, `job_id`, `stage`, `enqueue`, `queue`, `msg_id`,
`b2_prefix`, `had_live`, `canceled_processing`, `canceled_job_id`, `created_job`.

---

## Access control (RLS)

| Role | `matches` | `jobs` |
|------|-----------|--------|
| `service_role` | Full DML (edge functions, BWF loader) | Full DML |
| `authenticated` | `SELECT` where `owner_id = (select auth.uid()) OR owner_id IS NULL` | `SELECT` via parent match |
| `anon` / `public` | none (explicit `REVOKE ALL`) | none |
| Clients | **No direct table writes** | **No direct table writes** |

User-authored files (original upload, `annotation.json`) go through
**cdn-access** presigned PUTs (prefix rule `users/<uid>/…`). DB writes go
through edge functions as `service_role`.

**RLS performance:** policies wrap `auth.uid()` in `(select …)` so Postgres
caches one initPlan evaluation per statement instead of calling per row.

**Product choice:** `owner_id IS NULL` readable by any signed-in user makes BWF
catalog public to accounts. **BWF media delivery** is public via `cdn-access`
`op: "delivery"` on `bwf/…` (no auth; short-lived CDN JWT). User media stays
namespace-scoped.

pgmq and RPCs: `EXECUTE` only for `service_role` (security definer + fixed
`search_path = public` as required for pgmq schema access).

---

## Lifecycle

```
1. Ingest
   matches row + jobs(queued, stage=normalize) + pgmq.send
   matches.status = pending

2. Dispatch (cron)
   pgmq.read → jobs.processing, attempt++
   presign I/O under constructable prefix
     (GET + MULTIPART for large outputs; single PUT for small side assets)
   POST vast worker for current stage
   matches.status = processing

3. Worker
   Parallel Range GET + multipart PUT on large objects (presigned only)
   optional Realtime progress (not stored on jobs)
   POST jobs/callback with HMAC job token

4. Callback → complete_job
   success + more stages → stage = next, re-queue (pgmq.send)
   success + done      → jobs.complete, matches.ready + probe
   failure + retries   → jobs.queued, error set
   failure + exhausted → jobs.failed, matches.failed
```

Trust model unchanged: B2 keys only in Cloudflare CDN worker; workers get
presigned URLs + single-use callback token bound to `(job_id, attempt)`.

---

## Pipeline stages (reference)

| Stage | Worker | Inputs (B2 / URL) | Outputs (B2) |
|-------|--------|-------------------|--------------|
| `normalize` | vast video-preprocess (`/preprocess/sync`) | `source_url` or `original.*`; always `annotation.json` (corners + net poles) | `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json` |
| `detect` | vast video-det | `normalized.mp4` (always; BWF cut already written there) | `detections.json` |
| `analyze` | CPU/worker TBD | detections + `annotation.json` | `analysis.json` |

Same chain for BWF and user; BWF simply has richer `annotation.json` / valid-frames.

### Dual truth + stage artifact map (ops regression)

| Layer | Meaning |
|-------|---------|
| `jobs.stage` + `jobs.status` | What will run next (or is running) |
| B2 objects under match prefix | Evidence that a stage finished |

When **regressing to** stage S, delete outputs for S **and every later stage**:

| Stage | Outputs deleted on regress *to* this stage (and later) | Always keep |
|-------|--------------------------------------------------------|-------------|
| `normalize` | `normalized.mp4`, `thumbnail.jpg`, `preprocess-log.json` | `original.*`, `annotation.json` |
| `detect` | `detections.json` | earlier outputs |
| `analyze` | `analysis.json` | earlier outputs |

Shared constant: keep Python (`scripts/ops_stage.py` `STAGE_OUTPUTS`) and
TypeScript (`supabase/functions/ops/stage_outputs.ts`) in sync with this table.

### Operator control surface

`scripts/manage.py` (match detail actions):

1. **Inspect B2 objects** — LIST prefix, basenames + stage completeness
2. **Set stage…** — pick stage; optional purge; optional enqueue
3. Existing **Queue** (matches-ingest normalize) and **Delete**

Backend path: `POST /functions/v1/ops/set-stage` (`PIPELINE_SERVICE_TOKEN` /
`x-pipeline-token`). No purge → one RPC. With purge → RPC `enqueue=false` →
CDN LIST/DELETE → optional second RPC `enqueue=true`. Clients never gain write
access.

---

## Edge functions

| Function | Role |
|----------|------|
| `cdn-access` | User JWT → upload/delivery tokens; `users/<uid>/` prefix + upload basename allowlist |
| `matches-ingest` | Front door: create/upsert match + enqueue job (service token or user JWT) |
| `jobs` | `/dispatch` (pipeline token) + `/callback` (job HMAC bound to job_id/match_id/stage/attempt) |
| `ops` | `/set-stage` only (`PIPELINE_SERVICE_TOKEN` / `x-pipeline-token`) — set stage; purge uses non-dispatchable stage then optional enqueue |

CDN worker remains the only holder of B2 credentials (`/presign` + delivery).
`/presign` supports `GET` | `PUT` | `DELETE` | `MULTIPART` | `LIST`. Normalize
dispatch uses **MULTIPART** for `normalized.mp4` (and YouTube `original.mkv`)
so the GPU worker uploads at line rate; thumbnail / CSV / JSON stay single PUT.

**Ops auth:** same pipeline token as `matches-ingest` / `/jobs/dispatch`
(`PIPELINE_SERVICE_TOKEN`, header `x-pipeline-token`). No separate ops token
for MVP.

**`POST /functions/v1/ops/set-stage` body:**

| Field | Meaning |
|-------|---------|
| `match_id` | Required |
| `stage` | `normalize` \| `detect` \| `analyze` |
| `enqueue` | Default true — put job on `jobs_interactive` |
| `cancel_live` | Default true — if false and a job is `processing`, reject without mutate |
| `purge` | Default false — stage with enqueue=false, LIST+DELETE stage+later basenames, then enqueue if requested |

MVP notes: **normalize → detect** are wired in `jobs` STAGES. Dispatch always
loads `annotation.json` (corners + net poles) and presigns multipart
`normalized.mp4`, `thumbnail.jpg`, and `preprocess-log.json`. Path mode is
URL-driven on the worker (YouTube → BWF court cut; B2/CDN → full encode).
Detect always GETs `normalized.mp4`. Analyze is not wired yet (detect is
terminal → match `ready`). Env: `VAST_PREPROCESS_ENDPOINT_NAME` /
`VAST_DETECT_ENDPOINT_NAME` (detect falls back to preprocess;
`VAST_NORMALIZE_ENDPOINT_NAME` / `VAST_ENDPOINT_NAME` still work). Worker
route: `POST /preprocess/sync`. User confirm does not HEAD-check B2 before
enqueue (empty keys fail at normalize). Worker callback wire status is
`success`|`failed` (see [`ARCHITECTURE.md`](../ARCHITECTURE.md) § One job
contract); DB stores `complete`|`failed`.

---

## What we removed vs older drafts

| Old | Disposition |
|-----|-------------|
| `videos` | Folded into `matches` |
| `video_assets` | Path convention |
| `players`, `nations`, `match_players`, `match_full` | Four name columns; no player graph yet |
| `annotation_presets` table | Optional later; geometry in `annotation.json` (presets can be code/config) |
| `source_kind`, `b2_prefix`, `match_key` | Infer / construct / use `id` |
| season, discipline, section, round columns | `tournament` text |
| seeds, winner, games_won | Drop / derive from scores |
| youtube_title, confidence, scraped_at | `source_url` + `created_at` |
| jobs.params, jobs.progress | Annotation file + Realtime |
| Per-stage job rows | Single run row; `stage` field |

Match-data scraper loads BWF **into `matches`** via PostgREST upsert on
`id = sha256(match_key)` (`workers/github/match-data/load_to_supabase.py`).
It does **not** call `matches-ingest` / enqueue GPU jobs — catalog load and
pipeline enqueue stay separate. It does not need a parallel private schema
unless product requires service-only BWF before launch (RLS).

---

## Open follow-ups

1. **Exact hash canonicalization** for BWF — loader uses
   `sha256(utf-8 match_key)` where
   `match_key = season|tournament|discipline|section|round|match_idx`
   (see `workers/github/match-data/schema.md`). Pin test vectors if a second
   producer invents ids. Edge functions accept a client/system-supplied `id`;
   they do not invent a second hash algorithm.
2. **Stage advance vs re-queue** — after normalize, re-enter pgmq with same
   `job_id` and `stage = detect` (implemented in `complete_job`), or auto-dispatch
   next stage inside callback without a new queue hop (callback path must stay short).
3. **Wire analyze** in `jobs` STAGES once its worker contract is pinned; detect
   is already wired and currently terminal.
4. ~~**Load `annotation.json` at dispatch** for BWF `valid_frames_config`.~~ done (system matches).
5. **Annotation presets** for BWF tournaments — config file vs small table when
   many events share geometry. Materialize `annotation.json` under `bwf/` when
   the service upload path lands (annotate still prints BWF geometry today).
6. **Players table** — only if player pages / shared identity become product.
7. **BWF read visibility** — authenticated public vs service-only until launch.
8. **Optional B2 existence check / per-owner live-job cap** on user ingest if abuse appears.
9. **Prod cutover** — see runbook below (not automated in CI).

---

## Prod migration runbook

The init migration **drops** legacy match-data + video-pipeline objects and
creates the match-centric schema. CI (`.github/workflows/supabase.yml`) only
runs `supabase db push` — it does **not** repair history or migrate row data.
**Do not ship master → prod until this runbook has been executed deliberately.**

### Preconditions

- Inventory prod data you care about (`matches`, `players`, pipeline `videos`/`jobs`, …).
- If anything must survive, export/transform offline first; this cutover is not
  an in-place data migration.
- Confirm Supabase Queues (pgmq) is enabled on the prod project.

### Repair migration history + apply

Remote still has the deleted version numbers until repaired. From a clean
checkout of this branch, linked to **prod** (or to **re-apply** the squashed
init on DEV without touching secrets):

```bash
supabase link --project-ref <PROJECT_REF>

# Mark removed / superseded versions as reverted in schema_migrations
supabase migration repair --status reverted \
  20260623000000 \
  20260623000100 \
  20260624000000 \
  20260624000100 \
  20260709000000 \
  20260712000100 \
  20260712000200 \
  20260712000000

# Re-apply the single squashed init (drops pipeline tables; keeps Auth,
# edge function secrets, project API keys, Vault entries, etc.)
supabase db push

supabase functions deploy --project-ref <PROJECT_REF>
# Optional if still present from the old name:
# supabase functions delete videos-ingest --project-ref <PROJECT_REF>
```

Notes:

- **Do not** delete the Supabase project or run a full platform reset to squash
  history. `migration repair` + `db push` only rebuilds schema objects from
  this repo; secrets stay configured.
- Repairing `20260712000000` then pushing is how DEV re-applies after a squash
  of intermediate hardening files (data disposable; secrets retained).
- On first prod cutover, if `20260712000*` was never applied, repairing those
  three is a no-op / only needed if a partial apply occurred; always repair the
  five legacy versions.

### Verify

```bash
supabase migration list
# expect local == remote: 20260712000000 only

# smoke: matches/jobs exist; ingest_match / dispatch_next_job / complete_job callable as service_role
```

### Risk

- **Irreversible table drops** of nations/players/old matches/videos/video_assets/…
- Prod cutover is a one-time ops action, not a silent CI step.
- After prod matches this history, normal PR/master CI `db push` is forward-only again.

---

## Quick reference DDL sketch

Illustrative (not a migration file):

```sql
create table matches (
  id              text primary key,
  owner_id        uuid references auth.users (id),
  source_url      text,
  tournament      text,
  match_date      date,
  team1_player1   text,
  team1_player2   text,
  team2_player1   text,
  team2_player2   text,
  g1_t1 int, g1_t2 int,
  g2_t1 int, g2_t2 int,
  g3_t1 int, g3_t2 int,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'ready', 'failed')),
  duration_sec    real,
  width           int,
  height          int,
  fps             real,
  created_at      timestamptz not null default now()
);

create index matches_owner_id_idx on matches (owner_id);
create index matches_status_idx on matches (status);

create table jobs (
  id          uuid primary key default gen_random_uuid(),
  match_id    text not null references matches (id) on delete cascade,
  status      text not null default 'queued'
              check (status in ('queued', 'processing', 'complete', 'failed', 'canceled')),
  stage       text not null default 'normalize'
              check (stage in ('normalize', 'detect', 'analyze')),
  priority    int not null default 100,
  attempt     int not null default 0,
  error       text,
  queue       text check (queue in ('jobs_interactive', 'jobs_bulk')),
  msg_id      bigint,
  queued_at   timestamptz,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index jobs_one_live_per_match_idx
  on jobs (match_id)
  where status in ('queued', 'processing');

create index jobs_dispatch_idx on jobs (status, priority, created_at);
create index jobs_match_id_idx on jobs (match_id);

-- Requires Supabase Queues enabled on the project:
select pgmq.create('jobs_interactive');
select pgmq.create('jobs_bulk');
```
