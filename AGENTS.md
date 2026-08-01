# Mintonix — Agent & contributor guide

This file is the **default instruction set** for coding agents and humans
working in this monorepo. System design and trust model live in
[ARCHITECTURE.md](./ARCHITECTURE.md) and [SUPABASE.md](./SUPABASE.md). This
document owns **how we organize code** and **how agents should edit**.

**Read order for agents**

1. § Agent rules (short) — follow these on every change
2. § File organization guide — when deciding where code goes or whether to split
3. Package notes that match your task (`apps/web`, `supabase`, `workers`)
4. Domain docs only as needed (`ARCHITECTURE.md`, `SUPABASE.md`, module READMEs)

---

## Agent rules (short)

Language: **must** / **must not** = blocking. **prefer** / **avoid** = default
with judgment. When unsure, choose the option that is easier to delete later.

### Must

1. **Must** put new code next to its only caller when it is single-use (same
   file or same feature folder). Do not create a new shared module for one
   consumer.
2. **Must** extract a shared helper only when a second real call site exists
   (or is landing in the same change). Speculative reuse is not a reason to
   split.
3. **Must** keep pure logic (parse, score, filter, geometry) separable from
   I/O (DB, network, filesystem) when the pure part is worth unit testing —
   that split is a domain boundary, not ceremony.
4. **Must** respect the trust model in ARCHITECTURE.md: B2 keys only in the
   CDN worker; GPU workers get presigned URLs + callback tokens only; no
   service-role or pipeline secrets in client bundles.
5. **Must** keep `import "server-only"` (or equivalent) on modules that use
   service role / secrets. Never expose service-role material via
   `NEXT_PUBLIC_*` or client imports.
6. **Must** match existing naming and folder patterns in the area you touch
   rather than inventing a parallel layout.
7. **Must** run or add tests for pure domain changes when a suite already
   exists next to that code (e.g. `apps/web/lib/bwf/*.test.ts`).

### Must not

1. **Must not** split a file only because it is “long.” Length alone is not a
   smell if the module is cohesive.
2. **Must not** introduce base classes, generic “utils,” or `packages/shared`
   for a single implementation.
3. **Must not** add abstraction layers (repository interfaces, DI containers,
   plugin systems) without two real implementations or a proven need.
4. **Must not** reorganize unrelated files in the same change as a feature or
   fix. No drive-by refactors.
5. **Must not** invent new match-ID algorithms or B2 key shapes; use the
   contracts in SUPABASE.md.
6. **Must not** wire fake product affordances that look production-ready
   without labeling them demo/preview when the backend is not real (auth,
   billing, save, delete).

### Prefer

1. **Prefer** one larger feature file over many tiny files that are only
   imported once.
2. **Prefer** thin route/entry files (`page.tsx`, edge `index.ts` router) that
   mount a cohesive feature module.
3. **Prefer** duplicating 5–15 lines over a wrong shared abstraction.
4. **Prefer** package-local helpers over monorepo-wide packages until the same
   contract is enforced in two runtimes (e.g. TS edge + Python worker) *and*
   has drifted or is about to.
5. **Prefer** updating docs that agents rely on when behavior changes
   (this file, ARCHITECTURE, SUPABASE, module issue lists in README).
6. **Prefer** fixing correctness, security, cost, and false UX over folder
   aesthetics.

### Avoid

1. **Avoid** deep barrel files that re-export everything and blur server/client
   boundaries.
2. **Avoid** “utils.ts” dumping grounds; name by domain (`parse`, `query`,
   `youtube`).
3. **Avoid** micro-components for one-off markup (extra files with no reuse).
4. **Avoid** rewriting working procedural edge/worker code into frameworks or
   class hierarchies.

---

## File organization guide

### North star

> **Colocate by use. Split by real boundary. Abstract on the second use.**

We optimize for **readability of the change you are making**, not for a
textbook folder tree. A 500-line module that does one job is better than ten
50-line files that only call each other once.

### When to keep code in one file

Keep helpers, types, and small subcomponents **in the same file** when:

| Condition | Example |
|-----------|---------|
| Only one feature uses them | A panel used only inside that feature’s app shell |
| They are steps of one algorithm | Parse → normalize → score in one pure module |
| Splitting would force noisy cross-imports | Context + actions for one wizard |
| The reader needs the whole story in one place | Edge function request handling for one route group |

**In-file structure (suggested order)**

1. Imports  
2. Types / constants  
3. Pure helpers  
4. Main export(s)  
5. Single-use subcomponents or private classes last  

You do **not** need a separate file per function or per React component.

### When to split into another file

Split when **at least one** of these is true:

| Boundary | Why |
|----------|-----|
| **Second call site** | Shared UI primitive or helper used in 2+ features |
| **Server vs client** | `"use client"` / `server-only` / edge vs browser |
| **Pure vs I/O** | Unit-testable logic vs Supabase/fetch/fs |
| **Deploy unit** | Different package, worker image, or edge function |
| **Public product surface** | Stable API you intentionally expose |
| **Unrelated lifecycle** | e.g. marketing demo vs live catalog query |

If none apply, **do not split**.

### When *not* to split (common agent mistakes)

- “This file is over 300 lines” → irrelevant if cohesive  
- “Clean Architecture says interfaces go in `/domain`” → not our default  
- “I’ll put this in `lib/utils` for later” → later rarely comes; colocate  
- “Each component in its own file is best practice” → only when reused or
  heavy enough to own a real UI boundary  
- “Workers should share an abstract BaseWorker” → two stages can stay
  copy-paste-similar with mirrored tests  

### Abstraction policy

| Situation | Action |
|-----------|--------|
| One implementation | Inline or single module; no interface |
| Two implementations with the same contract | Extract shared helper or type |
| Same bug fixed twice because of copy-paste | Extract |
| TS and Python both parse the same envelope and have drifted | Consider `packages/shared` *or* golden fixtures; don’t invent a package “just in case” |
| “We might need plugins” | Don’t |

**Rule of thumb:** the cost of a wrong abstraction is higher than the cost of
duplication we can still see.

### Feature layout (web)

Default pattern under `apps/web`:

```text
app/<route>/page.tsx          # thin: metadata + mount feature
components/<feature>/*        # UI for that product area
lib/<domain>/*                # data, pure logic, fixtures for that domain
```

- **Thin pages** — routing and metadata only when possible.  
- **Feature folders** — group by product area (`bwf`, `calibration`,
  `highlights`), not by technical layer alone (`containers/`, `hooks/` at repo
  root).  
- **`components/ui`** — only truly shared primitives (button, tabs, shell).  
- **Domain `lib/`** — types + pure functions + server I/O for that domain.

Mocks and fixtures live next to the domain they fake (`lib/matches/fixtures.ts`),
not in a global grab-bag unless they are cross-domain content.

### Backend layout (supabase)

```text
supabase/migrations/          # ordered SQL; source of truth for schema
supabase/functions/<name>/    # one deployable function per folder
```

- Prefer **procedural** handlers in a small number of files per function.  
- Shared constants used by one function stay in that function’s folder.  
- SQL RPC contracts are documented in SUPABASE.md; don’t invent parallel
  write paths from the client.

### Workers layout

```text
workers/cloudflare/cdn/       # only place with B2 credentials
workers/github/match-data/    # catalog scrape + load (no GPU enqueue by default)
workers/vast/<stage>/         # GPU stages: thin server entry + job body
```

- One clear entrypoint per runtime (`src/index.ts`, `server.py`).  
- Keep accept → download → process → upload → callback readable as a linear
  story.  
- Critical contracts (callback URL allowlist, download retry, error redaction)
  must not drift across stages — either share carefully or **duplicate with
  tests** until a real shared package is justified.

### Tests

| Kind | Placement |
|------|-----------|
| Pure unit tests | `*.test.ts` / `test_*.py` next to the code or in the same package |
| Contract tests | Next to the worker/function that owns the contract |
| Fixtures | Next to the domain; name honestly (`fixtures`, not `mock-data` for mixed content) |

Do not create a top-level `__tests__` tree that orphans tests from their
modules unless a runner forces it.

### Naming

- **Domain words over architecture words:** `parse.ts`, `catalog.ts`,
  `match-by-id.ts` — not `entities.ts`, `dataAccess.ts`, `manager.ts`.  
- **Feature app shells:** `*-app.tsx` for client product surfaces mounted from
  a page.  
- **Avoid** `helpers.ts`, `misc.ts`, `common.ts` unless the scope is tiny and
  local.

---

## Good and bad examples in this repo

### Good (prefer patterns like these)

| Path | Why it fits |
|------|-------------|
| `apps/web/lib/bwf/query.ts` (~500 lines) | Cohesive pure catalog/query helpers; size is fine |
| `apps/web/lib/bwf/catalog.ts` | I/O + cache only; separate from pure query/parse |
| `apps/web/lib/bwf/parse.ts` + `parse.test.ts` | Pure boundary with real tests |
| `apps/web/lib/bwf/match-by-id.ts` | Small pure decision matrix extracted *because* tests own the contract |
| `apps/web` thin `app/bwf/**/page.tsx` + `components/bwf/*` | Route vs presentation split without over-fragmenting views |
| `apps/web/components/calibration/*` | Wizard split by **real UI surfaces** (canvas, panels, transport), not one file per hook |
| `supabase/functions/jobs/index.ts` | Procedural dispatch/callback in one deployable; no fake layers |
| `workers/cloudflare/cdn/src/index.ts` | Single worker entry for control + data plane |
| Vast stage layout (`server.py` + `job` modules) | Linear stage story; no abstract BaseWorker |

### Acceptable tensions (do not “clean up” without cause)

| Path | Note |
|------|------|
| `apps/web/components/calibration/calibration-context.tsx` (very large) | Single wizard monostate; prefer clarity over splitting unless a second wizard appears |
| Duplicated `timingSafeEqual` across edge functions | Prefer mirrored snippets until a third copy or real drift forces a share |
| Missing `packages/shared` | Intentional until TS/Python contracts need one source of truth |

### Bad patterns (do not add more of these)

| Pattern | Why |
|---------|-----|
| New `lib/utils/index.ts` kitchen sink | Becomes unowned dumping ground |
| `packages/shared` with one consumer | Premature monorepo package |
| One React component per file when only used once in a parent | Navigation overhead, no reuse |
| Interface + single implementation “for testability” | Tests can use the real function |
| Renaming/moving files in a feature PR “while here” | Review noise, blame noise |
| Client barrel that re-exports server catalog APIs | Boundary leak risk |
| Second match-id scheme in a script or annotator | Breaks B2 prefix / catalog identity |

### Demo vs real product surfaces (web)

On `feat/website-func` and similar branches:

| Real data | Demo / fixture UI |
|-----------|-------------------|
| `/bwf/*` catalog via server service role | `/dashboard/*`, auth, settings billing |
| `GET /api/bwf/search` | calibration, video-analysis, replay (local/demo) |

**Prefer** honest labeling (preview/demo) over fake success paths. **Must not**
imply accounts, billing, or persistence that do not exist.

---

## Monorepo map

```text
apps/web/                 Next.js product + marketing + BWF UI
supabase/                 Migrations + edge functions
workers/cloudflare/cdn/   B2 delivery + presign (secrets)
workers/github/match-data BWF metadata scrape → Supabase
workers/vast/             GPU normalize + detect stages
scripts/                  Ops helpers
ARCHITECTURE.md           System design + trust model
SUPABASE.md               Schema, RPCs, catalog ACL
AGENTS.md                 This file — code organization + agent rules
README.md                 Product overview + module issue trackers
```

---

## Package notes

### `apps/web`

- Stack: Next.js App Router. **This is not the Next.js from old training data** —
  check `node_modules/next/dist/docs/` before using legacy APIs; heed deprecations.
- BWF catalog: `lib/bwf/catalog.ts` is server-only + service role; always filter
  `owner_id IS NULL` for system matches.
- Prefer extending `components/<feature>` and `lib/<domain>` over new top-level
  trees.
- Shared chrome: `components/ui`, `components/app`, marketing under
  `components/marketing`.

Local pointer file: [`apps/web/AGENTS.md`](./apps/web/AGENTS.md) redirects here.

### `supabase`

- Migrations are append-only history; don’t rewrite applied files casually.
- Edge functions: keep auth checks and CAS/token rules explicit in the handler.
- Ops/stage artifact names must match what workers actually write (avoid
  doc/code drift like wrong CSV filenames in purge lists).

### `workers`

- CDN worker is the **only** B2 key holder.  
- Match-data IDs: `sha256(match_key)` per SUPABASE.md — golden tests are
  welcome; silent key format changes are not.  
- New GPU stages should copy the trust envelope (presign in, callback out),
  not gain credentials.

---

## How to decide in 30 seconds

```text
Is it used in only one place?
  yes → keep it in that file/folder
  no  → is it a server/client or pure/I/O boundary?
          yes → split on that boundary
          no  → extract shared helper with a domain name

Are you about to add an interface/base class/package?
  one impl → stop
  two impls or real drift → extract

Are you splitting because the file is long?
  cohesive → leave it
  multiple unrelated jobs → split by job, not by line count
```

---

## Related docs

| Doc | Contents |
|-----|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Trust model, pipeline, storage, high-level rationale |
| [SUPABASE.md](./SUPABASE.md) | Tables, RPCs, RLS, IDs, catalog access |
| [README.md](./README.md) | Product summary + per-module issue trackers |
| Module READMEs under `workers/**` | Deploy and stage-specific detail |

When this guide and ARCHITECTURE.md disagree on **folder taste**, this file
wins. When they disagree on **security or data contracts**, ARCHITECTURE.md /
SUPABASE.md win.
