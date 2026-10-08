# Staging deployment — Phases 4 + 5 (release/staging-phase-5)

Status: **prepared, not deployed.** Nothing here has been run against AWS or Vercel.

## What is in this release
- Phase 4: Organization settings, Vendors, Teams, Chart Allocation (Login Names by email, CSV, Chart ID search).
- Phase 5: Projects (Manual / Automatic), allocation CSV, Pull back charts, Completed charts, live tracking, Production and Quality reports, Coder "My charts".
- Role landing pages (Team Lead, Auditor, Group Coach → Projects; Coder → My charts).

## Verified on this branch
Shared 86, API 481 (unit + integration + database against PostgreSQL 16), web 74, CDK 17 tests pass. API and web typecheck and lint clean. Web builds with APP_ENV=staging.

## Database change (one migration, additive)
`20261010000000_projects_manual_allocation`: new nullable columns on `charts` (pages, page_bucket, remarks, submitted_to_client_at/by) and `projects.client_pullback_at`, two CHECK constraints. Nothing is dropped or rewritten, so the running API keeps working while it is applied (expand step). Rollback = forward-fix migration (take an RDS snapshot first).

## Steps (in order)
1. **Snapshot** the staging RDS instance (manual snapshot).
2. **Build and push the API image** with a NEW tag (ECR tags are immutable), e.g. `phase5-79fa455`, and the migrator image `phase5-79fa455-migrator` (Dockerfile target `migrator`).
3. **Run the migration task** (`infra/cdk/scripts/run-task.mjs`, command `pnpm exec prisma migrate deploy`), then `pnpm exec prisma migrate status` must say the database is up to date.
4. **Deploy the API**: `cdk deploy -c env=staging -c imageTag=phase5-79fa455` (review `cdk diff` first; only the task definitions/image should change). Wait for the ECS service to be stable.
5. **Deploy the web** to Vercel (staging project) from this branch with NEXT_PUBLIC_APP_ENV=staging, NEXT_PUBLIC_API_URL=<staging API>/api/v1, NEXT_PUBLIC_APP_URL=<staging web URL>.
6. **Smoke test** (below).

## Smoke test
1. Manager signs in → Projects → Create project (Manual) with a lead.
2. Chart allocation tab → Upload allocation CSV (`Login Name, Email ID, Chart ID, Pages, Page Bucket, Remarks`) with one active coder's email → preview → confirm.
3. That coder signs in → lands on My charts → sees the charts with pages / bucket / remarks.
4. Coder clicks a chart → workspace shows Chart ID and Page numbers (read-only) → enter ICDs and DOS → Submit → chart leaves My charts and the Manager's project counts/live tracking drop by one; the chart is now Pending audit.
5. Manager → Pull back charts → coder's list becomes empty.
6. Create an Automatic project → no Chart allocation tab.
7. Team Lead signs in → lands on Projects, sees only their projects; non-Manager gets 403 on creating a project.
8. Production report: Today (Shift End), Monthly, Date range all load.

## Rollback
Web: Vercel instant rollback. API: redeploy the previous image tag (the migration is additive, so the old API runs fine on the new schema).

## Still open for production (unchanged)
Custom domain + ACM certificate, RDS backup retention 35 days, SES production access, Vercel plan/SSO protection, removal of the broad deployer IAM key.
