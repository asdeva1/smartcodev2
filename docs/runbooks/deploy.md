# Deploy a release

Rule: every release goes to staging first. Production receives the **same image** that passed staging; nothing is rebuilt.

## 1. Staging

1. Merge the feature branch into `develop` (pull request, CI green: lint, typecheck, tests, build, security, CodeQL).
2. Build and push (tag = short commit SHA, tags are immutable):
   ```powershell
   $tag = (git rev-parse --short HEAD)
   docker build -f apps/api/Dockerfile --target runtime  -t "$ecr`:$tag" .
   docker build -f apps/api/Dockerfile --target migrator -t "$ecr`:$tag-migrator" .
   aws ecr get-login-password --profile smartcode-staging --region ap-south-1 | docker login --username AWS --password-stdin $registry
   docker push "$ecr`:$tag"; docker push "$ecr`:$tag-migrator"
   ```
3. Review the change: `cdk diff SmartCode-Staging-Api --exclusively` with the staging flags (see `docs/staging-deploy-phase-5.md`). Only task definitions and the image tag should change.
4. `cdk deploy SmartCode-Staging-Api --exclusively --require-approval never` with the same flags and `-c imageTag=$tag`.
5. Run the migration task (`infra/cdk/scripts/run-task.mjs`, command `pnpm exec prisma migrate deploy`).
6. Check the service is stable and `GET /health/ready` is 200.
7. Deploy the web: `vercel deploy --prod --yes --scope smartclues12s-projects`.
8. `pnpm smoke` with `SMOKE_API_URL` / `SMOKE_WEB_URL`, then the manual check of the changed screens.

The `Deploy staging` GitHub workflow does steps 2–6 and 8 automatically once `STAGING_DEPLOY_ENABLED` is set.

## 2. Production

1. Confirm the staging release has been running without alarms and the mandatory end-to-end test passed in CI for this commit.
2. Check the release notes for database changes. Migrations must be **expand-then-contract**: a release may add columns/tables, never remove or rename something the previous release still uses. Removals ship one release later.
3. GitHub → Actions → **Deploy production** → Run workflow → enter the image tag.
4. A reviewer approves the `production` environment gate. The workflow then: copies the image, takes an RDS snapshot, shows `cdk diff`, deploys the API stack, runs migrations, runs the smoke test.
5. Deploy the web to the Vercel production project (same commit).
6. Watch the dashboards and alarms for 30 minutes (ErrorRate, latency, CPU, DB connections).
7. Record the release (tag, time, approver) in the release log.

## If it fails

- Workflow failed before `cdk deploy`: nothing changed; fix and re-run.
- Failed during or after: follow [rollback.md](rollback.md).
