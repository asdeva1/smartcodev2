# Staging deployment — everything built since the last deploy (feature/phase-13-hardening)

This branch contains all work not yet on staging: chart repository, reports hub with PDF, audit log, activity log, approval engine (employee deactivation, login name change, project closure), the end-to-end/performance tests, the smoke script and the security fixes.

**No database migration** in this release, so the migration step is not needed. Deploy the API image, then the web app.

## Steps (PowerShell, from the repository folder, on branch `feature/phase-13-hardening`)

```powershell
git checkout feature/phase-13-hardening; git pull
$tag = "phase13-" + (git rev-parse --short HEAD)
$ecr = "520891536638.dkr.ecr.ap-south-1.amazonaws.com/smartcode-staging-api-apirepositoryb8378b43-uwmkykm3m9lp"
aws ecr get-login-password --profile smartcode-staging --region ap-south-1 | docker login --username AWS --password-stdin 520891536638.dkr.ecr.ap-south-1.amazonaws.com
docker build -f apps/api/Dockerfile --target runtime  -t "${ecr}:$tag" .
docker build -f apps/api/Dockerfile --target migrator -t "${ecr}:$tag-migrator" .
docker push "${ecr}:$tag"; docker push "${ecr}:$tag-migrator"
```

Review, then deploy (cdk diff should show only the image tag changing):

```powershell
cd infra/cdk
$flags = "-c","env=staging","-c","imageTag=$tag","-c","webUrl=https://smartcode-v2-web-staging.vercel.app","-c","appUrl=https://smartcode-v2-web-staging.vercel.app","-c","mailFrom=ashok.p@smartcluestech.com","-c","backupRetentionDays=1","-c","httpsApiGateway=true"
pnpm exec cdk diff SmartCode-Staging-Api --exclusively --profile smartcode-staging @flags
pnpm exec cdk deploy SmartCode-Staging-Api --exclusively --require-approval never --profile smartcode-staging @flags
```

Check, then smoke test and web deploy:

```powershell
aws ecs describe-services --profile smartcode-staging --region ap-south-1 --cluster SmartCode-Staging-Api-ClusterEB0386A7-kui0eKwQiwwl --services (aws ecs list-services --profile smartcode-staging --region ap-south-1 --cluster SmartCode-Staging-Api-ClusterEB0386A7-kui0eKwQiwwl --query "serviceArns[0]" --output text) --query "services[0].deployments"
cd ../..
$env:SMOKE_API_URL = "https://cwt08exi48.execute-api.ap-south-1.amazonaws.com"
$env:SMOKE_WEB_URL = "https://smartcode-v2-web-staging.vercel.app"
pnpm smoke
vercel deploy --prod --yes --scope smartclues12s-projects
```

## Screens to check afterwards

Manager: Charts, Reports (download Excel/CSV/PDF), Audit log, Activity, Approvals. Team Lead / Vendor Admin / Quality Coach / HR: Approvals (raise a request); Manager approves or rejects it.

## Rollback

Re-run the same steps with the previous tag (`phase11-4c560a3`); there is no schema change to undo.
