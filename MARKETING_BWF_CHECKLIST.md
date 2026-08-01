# Marketing + BWF — tracked checklist

**Scope:** public marketing (`apps/web` `(marketing)` routes) + live BWF catalog.  
**Out of scope:** `/dashboard/*` workspace productization.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` deferred / N-A  
Last updated: 2026-08-01 (bucket 1 implementation started)

---

## Bucket 1 — blockers (current focus)

| ID | Item | Status | Notes |
|----|------|--------|--------|
| A1 | Mobile marketing nav (hamburger / sheet) | [x] | Hamburger + drawer under 720px |
| A5/E | CTA honesty (no fake workspace funnel) | [x] | Removed marketing auth CTAs; site is BWF analysis |
| D1 | Demo media or honest empty states | [x] | Empty media slot until assets added |
| F3.1 | Don’t ship full player directory to client | [x] | Server-paged players; H2H seed + remote typeahead |
| F3.4 | Rate-limit / protect `GET /api/bwf/search` | [x] | 60/min per IP; same on `/api/bwf/players` |
| H1 | Env docs for BWF (`.env.example` + web README) | [x] | `apps/web/.env.example` + README |

### Decisions (2026-08-01)

1. **CTAs:** Removed auth funnel; site is **BWF match analysis**.
2. **Media:** Empty slots until assets under `public/media/`.

---

## A. Site chrome

- [x] **A1** Mobile nav
- [ ] **A2** Desktop nav polish (active/focus)
- [x] **A3** Footer — Careers/Status stubs removed; product → BWF
- [x] **A4** Footer social hidden until real URLs
- [x] **A5** CTA strategy — removed; BWF-first
- [ ] **A6** No invalid `Link` > `Button` nesting on marketing
- [ ] **A7** Brand assets / favicon / OG image
- [ ] **A8** Root SEO metadata template
- [ ] **A9** Legal claims match shipped product

## B. Home

- [x] **B1** Hero copy matches what ships
- [x] **B2** Hero/demo media empty state
- [ ] **B3** Feature demos labeled preview
- [x] **B4** CTAs retargeted to BWF
- [ ] **B5** Paths to features / pricing / blog / BWF
- [ ] **B6** Mobile layout ~390px
- [ ] **B7** Reduced-motion still OK

## C. Marketing pages

- [ ] Pricing honest tiers + CTAs
- [ ] About + working contact path
- [ ] Blog listing + posts SEO
- [ ] Changelog matches reality
- [ ] Docs — real sections or slim “coming soon”
- [ ] Privacy honesty
- [ ] Terms honesty
- [ ] Feature: video-analysis (preview + CTA)
- [ ] Feature: highlights (no dashboard CTA)
- [ ] Feature: dashboard (roadmap only)
- [ ] Feature: BWF → live catalog
- [ ] Feature: replay (preview + CTA)

## D. Demos & media

- [x] **D1** Empty media until assets
- [ ] Demos labeled illustrations
- [ ] No broken images
- [ ] Demo LCP (lazy video / posters)

## E. Auth entry (without dashboard product)

- [x] Decision applied site-wide (no marketing auth CTA)
- [ ] No “account ready → dashboard” theater if Auth not real

## F. BWF product

### Routes

- [ ] `/bwf` home polish
- [ ] `/bwf/matches` filters/empty/mobile
- [ ] `/bwf/matches/[id]` detail + YouTube + errors
- [ ] `/bwf/players` (payload + UX)
- [ ] `/bwf/players/[id]` profile + homonym caveat
- [ ] `/bwf/h2h` picker at scale
- [ ] Shell search a11y + errors

### Data honesty

- [ ] F2.1 Service-role env fail-closed
- [ ] F2.2 `owner_id IS NULL` on catalog queries
- [ ] F2.3 Home board copy “min N decided”
- [ ] F2.4 Homonym caveat
- [ ] F2.5 Form sort / sparse dates
- [ ] F2.6 Doubles rivals label or fix
- [ ] F2.7 Round filter aliases
- [ ] F2.8 YouTube allowlist UX
- [ ] F2.9 Player image nulls safe

### Scale

- [x] **F3.1** Client directory payload
- [ ] F3.2 Cache docs match process-local TTL
- [ ] F3.3 Year-scope plan if RAM hurts
- [x] **F3.4** Search rate limit
- [ ] F3.5 Cap huge H2H meeting lists
- [ ] F3.6 Tournament combobox at scale

### Quality

- [ ] Loading/error consistency
- [ ] Mobile cards/filters
- [ ] Keyboard / SR on shell search
- [ ] Metadata per BWF route
- [ ] Tests + smoke path

## G. Claim audit

- [ ] Soft-pedal unbuilt analysis/reels/billing as “available now”
- [ ] Feature availability labels
- [ ] Changelog honesty
- [ ] Pricing honesty
- [ ] Support path not via mock dashboard

## H. Ship ops

- [x] **H1** Env docs
- [ ] Build + typecheck
- [ ] Prod smoke `/`, `/bwf`, match, player
- [ ] Mobile screenshots home + BWF
- [ ] README/ARCHITECTURE: marketing + BWF real; dashboard deferred
- [ ] `server-only` on catalog
- [ ] robots / indexing check

## Explicitly not this milestone

- Real dashboard / library / analysis / highlights / settings / billing
- Upload → CDN → jobs from web
- Real Auth (unless chosen instead of waitlist)
- Calibration / video-analysis / replay as full products
- BWF processed media via cdn-access (YouTube OK for catalog MVP)
- Pipeline GPU P0s
