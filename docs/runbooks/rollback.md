# Roll back a release

Decide quickly: if users are affected and the cause is not obvious within 15 minutes, roll back.

## Application (no database change in the release, or only additive changes)

1. Find the previous good tag (release log, or ECR image list).
2. Re-run **Deploy production** with the previous tag. The migration step is a no-op because migrations are additive.
3. Web: in Vercel, promote the previous production deployment (Deployments → ⋯ → Promote) or `vercel rollback`.
4. Run `pnpm smoke`; confirm the alarms clear.

Emergency alternative (faster, no pipeline): ECS → service → Update → select the previous task definition revision → force new deployment.

## Release contained a destructive or wrong migration

Migrations are expand-then-contract, so this should not happen. If it does:

1. Stop: scale the API service to 0 to prevent further bad writes (`aws ecs update-service --desired-count 0 ...`).
2. Restore from the pre-deploy snapshot taken by the workflow (see [backup-restore.md](backup-restore.md), "Restore to a new instance"), or fix forward with a new migration if the data is intact.
3. Point the service at the restored database only after the incident lead approves.
4. Write up the cause; add a test that would have caught it.

## After any rollback

Open an incident record, keep the bad tag out of the promotion path, and fix forward on a branch.
