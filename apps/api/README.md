# @smartcode/api

NestJS API (and, from Phase 3, the background worker) for SmartCode V2. Runs on AWS ECS Fargate.

## What exists (Phase 1 + 2)

| Area                                                                                                                                              | Where                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Configuration validated at start-up (refuses to start on bad config; never prints values)                                                         | `src/core/config`                                          |
| JSON logging with request IDs and redaction (pino)                                                                                                | `src/core/logging`                                         |
| RFC 7807 problem responses with stable codes                                                                                                      | `src/core/errors`                                          |
| Validation with the shared zod schemas → 422                                                                                                      | `src/core/validation`                                      |
| Auth foundation: ES256 access tokens, argon2id hashing, single-use token utilities, global guards (deny by default)                               | `src/core/auth`                                            |
| Prisma 7 client (pg adapter, bounded pool)                                                                                                        | `src/core/prisma`, `prisma/`                               |
| `GET /health/live`, `GET /health/ready`, `GET /api/v1/meta`                                                                                       | `src/modules`                                              |
| Database scripts: `db:health`, `db:verify`, `db:seed` (system seed only), `db:reset` (local only), `keys:generate`                                | `scripts/`                                                 |
| Core data model: 26 tables, DB-enforced integrity (partial uniques, CHECKs, triggers), services for notifications, approvals, activity/audit logs | `prisma/`, `src/core/{data,notifications,approvals,audit}` |
| Container image (runtime + migrator targets, non-root)                                                                                            | `Dockerfile`                                               |

## Tests

- `src/**/*.spec.ts` — unit
- `test/db/**/*.db-spec.ts` — database tests against real PostgreSQL (schema per spec, real migrations; `REQUIRE_DATABASE_TESTS=1` in CI)
- `test/**/*.int-spec.ts` — HTTP integration (real Nest app; database checks run when `DATABASE_URL` is set). Includes the Manager-only review-resolution guard test (Team Lead → 403) and the "every route declares an access policy" check.

## Migrations

Schema changes go through `prisma/schema.prisma` + `pnpm db:migrate:dev`. Constraints Prisma cannot express (partial unique indexes, triggers) are added as raw SQL inside the generated migration. CI applies all migrations to an empty database and fails if `prisma migrate diff` finds any drift from the schema.
