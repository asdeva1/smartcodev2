# Backups and restore

## What is backed up

- **PostgreSQL (RDS)**: automated daily backups with point-in-time recovery. Retention: 35 days in production, 1 day in staging. A manual snapshot is also taken before every production deploy.
- **S3 (uploads, reports)**: versioned and encrypted with KMS.
- Charts' clinical content is not stored in SmartCode, so the database holds only references, counts and audit data.

## Restore to a new instance (never over the live one)

1. RDS console → Databases → the production instance → Actions → **Restore to point in time** (or pick a snapshot → Restore snapshot).
2. Give it a new identifier, e.g. `smartcode-production-restore-<date>`; same subnet group and security group as the original.
3. Wait for Available. Connect from a one-off ECS task (see `infra/cdk/scripts/run-task.mjs`) and run `pnpm db:verify` — it checks migrations, constraints, triggers, orphaned rows and duplicates.
4. To switch the application: update `DATABASE_URL` in the app secret (see [secrets-rotation.md](secrets-rotation.md)) and force a new ECS deployment. Keep the old instance until the restored data is confirmed.

## Test the backups (every quarter, and before go-live)

1. Restore the latest snapshot to a temporary instance.
2. Run `pnpm db:verify` against it and compare row counts of `employees`, `projects`, `charts`, `audits` with production.
3. Delete the temporary instance and record the date, the result and the time the restore took.

## Targets

Recovery point objective: 5 minutes (point-in-time recovery). Recovery time objective: 2 hours. Confirm both with the business before go-live.
