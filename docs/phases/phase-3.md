# Phase 3 — Authentication + Employee Directory

Status: **complete, awaiting approval** (2026-10-07). Branch: `develop`.

## Decisions recorded

- **Login Name eligibility (final).** Eligible: Coder, Auditor, Team Lead, Group Coach/SME. Manager (uses the Manager account and dashboard), HR and Vendor Admin do not receive one. A Login Name is an operational identifier; authentication is always **email + password**. Only an ACTIVE employee can hold one; at most one active name per employee and one active employee per name. Assigning, changing, releasing and the CSV import are **Manager-only**.
- **Eligibility lives in the database** (trigger), not only in code, so no path can bypass it. A role change to an ineligible role ends the active assignment with reason `ROLE_CHANGED` (history kept). Deactivation ends it with its own reason.
- **Statuses.** PENDING_ACTIVATION, ACTIVE, INACTIVE. `LOCKED` stays in the enum but is unused: lockout is a property of the credential. Reactivation returns a person to PENDING_ACTIVATION so they choose a new password through a fresh link.
- **Tokens never travel in API responses.** Activation and reset links exist only inside the email (and, for local development, `bootstrap:manager --print-link`, refused when deployed).
- **Failure to send an email never fails a committed operation**; the API reports `emailed: false` and the Manager can resend.
- **CSV is stateless**: preview writes nothing; commit re-validates.
- **Login throttle is in-memory per API task** (failures only, per email+IP and per IP). The shared store arrives with Redis; the database credential lock (5 failures → 15 min) is authoritative across tasks.

## Database changes

| Migration                                | Content                                                                                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261009000000_login_name_role_changed` | `ROLE_CHANGED` added to `LoginNameEndReason` (own migration: an enum value cannot be used in the transaction that adds it)                                                             |
| `20261009000100_login_name_eligibility`  | Triggers + functions: eligibility on assignment (ACTIVE + eligible role), role-change handling (before/after), last-active-Manager guard (no demote/deactivate/delete of the last one) |

`schema.prisma` mirrors the enum change. 50 triggers / 29 functions now verified by `db:verify`.

## API

See `docs/05-api-specification.md` §4 for the 30 endpoints. New modules: `core/mail`, `core/auth` (sessions, tokens, CSRF, throttle), `core/bootstrap`, `modules/auth`, `modules/employees` (employees, login names, CSV imports, options).

## RBAC changes

New permissions `employee.sendActivation`, `employee.triggerPasswordReset`, `employee.changeRole` (Manager-only), `loginName.read`, `loginName.assign` (Manager-only). HR: read/update only. Vendor Admin: employee permissions at VENDOR scope, no role change, no Login Names. Out-of-scope records are 404, never 403. Every route is tested against all seven roles.

## Authentication flow

Bootstrap (pending Manager → emailed link → Manager chooses password → ACTIVE) → sign-in (`sc_at` 15 min, rotating `sc_rt`, `sc_csrf`) → every request re-checks session + ACTIVE + role/vendor in PostgreSQL → logout/deactivation/password change/role change take effect on the next request. See `docs/06-authentication.md` §6.

## Web

`/login`, `/account/activate`, `/account/forgot-password`, `/account/reset-password`, `/manager`, `/manager/employees` (Directory tab and, for the Manager, a Login Names tab). `apiFetch` sends the CSRF header and refreshes an expired session once, silently. The Directory is the only employee-creation surface.

## Tests

| Layer                                    | Tests                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/shared` (Vitest)               | 86 (password policy, CSV reader, Phase 3 RBAC added)                                                 |
| `packages/email-templates`               | 5                                                                                                    |
| `packages/brand`, `infra`                | 14, 15                                                                                               |
| `apps/web` (Vitest + RTL)                | 58                                                                                                   |
| `apps/api` unit                          | 72                                                                                                   |
| `apps/api` integration (HTTP + Postgres) | 240 (auth lifecycle 47; Directory/RBAC/vendor isolation/Login Names/CSV 193 incl. all-7-role matrix) |
| `apps/api` database (real migrations)    | 101 (Phase 2’s 92 + 9 for eligibility, role change, last Manager)                                    |
| Playwright                               | 23 passed, 9 skipped (lifecycle runs on desktop only)                                                |
| **Total (excluding Playwright)**         | **591**                                                                                              |

## Running the end-to-end suite

`DATABASE_ADMIN_URL=postgresql://… apps/e2e/scripts/run-e2e.sh` — recreates a throw-away database, applies migrations, seeds, bootstraps the Manager, starts the built API (file mail transport) and web app, runs Playwright and stops both. `E2E_USE_PSQL=1` applies migrations with psql where the Prisma schema engine cannot be downloaded.

## Environment limitations (sandbox only)

- The Prisma schema engine cannot be downloaded here, so migrations were applied with `psql` + `_prisma_migrations` checksums; `prisma migrate deploy/status/diff` were not run locally. CI runs all of them and the schema-parity test stands in locally.
- Docker is unavailable; the API container image and CDK synth are verified in CI.
