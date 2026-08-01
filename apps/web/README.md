# Mintonix web

Next.js (App Router) + Tailwind CSS v4 implementation of the Mintonix design system and marketing/app surfaces.

## Stack

- **Next.js 16** App Router, React 19
- **Tailwind CSS v4** + design tokens from Claude Design export
- **Lucide** icons
- Design system components under `components/ui` and `components/charts`

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

| Area | Paths |
|------|--------|
| Marketing | `/`, `/pricing`, `/about`, `/blog`, `/docs`, `/changelog`, `/features/*`, `/privacy`, `/terms` |
| Auth | `/auth` |
| App shell | `/dashboard`, `/dashboard/library`, `/dashboard/analysis`, `/dashboard/highlights`, `/dashboard/settings`, `/dashboard/help-support`, `/dashboard/compare` |
| Tools | `/bwf`, `/video-analysis`, `/calibration` |

## Design tokens

Tokens live in `styles/tokens/` and component CSS in `styles/components.css`, imported from `app/globals.css`. Brand blue is `#3693FF` on dark navy surfaces.

## Environment (BWF catalog)

Copy `.env.example` to `.env.local`:

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | BWF catalog reads (`lib/bwf/catalog.ts`, `/api/bwf/*`) |

Never expose the service role with a `NEXT_PUBLIC_` prefix. Without it, BWF pages fail closed with a safe error UI.

## Product surfaces

| Surface | Status |
|---------|--------|
| Marketing (`/`, pricing, blog, features, …) | Public content / demos |
| BWF (`/bwf/*`) | **Live** catalog via service role |
| Dashboard (`/dashboard/*`) | Preview UI / fixtures (not this ship track) |

Tracked checklist: repo root [MARKETING_BWF_CHECKLIST.md](../../MARKETING_BWF_CHECKLIST.md).


## BWF catalog notes

- Server-only catalog module (`lib/bwf/catalog.ts`) uses the service role and filters `owner_id IS NULL`.
- Snapshot cache is **process-local** with a 300s TTL (Next Data Cache is too small for multi-year dumps).
- Player directory pages are server-paginated; H2H uses a slim seed + `/api/bwf/players` typeahead.
- Search APIs are rate-limited per IP (~60/min).
