# Code review issues — by pipeline order

Full-repo audit of branch `merge-features` (read-only). Issues are ordered as work flows through the system, not by severity alone.

**Severity:** `bug` · `suggestion` · `nit`  
**MVP:** `P0` must fix or re-scope before ship · `P1` soon after · `defer` · `freeze` (do not expand)

---

## Pipeline map

```
1. Match-data catalog (BWF scrape → Supabase)
2. User upload + annotation (cdn-access + client stand-in)
3. matches-ingest (front door)
4. Postgres: matches / jobs / pgmq / RPCs
5. jobs/dispatch → CDN /presign → vast
6. video-normalization
7. jobs/callback → stage advance
8. video-det
9. jobs/callback → ready (analyze not wired)
10. Delivery (CDN data plane + cdn-access)
11. Frontends & ops (web, manage, annotate)
```

---

## 1. Match-data catalog (`workers/github/match-data/`)

Catalog-only path: scrape → optional YouTube map → upsert `matches`. Does **not** enqueue GPU jobs (by design).

| Sev | MVP | Module / location | Issue | Suggestion |
|-----|-----|-------------------|-------|------------|
| **bug** | P0 | Docs: `SUPABASE.md` Ids § vs `schema.md` + `load_to_supabase.py:77` | Three identity stories: loader uses `sha256(match_key)`; SUPABASE “Ids” still describes roster/date/`source_url` hash; annotator uses YouTube id (see §2). | One algorithm only: `id = sha256(utf-8(season\|tournament\|discipline\|section\|round\|match_idx))`. Rewrite stale Ids section; add golden test vectors. |
| **suggestion** | P1 | `scraper.py` (~cache under `/tmp`) | Wikipedia cache never invalidates; weekly CI on sticky runners can serve stale wikitext forever. | Bust by day, ETag, or delete cache at job start. |
| **suggestion** | defer | `scraper.py` main / year scope | Scrapes current year only; multi-year automation is overstated if historical JSON is not regenerated. | Commit last N seasons or add `--year`; don’t claim automation you don’t run. |
| **suggestion** | P1 | `find_youtube_videos.py` (~min-score / round aliases) | Aggressive round aliases + default min-score can mis-link videos. Loader coverage guards help but don’t fix bad matches. | Raise default min-score; quarantine low-confidence links. |
| **suggestion** | — | `load_to_supabase.py:15–16` vs `ARCHITECTURE.md` | Architecture still implies scraper enqueues GPU work; loader explicitly does not. | Align ARCHITECTURE: catalog load ≠ pipeline enqueue. |
| **nit** | freeze | `rekey_match_idx.py` | Obsolete hard-exit tripwire. | Keep as fail-loud; delete when docs stop referencing it. |
| **nit** | — | `fetch_bwf_videos.py` | Flat-mode message still says “main channel page” but code hits `/videos` + `/streams`. | Fix copy only. |

**What is solid here**

- `match_key` composition shared by scraper / youtube finder / loader.
- Scores not in the hash; finished-matches-only policy.
- Video coverage guards prevent wiping `source_url` on degraded maps.
- Does not clobber `status` / probe fields on re-scrape.

---

## 2. User upload & annotation (client stand-in + `cdn-access`)

### 2a. `scripts/annotate_and_ingest.py`

Dev stand-in for browser annotate + ingest (ARCHITECTURE §2b/§2c).

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **bug** | P0 | BWF lane (~match id) | Sets `match_id` to YouTube video id (or random hex). Catalog uses `sha256(match_key)`. Same real match → two rows, two B2 prefixes. | Require `--match-id` from catalog; never invent a second BWF id scheme. |
| **bug** | P0 | `FUNCTIONS_BASE` + secrets (~77–78) | Hardcodes **dev** project URL; always reads `~/.mintonix/dev-secrets.env`. Manage can switch to PROD and still shell into this → hits **dev**. | Derive functions base from `SUPABASE_URL`; secrets from selected env; refuse ambiguous prod. |
| **suggestion** | defer | BWF annotation upload | Prints `annotation.json` shape but does not materialize under `bwf/` (clients cannot write that namespace). | Service-side `/presign` PUT for BWF geometry when valid-frames matters. |
| **suggestion** | defer | Scoreboard geometry | Hard-coded top-left quadrant guess — not production OCR quality. | Accept for dev only. |

### 2b. `supabase/functions/cdn-access/`

User JWT → delivery token or upload/delete presign under `users/<uid>/`.

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **bug** | P0 | Namespace gate (~168–171) | Delivery locked to `users/<uid>/`. No path to mint `bwf/…` view tokens; ARCHITECTURE says all delivery goes through cdn-access. | (A) allow authenticated read-only delivery for `bwf/`, or (B) re-scope MVP to user-upload-only and fix docs. |
| **suggestion** | P1 | CORS (~44–48) | Default `CORS_ALLOW_ORIGIN=*` is local-dev only if prod secrets forget to override. | Force app origin in prod secrets. |
| **suggestion** | defer | Body type `expiresIn` | Declared but unused; clients cannot extend TTL (good) but type is dead. | Remove or wire with server cap. |
| **suggestion** | — | Query JWT for delivery | Token in `?t=` leaks via logs/Referer/history. | Keep short TTL (300s default is good); prefer Bearer when possible. |
| **nit** | — | Upload allowlist | `original.mp4` + `annotation.json` only — correct. | Keep. |

**What is solid here**

- No B2 credentials; Ed25519 mint for view tokens; `/presign` service token for PUT/DELETE.
- Upload basename allowlist blocks overwriting pipeline outputs.
- Prefix check with no DB lookup is intentional and clear.

---

## 3. Front door — `matches-ingest`

`supabase/functions/matches-ingest/index.ts`  
Dual auth: pipeline token (system/BWF) or user JWT (upload confirm). Calls `ingest_match` RPC.

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | P1 | Router / response (~208+) | No CORS headers. Browser-direct confirm fails unless same-origin BFF. | Add CORS like cdn-access (prod origin) **or** proxy via Next server. |
| **suggestion** | defer | User path | No B2 HEAD before enqueue (empty keys fail at normalize). | Accept-as-designed; optional later. |
| **suggestion** | defer | System id vs UUID | User IDs UUID-only; system ids permissive — a UUID is also a valid system id (low practical risk). | Optional: reject system ids matching UUID_RE. |
| **suggestion** | — | System queue | Caller can put bulk work on `jobs_interactive`. | Clamp system to bulk unless intentional. |
| **nit** | — | Error mapping | RPC message regex → 403/409. | Fine for MVP; brittle long-term. |

**What is solid here**

- Thin dual-auth front door; ownership enforced in RPC.
- User lane hardcodes interactive priority 10.
- System cannot reclaim user rows; user cannot touch system/other users.

---

## 4. Postgres — schema, queues, RPCs

`supabase/migrations/20260712000000_init_match_pipeline.sql`

### 4.1 Tables & RLS

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | defer | RLS BWF read | Any authenticated user can SELECT all system (`owner_id IS NULL`) matches **and** their jobs (including `error`). | Tighten jobs/BWF visibility before public launch if needed. |
| **suggestion** | defer | No CHECK on owner shape | “User rows must have owner” only enforced at edge/RPC. | Ship as-is. |
| **nit** | — | `jobs.queue` nullable | Ingest always sets it; null is reclaim/legacy safety. | Fine. |

### 4.2 `ingest_match`

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | — | Upsert coalesce | Cannot clear fields to NULL (omit-to-keep). | Document for scrapers. |
| **suggestion** | defer | Abuse caps | No per-owner live-job / upload cap. | Add if abuse appears. |

**Solid:** insert + live-job short-circuit + unique violation + `pgmq.send` in one transaction.

### 4.3 `dispatch_next_job`

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| ~~**bug**~~ | ~~P0~~ | ~~Cron sketch~~ | **Resolved:** `20260726020000_jobs_dispatch_cron.sql` — `jobs-dispatch` every minute; Vault `jobs_dispatch_url` + `pipeline_service_token`. | — |
| **bug** (ops/spend) | P0 | Processing reclaim (~392–417) | VT redelivery always reclaims (`attempt++`) even at `max_running`. Combined with edge invoke timeout/retry → double GPU work. | Reclaim only after stage SLA / heartbeat; fix invoke lifecycle (see §5). |
| **suggestion** | — | At capacity (~422–429) | `set_vt(…,0)` + continue can re-read same head up to 8 times. | Optional delay VT (e.g. 30s). |

**Solid:** interactive before bulk; advisory lock; terminal messages archived; capacity on new claims.

### 4.4 `complete_job`

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | — | `p_match.status` | Not whitelisted in SQL; bad value fails CHECK and rolls back settle. | Edge only sends known values today; optional SQL whitelist. |
| **suggestion** | — | Retry path | Match stays `processing` while job re-queues — OK for UI. | Ship. |

**Solid:** attempt/stage CAS; first terminal wins; stage advance resets `attempt = 0`.

---

## 5. Job lifecycle — `jobs` edge function

`supabase/functions/jobs/index.ts`  
Routes: `/dispatch` (pipeline token) · `/callback` (HMAC job JWT).

### 5.1 Dispatch

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **bug** | P0 | `invokeVast` (~304–374) + catch (~458–473) | Awaits full `/sync` HTTP (minutes–hours). Edge `waitUntil` is much shorter. Abort → `failJob(retry)` while GPU may still run → double attempt, racing PUTs. | Workers return **202 Accepted** (complete via callback only), **or** never requeue after body accepted. |
| **suggestion** | P1 | `waitUntil` (~472–473) | Optional chaining no-ops without `EdgeRuntime` (local Deno) — invoke may never run. | `if (waitUntil) waitUntil(p); else await p`. |
| **suggestion** | P1 | Presign expiry | Default 14400s; CDN env sets max 14400 (good when configured). Align VT (10800) + stage SLA docs. | Document; keep expiry ≥ worst-case stage. |
| **suggestion** | defer | STAGES.normalize (~210) | `annotation.json` → `valid_frames_config` not wired. | Defer until BWF quality path matters. |
| **suggestion** | defer | STAGES.detect (~239–257) | Always `normalized.mp4` (not `valid.mp4`); no `player_mask_url`; detect is terminal (`ready`). | Correct for MVP; wire analyze later. |
| **nit** | — | `timingSafeEqual` | Duplicated with matches-ingest. | Share later if a third copy appears. |

### 5.2 Callback

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | — | Claims cast (~497) | JWT payload cast without strict type parse. | Ship; optional explicit parse. |
| **nit** | — | `DispatchedJob` rebuild | Full roster fields unused by settle today. | Needed when analyze lands. |

**Solid:** token bound to `(job_id, match_id, stage, attempt)`; prefix from DB ownership; status gates; CAS settle.

---

## 6. CDN control plane — presign for workers

`workers/cloudflare/cdn/src/index.ts` — `POST /presign`  
Sole holder of B2 credentials. Jobs + cdn-access call this.

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | P0/P1 | `wrangler.toml` prod CORS | Prod `CORS_ALLOW_ORIGIN = "*"` with query JWTs + public Cache-Control is loose for private media. | Lock prod to app origin(s); `*` only on dev. |
| **suggestion** | P1 | LIST empty prefix (~196–205) | Empty prefix lists **entire bucket** with service token (ops + edge hold token). | Reject empty prefix in prod or require `bwf/` / `users/` min prefix. |
| **suggestion** | — | Content-Type not signed on PUT | Intentional for browser PUTs; attacker with URL can upload any content until expiry. | Short TTL for browser uploads vs long TTL for pipeline. |
| **nit** | — | `timingSafeEqual` length short-circuit | Length oracle; low practical risk for high-entropy token. | Hash-then-compare (as edge does) if polishing. |

**Solid:** key hygiene, path-bound delivery tokens, query-sign for cacheable B2 GETs, method-scoped presigns.

---

## 7. Stage: normalize — `workers/vast/video-normalization/`

Envelope from jobs: `input_url`, outputs, optional youtube archive, callback.

| Sev | MVP | Module | Issue | Suggestion |
|-----|-----|--------|-------|------------|
| **bug** | P0 | `normalize.py` `upload` (~228–247) | Single-shot PUT has **no retries**. After long NVENC, B2 5xx forces full re-download/re-encode. Detect already retries. | Same retry/backoff as detect (or shared I/O). |
| **suggestion** | P1 | `normalize.py` whole (~920 lines) | God-module: I/O + ffmpeg + job orchestration. | Split `io.py` / `ffmpeg_ops.py` / `job.py`; keep facade for tests. |
| **suggestion** | P1 | `has_scale_cuda` | Job fails only when nvenc missing; scale_cuda missing → mid-ffmpeg death after download. | When scale/pixfmt required, require `has_scale_cuda()` with clear retry-elsewhere error. |
| **suggestion** | defer | Multipart upload | Implemented; jobs only presign single PUT. | Wire for multi-GB or leave unused intentionally. |
| **suggestion** | defer | `valid_frames.py` + paddle | Heavy, multi-minute OCR path; jobs never send config. | Cut from MVP success criteria; optional image tag later. |
| **suggestion** | — | `server.py` progress | Failure callback can include `original_archived`; jobs do not re-route retry source from it yet. | Use it on retry or stop advertising as retry-critical. |
| **nit** | — | probe duration | `float(fmt["duration"])` can KeyError if missing. | Guard with stream duration fallback. |

**Solid**

- GPU-only transcode policy; remux-copy when already in spec.
- Cancel-load PyWorker patch keeps instance alive after edge disconnect.
- Callback from job thread; envelope unwrap defensive.
- Strong unit coverage in `test_handler.py`.

---

## 8. After normalize — callback advances stage

Normalize settle: match stays `processing`, probe fields written, `next = detect`.  
(Covered under §5.2 / §4.4.)

---

## 9. Stage: detect — `workers/vast/video-det/`

Envelope: `normalized.mp4` → `detections.json` + callback. Analyze not wired.

| Sev | MVP | Module | Issue | Suggestion |
|-----|-----|--------|-------|------------|
| **bug** | P0 | `detect/__init__.py:23` | Default `POSE_PIPELINE=research` needs multi-ffmpeg; **Dockerfile does not install ffmpeg**. Stock jobs fail. | Default `"serial"`; `ENV POSE_PIPELINE=serial` in image. |
| **bug** | P0 | Research path vs ARCHITECTURE | Product docs say OpenCV co-scheduling; code defaults to research + second OpenCV pass. | Align code + docs on serial as product. |
| **bug** | P0 | `io_util.py` upload (~172) | Streaming JSON write undone by full `read_bytes()` — 100s of MB in RAM. | Stream PUT from file handle. |
| **bug** | P1 | Research frame index | Time-sliced ffmpeg vs sequential OpenCV → pose/shuttle desync risk. | MVP: serial only (one index space). |
| **bug** | P1 | Research RAM | Full-video pose map materialization contradicts chunk-bounded claims. | Serial path streams by chunk. |
| **suggestion** | freeze/cut | `pose/research_pipeline.py`, `decode_pool.py` | Live default but product-unsafe; high ops risk. | Env-gate off; quarantine from product image. |
| **suggestion** | defer | ReID (`detect/reid.py`) | Mask not presigned by jobs → `player_id` always null. | Keep optional; don’t block detect. |
| **suggestion** | P1 | Missing models at startup | Health still 200; jobs 503; benchmark may fail capacity. | Fail hard in prod if engines missing, or mark not-ready. |
| **suggestion** | — | Shuttle on CPU fallback | Silent CPU crawl if CUDA broken. | Fail fast if CUDA expected (match normalize). |
| **suggestion** | — | I/O stack drift | httpx + different range thresholds vs normalize `requests`. | Shared `workers/vast/common/io.py`. |
| **nit** | — | FastAPI `on_event("startup")` | Deprecated vs lifespan. | Migrate when convenient. |

**Solid**

- Serial path: letterbox → PoseEngine → TrackNet top-K → streaming `detections.json`.
- Contract tests for peaks, ReID exclusive match, TrackNet topology.
- Callback + cancel-load pattern mirrors normalize.

---

## 10. Terminal settle (MVP) — detect success → `ready`

Detect settle: `next = null`, match `status = ready`.  
Analyze stage is schema-ready (`jobs.stage` check includes `analyze`) but **not** in edge `STAGES`.

| Sev | MVP | Location | Issue | Suggestion |
|-----|-----|----------|-------|------------|
| **suggestion** | defer | `jobs` STAGES + missing worker | Analyze not implemented (`workers/…/analysis` 📐). | Ship detect-as-terminal; wire when contract pinned. |
| **suggestion** | defer | Cross-stage contracts | No `packages/shared` fixtures for envelope/callback. | Pin fixture JSON validated by edge + workers before more stages. |

---

## 11. Delivery — CDN data plane + product read path

```
Client → cdn-access (op: delivery) → URL?t=<jwt>
       → CDN Worker GET /key?t=… → cached B2 read
```

| Sev | MVP | Module | Issue | Suggestion |
|-----|-----|--------|-------|------------|
| **bug** | P0 | `cdn-access` + BWF | See §2b — BWF objects not deliverable via documented path. | Fix path or re-scope MVP. |
| **suggestion** | P0/P1 | CDN prod CORS | See §6. | Lock origin. |
| **suggestion** | — | Cache-Control public | Correct for CDN sharing of same object; depends on short-lived tokens. | Keep short delivery TTL. |

**Solid:** token key binding; cache key without per-user token; Range support for seek.

---

## 12. Frontends & ops (off the hot path, still in the system)

### 12.1 `apps/web/`

| Sev | MVP | Issue | Suggestion |
|-----|-----|-------|------------|
| **nit** | freeze | Create-Next-App scaffold only (`page.tsx`, `layout.tsx`). | Freeze; not product surface. |
| **nit** | freeze | Root `package.json` — no workspaces, placeholder test. | Freeze monorepo polish until web is real. |

### 12.2 `scripts/manage.py` (~3267 lines)

Internal TUI: browse, queue, dispatch, reconcile, secrets, env switch.

| Sev | MVP | Issue | Suggestion |
|-----|-----|-------|------------|
| **suggestion** | freeze | God-file: secrets + HTTP + B2 reconcile + full curses UI. | Freeze feature growth. Later: `ops/{env,api,reconcile,tui}` or non-interactive CLI. |
| **bug** | P0 | Ingest screen shells to annotate | Env handoff broken (annotate ignores prod). | Fix annotate env **or** remove prod entry from Ingest. |
| **suggestion** | — | Holds service role + presign token | Correct for admin; catastrophic if secrets leak. | Keep `0600` secrets files; document blast radius. |

### 12.3 Shared / missing monorepo pieces

| Sev | MVP | Issue | Suggestion |
|-----|-----|-------|------------|
| **suggestion** | P1 | `packages/shared` missing | ARCHITECTURE promises zod + fixtures; contracts are prose + duplicated parsers. | Fixture files first; packages second. |
| **suggestion** | — | Duplicated helpers | `timingSafeEqual` / JSON helpers across edge functions. | Extract `_shared` when a third copy appears. |

---

## Cross-cutting (touches multiple stages)

| Sev | MVP | Theme | Where it shows up | Suggestion |
|-----|-----|-------|-------------------|------------|
| **bug** | P0 | Double GPU dispatch | §4.3 reclaim + §5.1 invoke timeout | 202 Accepted or no-requeue-after-accept + safer reclaim |
| **bug** | P0 | BWF identity | §1 docs, §2 annotator, loader | One `bwf_id(match_key)` + tests |
| ~~**bug**~~ | ~~P0~~ | ~~Pipeline never runs alone~~ | §4.3 cron | **Resolved:** auto-drain cron (Vault setup still required per env) |
| **suggestion** | P1 | Worker I/O drift | §7 normalize vs §9 detect | Shared I/O module |
| **suggestion** | defer | Valid-frames / annotation | §5 normalize stage, §7, §2 BWF | Wire only when BWF quality is in scope |
| **suggestion** | defer | Analyze | §10 | After detect is stable |

---

## MVP ordered punch list (pipeline order)

1. **Catalog:** freeze one BWF id algorithm; fix docs; don’t invent ids in annotate.  
2. **Upload:** fix annotate env targeting; keep cdn-access user path.  
3. **Ingest:** ship as-is; add CORS if browser-direct.  
4. **Queue:** ~~wire dispatch schedule~~ (done; set Vault secrets).  
5. **Dispatch/invoke:** fix long-poll retry so GPU jobs cannot double-run.  
6. **Presign/CDN:** prod CORS; optional LIST prefix guard.  
7. **Normalize:** upload retries; defer valid_frames.  
8. **Detect:** `POSE_PIPELINE=serial` default + image ENV; stream JSON upload.  
9. **Ready:** accept detect-terminal; defer analyze.  
10. **Delivery:** BWF path or user-only MVP.  
11. **Ops/web:** freeze manage feature growth and web scaffold.

---

## Module index (quick jump)

| Pipeline step | Paths |
|---------------|--------|
| 1 Catalog | `workers/github/match-data/*` |
| 2 Upload / annotate | `scripts/annotate_and_ingest.py`, `supabase/functions/cdn-access/` |
| 3 Ingest | `supabase/functions/matches-ingest/` |
| 4 DB / queue | `supabase/migrations/20260712000000_init_match_pipeline.sql` |
| 5 Jobs edge | `supabase/functions/jobs/` |
| 6 CDN control | `workers/cloudflare/cdn/src/index.ts` |
| 7 Normalize | `workers/vast/video-normalization/` |
| 9 Detect | `workers/vast/video-det/` |
| 11 Delivery | CDN data plane + `cdn-access` |
| 12 Ops / UI | `scripts/manage.py`, `apps/web/` |

---

*Generated from full-repo code review. No code changes were made as part of that review.*
