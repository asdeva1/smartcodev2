<p align="center">
  <img src="packages/brand/assets/web/smartcode-logo-horizontal@1x.png" alt="SmartCode — Powering Smarter Medical Coding. A SmartClues Technology Product" width="480">
</p>

# SmartCode Enterprise V2

Enterprise medical coding operations platform — Client → Project → Chart Repository → Chart Allocation → Coder Production → Audit → Rework → Re-Audit → Completed.

> **Status: Phase 2 (database + core data model) complete — awaiting approval for Phase 3.** Start with [`docs/README.md`](docs/README.md).

## Stack

| Layer         | Technology                                                           |
| ------------- | -------------------------------------------------------------------- |
| Web           | Next.js 16 · React 19 · TypeScript · Material UI 9 → Vercel          |
| API           | NestJS 12 · TypeScript → AWS ECS Fargate                             |
| Data          | PostgreSQL 16 (AWS RDS) · Prisma 7 · Redis/Valkey (from Phase 3)     |
| Files / Email | AWS S3 · AWS SES (React Email templates)                             |
| Ops           | AWS CDK · Secrets Manager · CloudWatch · WAF · GitHub Actions        |
| Tooling       | pnpm 10 · Turborepo · TypeScript 6 strict · ESLint 10 · Prettier     |
| Tests         | Vitest (packages, web, infra) · Jest (API) · Playwright (end-to-end) |

## Layout

```
apps/web                 Next.js frontend (landing, sign-in, workspace shell)
apps/api                 NestJS API + Prisma (schema, migrations, db scripts) + Dockerfile
apps/e2e                 Playwright end-to-end tests
packages/shared          roles, permission matrix, statuses, workflow rules, validation, terminology
packages/brand           official SmartCode logo (untouched original) + derived assets + tokens
packages/email-templates branded React Email templates
packages/config          shared TypeScript presets
infra/cdk                AWS infrastructure as code (network, data, storage, API, monitoring)
docs/                    architecture & specifications
```

## Local development

Requires Node 24 and pnpm 10 (`corepack enable`), plus Docker for the local services.

```bash
pnpm install
cp .env.example .env                 # set POSTGRES_PASSWORD and MINIO_ROOT_PASSWORD (local only)
cp .env.example apps/api/.env        # set DATABASE_URL=postgresql://smartcode:<password>@localhost:5432/smartcode_dev
pnpm dev:services                    # PostgreSQL, Mailpit, MinIO, Valkey
pnpm --filter @smartcode/api keys:generate
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev                             # web http://localhost:3000 · API http://localhost:4000
```

| Command                                                     | Purpose                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` | Quality gate (same as CI)                                |
| `pnpm test:api` · `pnpm test:web` · `pnpm test:e2e`         | Focused test runs                                        |
| `pnpm db:health` · `pnpm db:verify`                         | Automated database checks — no manual SQL                |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset`        | Migrations, system seed, local-only reset                |
| `pnpm secrets:check` · `pnpm env:check`                     | Secret scan of tracked files; env file vs `.env.example` |

## Rules

- Never commit `.env` files, passwords, keys, tokens or AWS credentials. `.env.example` lists names only.
- Synthetic data only outside production — never real patient data in code, fixtures, screenshots or logs.
- Branches: `main` (production), `develop` (integration); feature branches → PR into `develop`.
