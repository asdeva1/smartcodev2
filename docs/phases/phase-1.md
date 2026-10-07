# Phase 1 — Foundation

Status: **complete, awaiting approval** (2026-10-07). Branch: `develop`.

## Delivered

- pnpm workspace + Turborepo; TypeScript 6 strict presets; ESLint 10 (flat config, type-aware import rules, Next.js + React hooks rules for web); Prettier.
- `packages/shared`: roles, permission matrix (Manager-only allocation, login-name assignment and review resolution), statuses, chart and audit workflow rules (D-01/D-02), validation schemas (D-11 fields, no JCD), error codes, SPC terminology (D-16).
- `packages/brand`: untouched original logo (SHA-256 verified by test), technical crops/favicons, colour tokens, asset sync script.
- `packages/email-templates`: branded React Email layout + generic notice template.
- `apps/api`: NestJS 12 — validated config, JSON logging with request IDs and redaction, RFC 7807 errors, zod validation pipe, auth foundation (ES256 JWT, argon2id, single-use token utilities, global auth + permission guards with deny-by-default), Prisma 7 + PostgreSQL (organizations table, first migration), health/meta endpoints, helmet/CORS/rate limiting, database scripts, Dockerfile.
- `apps/web`: Next.js 16 + MUI 9 — theme, `BrandLogo`, landing, sign-in, 404/error pages, workspace shell preview with permission-driven navigation, security headers, `vercel.json`.
- `apps/e2e`: Playwright (desktop + mobile projects).
- `infra/cdk`: Network, Data, Storage, Api, Monitoring stacks with assertion tests (synth only).
- CI (`ci.yml`): migrations from empty DB + drift check, seed idempotency, db health/verify, lint, typecheck, tests, build, CDK synth, E2E, container build/run, gitleaks. `deploy-staging.yml` foundation (inert until AWS exists).

## Database changes

Migration `20261007000000_foundation_organizations`: `organizations` table (UUID PK, unique slug, time zone, timestamps). System seed: one organization (SmartClues). No business tables, no business data.

## Deployment impact

None yet — nothing is deployed. Vercel can build `apps/web` from `vercel.json`; AWS stacks synthesise but are not deployed until Phase 13.

## Environment limitations during this phase (sandbox only, not repository issues)

- Prisma's migration engine binary download (binaries.prisma.sh) is blocked in the build sandbox, so the first migration was written in Prisma's exact format and applied locally with `psql`; CI runs the real `prisma migrate deploy` and a zero-drift `prisma migrate diff`.
- Docker Hub and the Docker daemon are unavailable in the sandbox: `docker-compose.yml` was validated with `docker compose config`; the API image is built and started in CI.
- Playwright's browser download is blocked in the sandbox; E2E ran locally with an npm-distributed Chromium. CI installs Playwright's own browser.
