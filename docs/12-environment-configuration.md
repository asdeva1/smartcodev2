# 12 — Environment Configuration

Status: **Approved (Phase 0)** — final decisions applied

All configuration is validated at start-up (zod schema in `apps/api/src/core/config` and `apps/web/src/env.ts`); the process exits with a clear message if anything is missing or malformed. Values live in: local `.env` (dev, git-ignored) · Vercel environment variables (web) · AWS Secrets Manager / ECS task env (api, worker). **Nothing secret is ever committed.** `.env.example` documents names only.

## API & worker (`apps/api`)

| Variable                                                | Secret   | Example / default                                    | Purpose                                                        |
| ------------------------------------------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `APP_ENV`                                               | no       | `development` \| `staging` \| `production`           | Environment guard rails                                        |
| `NODE_ENV`                                              | no       | `production`                                         |                                                                |
| `PORT`                                                  | no       | `4000`                                               | HTTP port (container)                                          |
| `APP_MODE`                                              | no       | `api` \| `worker` \| `task`                          | Which entrypoint the image runs                                |
| `DATABASE_URL`                                          | **yes**  | `postgresql://…?sslmode=require&connection_limit=10` | Runtime pool                                                   |
| `DATABASE_MIGRATION_URL`                                | **yes**  | separate role with DDL rights                        | Used only by the migrate task                                  |
| `DATABASE_POOL_MAX`                                     | no       | `10`                                                 | Connections per process (tasks × pool ≤ 70 % of RDS max)       |
| `REDIS_URL`                                             | **yes**  | `rediss://…`                                         | Queues, rate limit, SSE                                        |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                    | **yes**  | ES256 PEM                                            | Access-token signing                                           |
| `JWT_KEY_ID`                                            | no       | `2026-10`                                            | Key rotation                                                   |
| `ACCESS_TOKEN_TTL`                                      | no       | `15m`                                                |                                                                |
| `REFRESH_TOKEN_IDLE_TTL` / `REFRESH_TOKEN_ABSOLUTE_TTL` | no       | `12h` / `7d`                                         |                                                                |
| `ACTIVATION_TOKEN_TTL` / `RESET_TOKEN_TTL`              | no       | `72h` / `30m`                                        |                                                                |
| `COOKIE_DOMAIN`                                         | no       | empty in dev                                         | Shared parent domain (set when domains are known)              |
| `WEB_URL`                                               | no       | `http://localhost:3000`                              | Origin of the web app (CORS default, redirects)                |
| `API_URL`                                               | no       | `http://localhost:4000`                              | Public base URL of this API                                    |
| `APP_URL`                                               | no       | `http://localhost:3000`                              | Canonical product URL used in emails/links (activation, reset) |
| `CORS_ALLOWED_ORIGINS`                                  | no       | defaults to `WEB_URL`                                | Comma-separated allow-list                                     |
| `AWS_REGION`                                            | no       | per environment                                      |                                                                |
| `S3_UPLOADS_BUCKET` / `S3_REPORTS_BUCKET`               | no       | `smartcode-prod-uploads`                             |                                                                |
| `S3_ENDPOINT`                                           | no       | dev only (MinIO)                                     |                                                                |
| `SES_FROM_EMAIL`                                        | no       | `SmartCode <no-reply@example.com>`                   |                                                                |
| `SES_CONFIGURATION_SET`                                 | no       | `smartcode-prod`                                     | Bounce tracking                                                |
| `SMTP_URL`                                              | no       | dev only (Mailpit)                                   | Local email capture                                            |
| `BRAND_ASSET_BASE_URL`                                  | no       | `${APP_URL}/brand`                                   | Absolute logo URL for emails/PDFs                              |
| `LOG_LEVEL`                                             | no       | `info`                                               |                                                                |
| `RATE_LIMIT_PER_MINUTE`                                 | no       | `300`                                                | General per-client API rate limit                              |
| `RATE_LIMIT_LOGIN_PER_15M`                              | no       | `5`                                                  |                                                                |
| `BOOTSTRAP_MANAGER_EMAIL` / `_NAME` / `_EMPLOYEE_ID`    | no (PII) | —                                                    | Only for the one-off bootstrap task                            |
| `SENTRY_DSN` / `OTEL_EXPORTER_OTLP_ENDPOINT`            | optional | —                                                    | Error tracking / tracing (optional, D-18)                      |

## Web (`apps/web`)

| Variable              | Public?                      | Example                 | Purpose                                         |
| --------------------- | ---------------------------- | ----------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_APP_ENV` | yes                          | `production`            | Banner on non-prod ("STAGING")                  |
| `NEXT_PUBLIC_API_URL` | yes                          | `http://localhost:4000` | API base URL (`/api/v1` appended by the client) |
| `NEXT_PUBLIC_APP_URL` | yes                          | `http://localhost:3000` | Canonical URL                                   |
| `JWT_PUBLIC_KEY`      | no (server-only, not secret) | ES256 public key        | Optional middleware verification for redirects  |

The web app holds **no secrets**: it never talks to the database, S3 credentials or SES.

## Local development only

| Variable                                          | Purpose                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`        | Passwords for the local docker compose services (root `.env`, git-ignored; compose refuses to start without them) |
| `SEED_ORGANIZATION_NAME` / `_SLUG` / `_TIME_ZONE` | Optional overrides for the system seed (defaults: SmartClues / smartclues / Asia/Kolkata)                         |

## Smoke / CI

| Variable                                             | Purpose                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `PRODUCTION_URL`, `PRODUCTION_API_URL`               | Targets for `pnpm smoke:production`                                                |
| `STAGING_URL`, `STAGING_API_URL`                     | Targets for staging smoke + E2E                                                    |
| `E2E_*` credentials                                  | **Staging only**, stored as GitHub Environment secrets for synthetic test accounts |
| `AWS_ROLE_ARN_STAGING` / `AWS_ROLE_ARN_PRODUCTION`   | GitHub OIDC roles (not secrets, but environment-scoped)                            |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Only if deploying via CLI instead of Vercel Git integration                        |

## Guard rails

- `db:reset` refuses unless `APP_ENV=development` **and** the DB host is local.
- API start-up refuses if `APP_ENV=production` and `DATABASE_URL` points to a non-production host pattern (and vice versa).
- Pre-commit + CI secret scanning (gitleaks); `.env*` git-ignored except `.env.example`.
