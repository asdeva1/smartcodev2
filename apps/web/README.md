# @smartcode/web

Next.js (App Router) + Material UI frontend, deployed on Vercel (`vercel.json`, root directory `apps/web`).

## What exists (Phase 1)

- SmartCode theme from the logo's colours; Lexend (headings) and IBM Plex Sans (UI), self-hosted.
- `BrandLogo` — the official logo synced from `packages/brand` to `/brand` at dev/build time. On dark surfaces it sits in a light container (there is no official dark logo).
- Pages: landing (`/`), sign-in (`/login`), branded 404, error boundary, and a workspace shell preview (`/manager`, not served in production until authentication ships in Phase 3).
- `AppShell` with role-aware navigation generated from the shared permission matrix.
- Security headers (CSP limited to self + the configured API origin, HSTS, frame denial).
- Public configuration only (`NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`); no secrets.

Tests: Vitest + Testing Library (`test/`).
