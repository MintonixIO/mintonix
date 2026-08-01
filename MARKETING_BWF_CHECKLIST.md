# Marketing + BWF — tracked checklist

**Scope:** public marketing + live BWF catalog.  
**Out of scope:** `/dashboard/*` productization.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` deferred  
Last updated: 2026-08-01 (remaining issues batch)

### Product decisions

1. **CTAs:** No auth funnel; site is **BWF match analysis**.
2. **Media:** Empty slots until assets under `public/media/`.
3. **Private tools:** Feature pages for dashboard/highlights/etc. are **roadmap**, not live.

### Bucket 1 (done)

| ID | Item | Status |
|----|------|--------|
| A1 | Mobile marketing nav | [x] |
| A5/E | CTA honesty | [x] |
| D1 | Empty demo media | [x] |
| F3.1 | Server-paged players / slim H2H | [x] |
| F3.4 | Search rate limits | [x] |
| H1 | Env docs | [x] |

### Bucket 2 — remaining (this pass)

| ID | Item | Status | Notes |
|----|------|--------|--------|
| A2 | Desktop nav polish | [x] | Focus rings already on links; CTA chrome removed |
| A6 | No `Link`>`Button` nesting (marketing) | [x] | `Button href` + feature/pricing fixes |
| A7 | Favicon / OG image | [x] | logomark + logo-full OG |
| A8 | SEO metadata template | [x] | Root OG/Twitter + BWF route titles |
| A9 | Legal honesty | [x] | Scope banners on privacy/terms |
| B3 | Demos labeled preview | [x] | Illustration labels + roadmap banners |
| B5 | Paths to product areas | [x] | Home pillars + footer → BWF |
| B6 | Mobile ~390px | [x] | Nav drawer, BWF shell wrap, padding |
| B7 | Reduced motion | [x] | Nav + residual CSS |
| C-pricing | Pricing honesty | [x] | Free BWF + future plans copy |
| C-about | Contact works | [x] | mailto draft form |
| C-blog | Blog SEO | [x] | Listing metadata |
| C-changelog | Changelog reality | [x] | v0.9 BWF release first |
| C-docs | Docs stubs | [x] | Slim BWF-only docs page |
| C-privacy | Privacy honesty | [x] | Scope banner |
| C-terms | Terms honesty | [x] | Scope banner |
| C-features | Feature pages roadmap/live | [x] | Banners + BWF CTAs |
| D-demo | Demos labeled / empty | [x] | |
| E-auth | Auth theater | [x] | Preview banner; done → BWF |
| F-routes | BWF route polish | [x] | Metadata, mobile shell, search a11y |
| F2.1 | Fail-closed env | [x] | Catalog errors + missing key path |
| F2.2 | owner_id filter | [x] | Already enforced in catalog |
| F2.3 | min decided copy | [x] | Home boards |
| F2.4 | Homonym caveat | [x] | Home + profiles |
| F2.5 | Form date note | [x] | Profile copy |
| F2.6 | Doubles rivals note | [x] | Profile rivalries |
| F2.7 | Round filter | [-] | Exact match OK; alias table deferred |
| F2.8 | YouTube allowlist UX | [x] | Detail already omits non-YT |
| F2.9 | Player images null-safe | [x] | Avatar handles missing src |
| F3.2 | Cache docs | [x] | README + catalog comments |
| F3.3 | Year-scope plan | [x] | Documented YEAR-SCOPE in catalog |
| F3.5 | H2H meeting cap | [x] | Cap 50 |
| F3.6 | Tournament filter scale | [x] | Input + datalist typeahead |
| F-quality | Search a11y / mobile | [x] | aria-labels + wrap |
| G-claims | Claim audit | [x] | Roadmap banners + docs/pricing |
| H-build | Tests | [x] | Unit tests green |
| H-docs | README/ARCHITECTURE | [x] | Public product section |
| H-smoke | Live env smoke | [-] | Needs Supabase secrets in deploy env |
| H-screens | Mobile screenshots | [-] | Manual / later |
| H-server-only | server-only catalog | [x] | Already `import "server-only"` |

## Explicitly not this milestone

- Real dashboard / library / analysis / highlights / settings / billing
- Upload → CDN → jobs from web
- Real Auth
- Calibration / video-analysis / replay as full products
- BWF CDN processed media (YouTube OK)
- Pipeline GPU P0s
- Round-string alias matrix (F2.7 deferred)
