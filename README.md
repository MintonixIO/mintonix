# Mintonix

**Single-camera sports analytics for badminton.** Mintonix takes ordinary
match footage — one camera view, no special hardware — and turns it into
structured match data: shuttle tracking, player positions, and 3D analytics.
It ingests both professional BWF broadcast footage and user-uploaded videos,
runs them through a GPU processing pipeline, and serves the results to web
and mobile clients.

From a single fixed view, the pipeline recovers what normally requires a
multi-camera rig: the shuttle's 3D trajectory comes from physics-fit curves,
and player ground-plane positions come from a court homography built off
four user-clicked court corners.

## Features

- **Two ingestion paths, one pipeline** — a weekly scraper pulls BWF World
  Tour match metadata and broadcast footage; users upload their own match
  videos via presigned direct-to-storage PUTs. Both converge to the same
  canonical form and processing chain.
- **Video normalization** — every source is transcoded to a standard
  ≤1080p/30fps H.264 form, with thumbnails; BWF broadcasts additionally get
  a valid-frames-only cut (dead time removed) and an OCR score timeline.
- **Shuttle detection & tracking** — TrackNet-based per-frame shuttle
  candidates tuned for high recall.
- **Player pose tracking** — per-frame multi-person pose estimation
  (`player_id` assignment / ReID is future work).
- **Player labeling in the browser** — click a player → in-browser
  point-prompted segmentation (SlimSAM-class, no server round-trip) → attach
  a name. Labels are resolved to pose tracks during analysis.
- **3D analysis** *(planned)* — physics-fit 3D shuttle trajectories,
  homography-based player court positions, and match metrics.
- **Secure, cheap delivery** — all media is served through a token-gated
  Cloudflare CDN worker with free storage egress; GPU workers never hold
  credentials of any kind.
- **Web + mobile clients** — Next.js web app (in progress) and an Expo
  iOS/Android app (planned) sharing one Supabase identity.

---

# Architecture summary

Condensed reference; full detail in [ARCHITECTURE.md](ARCHITECTURE.md),
[supabase/README.md](supabase/README.md), and per-worker docs under
[`workers/`](workers/) (e.g.
[video-det](workers/vast/video-det/README.md),
[video-normalization](workers/vast/video-normalization/README.md),
[cdn](workers/cloudflare/cdn/README.md),
[match-data](workers/github/match-data/README.md)).
Review findings originated in [CODE_REVIEW_ISSUES.md](CODE_REVIEW_ISSUES.md).

Status legend: ✅ built · 🚧 partially built · 📐 designed, not built.

```
INGESTION            PIPELINE (queue-driven)          DELIVERY
BWF scraper ─┐       1. normalize (vast GPU) ✅       Cloudflare CDN worker ✅
User upload ─┼──▶    2. detect    (vast GPU) 🚧  ──▶  (token-gated, cached)
BWF backlog ─┘       3. analyze   (CPU)      📐         │
     │                    │                             ▼
matches/jobs rows    assets in B2, state in        Web (Next.js) 🚧
in Supabase          Postgres (pgmq queue)         Mobile (Expo) 📐
```

### Trust model (the invariant)

B2 credentials live **only** in the Cloudflare CDN Worker. Supabase edge
functions hold the JWT/HMAC secrets and service-role DB key. Vast GPU workers
hold **nothing** — they receive presigned GET/PUT URLs plus a single-use HMAC
callback token. Clients hold only the anon key + user session.

### Data model

- Two tables: `matches` (product object; `owner_id` null ⇒ BWF) and `jobs`
  (one pipeline run per match; stage advances in place). Queue is pgmq
  (`jobs_interactive` + `jobs_bulk`).
- B2 is canonical storage; keys are constructable under `users/<uid>/<match_id>/`
  or `bwf/<match_id>/` — no asset-registry table. Court geometry + player
  labels live in `annotation.json` under the match prefix.
- Clients never write the DB; writes go through service-role RPCs
  (`ingest_match`, `dispatch_next_job`, `complete_job`).

### Job contract

Every stage speaks the same envelope: presigned `source`/`outputs` URLs,
stage `params`, `callback_url` + single-use `callback_token`. The `jobs` edge
function both dispatches (queue → vast) and settles callbacks, and on settle
enqueues the next stage — the pipeline is a chain of queue messages, not a
long-lived orchestrator.

### CI/CD

Path-filtered workflows, one per artifact/runtime; PR → dev, master → prod.
Vast workers build once per commit (SHA-tagged image), test that exact image,
and promote the same digest — never rebuild between test and deploy.

---

# Module issue trackers

Issue priority: **P0** must fix before ship · **P1** soon after · **P2** later / frozen.

Format per issue: `- [ ] **P?** Short title — description. (source/refs)`
Move fixed items to the module's *Resolved* list with the fixing commit.

### supabase/ — migrations + edge functions (`cdn-access`, `matches-ingest`, `jobs`) ✅/🚧

- [ ] **P0** Double GPU dispatch — edge-function timeout / pgmq redelivery can
      reclaim and re-dispatch a job while a GPU run is still in flight (double
      cost, racing uploads). Treat worker acceptance as final for the attempt;
      reclaim only on a real stage timeout.
- [ ] **P0** BWF delivery path broken — user-owned uploads deliver fine, but
      catalog (BWF) content has no working path through `cdn-access` as
      documented. Enable BWF read access or re-scope MVP to user-upload-only.
- [ ] **P1** `matches-ingest` has no CORS headers — browser clients can't call it.
- [ ] **P1** Shared contracts not packaged — wire shapes live in ARCHITECTURE.md
      § One job contract and are mirrored by hand in TS/Python (no packages/shared).

**Resolved:**
- Dispatch auto-drain — `20260726020000_jobs_dispatch_cron.sql` schedules
  `jobs-dispatch` (every minute) → `invoke_jobs_dispatch` → `/jobs/dispatch`.
  Enqueue stays intentional (ingest / ops / stage-advance only). Requires
  Vault secrets `jobs_dispatch_url` + `pipeline_service_token` per project
  (supabase/README.md § Cron).

### workers/cloudflare/cdn — B2 delivery + `/presign` control plane ✅

- [ ] **P1** Prod CORS allows any origin — tighten to the app origins before
      private media ships.

**Resolved:** —

### workers/github/match-data — weekly BWF scrape → Supabase ✅

- [ ] **P0** Match-ID inconsistency — the same real match can get different IDs
      depending on path (catalog vs annotate vs docs), creating duplicate rows
      and split B2 prefixes. Pick one ID rule everywhere.
- [ ] **P1** Low-confidence YouTube linking can attach the wrong video to a match.
- [ ] **P1** Wikipedia scrape cache on sticky CI runners can serve stale match
      data indefinitely.

**Resolved:** —

### workers/vast/video-normalization — normalize stage ✅

- [ ] **P0** No upload retry — after a long encode, a single failed B2 upload
      forces a full re-download and re-encode. Port detect's retry/backoff.
- [ ] **P1** Missing GPU-scale support fails mid-job after download instead of
      failing fast at accept time.
- [ ] **P1** Huge single module — needs structural split (no behavior change).
- [x] **P2** Score-timeline (`scores.csv`) — **deferred / not implemented** (BWF cleaned path is court∧scoreboard cut → `normalized.mp4` + `frame_ranges.csv`).

**Resolved:** —

### workers/vast/video-det — detect stage 🚧

- [ ] **P0** Default mode is broken — default detection path expects tooling the
      Docker image doesn't install, so stock jobs fail. Default to the serial
      path in code and image; keep the research pipeline non-product.
- [ ] **P0** Memory blow-up on large outputs — `detections.json` is buffered
      fully in memory before upload. Stream the upload from disk.
- [ ] **P1** Health endpoint reports healthy with models missing, then fails
      real jobs.
- [ ] **P2** Player identity / ReID (not in product detect path; `player_id` always null)
      yet — `player_id` stays null; don't let it block detect.
- [ ] **P2** Research pose pipeline (`pose/research_pipeline.py`) — high ops
      risk; keep out of the product default.

**Resolved:** —

### workers/vast/analysis — analyze stage 📐

- [ ] **P2** Not wired — schema-ready but intentionally deferred; detect is the
      terminal stage for MVP.

**Resolved:** —

### scripts/ — `manage.py` ops TUI

- [ ] **P0** Annotate ignores the selected environment — it always targets dev
      even when manage is set to prod; ops can believe they're doing prod work.
      Make annotate follow the env selection; refuse ambiguous prod use.
- [ ] **P0** Annotate invents its own match IDs (see match-data ID issue) —
      must reuse the canonical ID rule, never mint a second scheme.
- [ ] **P2** God-file — freeze feature growth until the pipeline is trustworthy.

**Resolved:** —

### apps/web — Next.js frontend 🚧

- [ ] **P2** Scaffold only — not a real product surface yet; freeze expansion.

**Resolved:** —

### apps/mobile — Expo (iOS + Android) 📐

*(not started — no issues tracked yet)*

**Resolved:** —

### .github/workflows — CI/CD ✅

- [ ] **P1** If the repo goes public, PR jobs must switch to dry-run only
      (`wrangler versions upload`, `supabase db diff`, `--dry-run`) so fork PRs
      never run with dev secrets.

**Resolved:** —

---

## MVP punch list (pipeline order)

1. One BWF match ID everywhere; annotate never invents IDs.
2. Annotate respects the selected env (dev/prod).
3. Stop double GPU runs (async accept + safer reclaim).
4. Normalize upload retries.
5. Detect: serial default + streamed uploads.
6. BWF delivery path **or** user-only MVP + honest docs.
7. Prod CORS / origin locks.
8. Accept detect as terminal; defer analyze and OCR quality work.
9. Freeze manage/web expansion until the pipeline is trustworthy.
