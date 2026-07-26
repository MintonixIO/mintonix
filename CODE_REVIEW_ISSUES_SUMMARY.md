# Code review summary — plain language

High-level findings from the `merge-features` branch review. Technical detail lives in `CODE_REVIEW_ISSUES.md`.

**Priority:** **Must fix before ship** · **Soon after** · **Later / freeze**

---

## Bottom line

The pipeline design is mostly sound: ownership, dual-auth ingest, stage settle, and delivery tokens look intentional. Several **must-fix** issues can cause wrong data, double GPU spend, or a pipeline that never runs on its own. Product docs and code also disagree in a few places (identity, BWF delivery, detect pipeline).

---

## Must fix before ship

### 1. Match identity is inconsistent
The same real match can get **different IDs** depending on the path (catalog vs annotate vs docs). That creates duplicate rows and split storage for one match.

**What to do:** Pick one ID rule everywhere and never invent a second scheme in annotate.

### 2. Annotate / manage can hit the wrong environment
The annotate script always targets **dev**, even when manage is set to **prod**. Ops can think they are running production work while everything goes to dev.

**What to do:** Make annotate follow the selected environment; refuse ambiguous prod use.

### 3. BWF videos cannot be delivered the documented way
User-owned uploads work. Catalog (BWF) content has **no working path** through the delivery system as currently documented.

**What to do:** Either enable read access for BWF content, or re-scope MVP to user-upload-only and fix the docs.

### 4. The job queue does not run by itself
Dispatch auto-drain is scheduled in-repo (`jobs-dispatch` cron → `/jobs/dispatch`); still requires per-project Vault secrets.

**What to do:** Turn on a regular dispatch schedule (cron or external).

### 5. GPU jobs can run twice (money + races)
When the edge function times out or messages are redelivered, work can be **reclaimed and re-dispatched** while a GPU job is still running. That means double cost, racing uploads, and messy retries.

**What to do:** Treat worker acceptance as final for that attempt (async complete via callback only), and reclaim only after a real stage timeout—not on every redelivery.

### 6. Normalize uploads can waste a full encode
After a long encode, a single failed upload to storage forces a **full re-download and re-encode**. Detect already retries uploads; normalize does not.

**What to do:** Add the same upload retry/backoff used on detect.

### 7. Detect defaults to a broken product path
Default detection mode expects tooling the Docker image does **not** install, so stock jobs fail. Docs also describe a safer path than the code defaults to.

**What to do:** Default to the simpler “serial” path in code and in the image; treat the research path as non-product until proven.

### 8. Detect can blow memory on large outputs
Detection results are buffered entirely in memory before upload, which can fail on large matches.

**What to do:** Stream the upload from disk.

---

## Soon after ship

| Area | Why it matters |
|------|----------------|
| **YouTube / video linking** | Low-confidence links can attach the wrong video to a match. |
| **Wikipedia scrape cache** | Sticky CI runners can keep stale match data for a long time. |
| **CORS / browser access** | Ingest has no CORS; CDN prod allows any origin. Browser clients and private media need tighter origins in production. |
| **Normalize structure / GPU checks** | Huge single module; missing GPU scale support fails mid-job after download. |
| **Detect health / capacity** | Service can report healthy when models are missing, then fail real jobs. |
| **Shared contracts** | Promised shared fixtures/package are missing; parsers are duplicated. |

---

## Later / freeze (don’t expand)

- **Analyze stage** — schema-ready but not wired; ship with detect as terminal.
- **Valid-frames / OCR / BWF annotation quality** — not on the hot path for MVP success.
- **ReID / player masks** — optional; don’t block detect.
- **Research pose pipeline** — high ops risk; keep out of product default.
- **Manage TUI** — already a large god-file; freeze feature growth.
- **Web app scaffold** — not a real product surface yet.

---

## What is already solid

- Catalog does not enqueue GPU work by design; re-scrape does not clobber pipeline status.
- User vs system ownership is enforced at ingest/RPC; users cannot touch each other’s or system rows.
- CDN holds storage credentials; clients get short-lived tokens; upload allowlist blocks overwriting pipeline outputs.
- Job settle is careful (first terminal wins; stage advances reset attempts).
- Normalize and detect share a good cancel/callback pattern; serial detect path is the right product shape when enabled.

---

## MVP punch list (order of the pipeline)

1. One BWF match ID everywhere; fix docs; annotate never invents IDs.  
2. Annotate respects the selected env (dev/prod).  
3. ~~Wire dispatch on a schedule.~~ (done — Vault secrets per env)  
4. Stop double GPU runs (async accept + safer reclaim).  
5. Normalize upload retries.  
6. Detect: serial default + stream uploads.  
7. BWF delivery path **or** user-only MVP + honest docs.  
8. Prod CORS / origin locks.  
9. Accept detect as terminal; defer analyze and quality OCR.  
10. Freeze manage/web expansion until the pipeline is trustworthy.

---

*Plain-language summary of the full review. See `CODE_REVIEW_ISSUES.md` for locations and technical suggestions.*
