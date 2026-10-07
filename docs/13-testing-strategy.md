# 13 — Testing Strategy

Status: **Approved (Phase 0)** — final decisions applied

## 1. Layers

| Layer                          | Tool                                              | Runs against                                            | What it covers                                                                                   |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Static                         | TypeScript strict, ESLint, Prettier, gitleaks     | source                                                  | Types, lint, formatting, secrets                                                                 |
| Shared logic unit              | Vitest                                            | `packages/shared`                                       | State machines (every allowed/denied transition), permission matrix, zod schemas, CPH formula    |
| Backend unit                   | Jest (NestJS testing module)                      | services with mocked repositories                       | Business rules per module                                                                        |
| Backend integration / database | Jest + **real PostgreSQL** (Docker service in CI) | API + Prisma + migrations                               | Repositories, transactions, partial unique indexes, triggers, migrations apply cleanly from zero |
| RBAC                           | Jest, generated from `packages/shared/rbac`       | HTTP layer (Supertest)                                  | **Every route × every role** → allowed / 403 / 404; deny-by-default check                        |
| Vendor isolation               | Jest integration                                  | HTTP layer                                              | Two vendors seeded; zero cross-visibility on every list/detail/report/export                     |
| Frontend component             | Vitest + React Testing Library                    | components                                              | Forms, validation messages, tables, wizard steps, empty/loading/error states                     |
| Frontend page                  | Vitest + RTL + **MSW**                            | pages with mocked API                                   | Role-based navigation, page behaviour                                                            |
| API contract                   | OpenAPI diff in CI                                | generated spec                                          | Breaking-change detection between web client and API                                             |
| E2E                            | **Playwright**                                    | full stack (docker compose in CI; staging after deploy) | The business workflow below                                                                      |
| Smoke                          | Node script                                       | staging / production URLs                               | Health, login page, auth & RBAC negative checks                                                  |
| Accessibility                  | axe (Playwright)                                  | key pages                                               | WCAG 2.1 AA basics                                                                               |

Database test project (Phase 2): `pnpm test` in `apps/api` runs a Jest `database` project (`test/db/**/*.db-spec.ts`). Each spec creates its own PostgreSQL schema and replays the real migration SQL, so tests exercise the actual constraints and triggers. Without `DATABASE_URL` the suite skips locally; CI sets `REQUIRE_DATABASE_TESTS=1` so a missing database fails the build. A parity test compares `schema.prisma` with the migrated database (CI also runs `prisma migrate diff`).

## 2. Mandatory E2E workflow (must pass before production)

```
Create employee → Activate account → Login → Create vendor → Create client → Create project
→ Import charts → Allocate login name → Allocate chart → Coder production → Submit coded chart
→ Auditor audit → Review Required → Manager resolution (REJECTED) → Rework → Re-audit → Completion
```

Plus negative steps inside the same run: Team Lead tries to resolve the review → 403; Vendor B admin cannot see Vendor A's employee or chart; second allocation of the same chart is rejected.

Emails in E2E are captured by Mailpit and the activation/reset links read from there — exercising the real token flow.

## 3. Test data

- Tests create their own data through factories (`apps/api/test/factories`); no shared fixtures leaking between tests.
- Integration DB is migrated from zero on each CI run (proves migrations work on an empty database — the same path production takes).
- **No fake/demo business data in any seed.** Staging E2E data is created by the tests and cleaned up per run.
- **Synthetic, non-PHI data only** (D-05) in fixtures, sample CSVs, screenshots, logs and every non-production database. Test chart IDs use an obviously synthetic pattern (`TEST-CHART-0001`); names/emails use `example.test`.

## 4. Quality gates (CI blocks merge)

- lint, typecheck, unit, integration, RBAC, vendor-isolation, web tests, build: all green.
- Coverage: ≥ 80 % lines on `packages/shared` and API services; 100 % of state-machine transitions.
- No skipped/`.only` tests on `develop`/`main`.
- E2E green on staging before the production workflow can be approved.

## 5. End-of-phase report (every phase)

Test results · lint · typecheck · build · changed files · database changes (migrations + why) · deployment impact.

## 6. Phase 3 additions

- `apps/api/test/auth-lifecycle.int-spec.ts` and `employee-directory.int-spec.ts` run the real application over HTTP against PostgreSQL built from the real migrations (schema-per-spec), with the in-memory mail transport: bootstrap, activation, sign-in, logout, refresh rotation and reuse detection, deactivation revocation, reset, change password, token expiry/reuse, secret hygiene, the all-roles RBAC matrix, vendor isolation, Login Name rules, role changes, both CSV imports and CSRF.
- `apps/web/test/auth-and-directory.test.tsx`: CSRF header, silent refresh, session gate, activation/reset/forgot pages, directory columns and role-aware actions, CSV dialog.
- `apps/e2e/tests/auth-lifecycle.spec.ts`: the whole lifecycle in a browser. `apps/e2e/scripts/run-e2e.sh` creates a throw-away database, bootstraps the Manager, starts the built API (file mail transport) and web app, and runs Playwright; the tests read activation/reset links from the mail outbox exactly as a person would from their inbox.
