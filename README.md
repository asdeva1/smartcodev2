<p align="center">
  <img src="packages/brand/assets/web/smartcode-logo-horizontal@1x.png" alt="SmartCode — Powering Smarter Medical Coding. A SmartClues Technology Product" width="480">
</p>

# SmartCode Enterprise V2

Enterprise medical coding operations platform — Client → Project → Chart Repository → Chart Allocation → Coder Production → Audit → Rework → Re-Audit → Completed.

> **Status: Phase 0 — architecture & documentation.** No application code yet. Start with [`docs/README.md`](docs/README.md).

## Stack (proposed)

| | |
|---|---|
| Web | Next.js · TypeScript · Material UI → Vercel |
| API | NestJS · TypeScript → AWS ECS Fargate |
| Data | PostgreSQL (AWS RDS) · Prisma · Redis (ElastiCache) |
| Files / Email | AWS S3 · AWS SES |
| Ops | AWS Secrets Manager · CloudWatch · CDK · GitHub Actions |

## Layout

```
apps/web            Next.js frontend
apps/api            NestJS API + worker (+ Prisma)
apps/e2e            Playwright end-to-end tests
packages/shared     roles, permissions, enums, state machines, schemas
packages/brand      official SmartCode logo + derived assets + tokens
packages/email-templates
packages/config     shared lint / TS config
infra/cdk           AWS infrastructure as code
docs/               architecture & specifications
```

## Rules

- Never commit `.env` files, passwords, keys or credentials (see `.env.example` for variable names only).
- Branches: `main` (production), `develop` (integration).
