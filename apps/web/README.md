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
| App shell | `/dashboard`, `/library`, `/analysis`, `/highlights`, `/settings`, `/help-support`, `/compare` |
| Tools | `/bwf`, `/video-analysis`, `/calibration` |

## Design tokens

Tokens live in `styles/tokens/` and component CSS in `styles/components.css`, imported from `app/globals.css`. Brand blue is `#3693FF` on dark navy surfaces.
