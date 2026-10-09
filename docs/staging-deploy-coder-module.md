# Staging deploy — Phase 9 (Audit & rework) + Coder module

Status: built and tested on `feature/coder-module` (includes `feature/phase-9-audit`). **Not deployed.**
Deploy only after the owner says go.

What changes on staging

- Database: one additive migration `20261011000000_coder_module` (hold columns on `charts`, `active_seconds` on
  `production_entries`, one index). Phase 9 needed no migration. Nothing is dropped or rewritten.
- API: audit queue/reviews/rework, coder hold/resume/dashboard, notifications.
- Web: auditor/review/rework pages, coder workspace, dashboard tiles, notification bell.

Order (same as the Phase 4+5 release)

1. Release branch from `feature/coder-module`; immutable image tag `coder-<short-sha>` plus `-migrator`.
2. RDS snapshot before the migration.
3. Push both images to ECR; register a new migrate task-definition revision that uses the new migrator image.
4. Run the migrate task (`migrate deploy`, then `migrate status` must say up to date).
5. `cdk diff` then `cdk deploy SmartCode-Staging-Api --exclusively` with ALL staging context flags
   (`env`, `imageTag`, `webUrl`, `appUrl`, `mailFrom`, `backupRetentionDays=1`, `httpsApiGateway=true`).
6. `vercel deploy --prod` for the web app.
7. Smoke test: `/health/ready`, sign in as Manager, Coder, Auditor; hold a chart, try to pull it back, submit,
   audit with errors, see the bell notification and the dashboard figures.

Rollback: the migration is additive, so the previous API image keeps working against the new schema.
