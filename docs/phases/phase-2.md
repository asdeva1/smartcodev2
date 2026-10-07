# Phase 2 — Database + Prisma + Core Data Model

Status: **complete, awaiting approval** (2026-10-07). Branch: `develop`. Database/domain foundation only — no UI.

## Migrations

| Migration                              | Content                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261008000000_core_data_model`       | 19 enums, 25 new tables, organization status/settings, indexes, validated FKs (`ON DELETE RESTRICT`)                                          |
| `20261008000100_integrity_constraints` | Partial and case-insensitive unique indexes, CHECK constraints, 14-row `chart_status_transitions`, `sc_json_has_forbidden_key` + log CHECKs   |
| `20261008000200_integrity_triggers`    | State-machine, append-only, forbid-delete/truncate, Total Errors, audit sequence/re-audit, Manager-only resolution, vendor-isolation triggers |

## Tables (26)

organizations, employees, credentials, auth_tokens, sessions, vendors, teams, team_memberships, login_names, login_name_assignments, clients, projects, project_assignments, charts, chart_status_transitions, chart_status_events, chart_allocations, production_entries, audits, audit_resolutions, reworks, notifications, approval_requests, approval_steps, activity_logs, audit_logs.

## Key constraints

- Employee ID and email unique (case-insensitive); no password on `employees`.
- Login Name unique (case-insensitive); one active per employee and one active employee per name (partial unique indexes on `login_name_assignments`).
- `UNIQUE(project_id, chart_id)` (column `chart_ref`); one ACTIVE `chart_allocations` row per chart.
- One current production version per chart; one audit per production version; one open rework per chart; rework references its audit.
- Total Errors = Audit Errors + Error Exceptions, set by trigger and guarded by CHECK.
- Audit resolution Manager-only (D-01), once per audit; audits, logs and history are append-only.
- Vendor isolation: team, lead, membership, project assignment and allocation must share the project's vendor.
- Log metadata rejects password/token/secret/PHI-like keys.

## Seed

`pnpm db:seed`: exactly one organization, idempotent. No employees, vendors, charts or passwords. The first Manager is created through the secure activation workflow in Phase 3.

## Tests

92 database tests (`apps/api/test/db`) covering required items 1–15 plus integrity, services, schema parity and seed/verify, run against real PostgreSQL 16. Unit tests cover rule-error mapping, redaction and shared transitions.

## Environment limitations (sandbox only)

- Prisma's migration/schema engine cannot be downloaded here, so migrations are hand-written in Prisma format and applied with `psql` (with `_prisma_migrations` checksums). **`prisma migrate deploy`, `migrate status`, `migrate diff` and `db:reset` have therefore not been run locally.** CI runs all of them; a schema-parity test is the local stand-in.
- Docker and Playwright browser downloads remain blocked, as in Phase 1.
