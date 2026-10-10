# Staging deployment — everything since phase11 (feature/phase-12-modules)

Contains: chart repository, reports hub with PDF, audit log, activity log, six approval types, Visitor Management, Internal Audit (draft scope), Smart HRMS boundary, hardening (security fixes, smoke and load-test scripts).

**One database migration:** `20261012000000_visitors_internal_audit` (new tables only, nothing existing is changed). Order: snapshot → images → **migrate** → deploy API → web → smoke.

```powershell
git checkout feature/phase-12-modules; git pull
$p = "smartcode-staging"; $r = "ap-south-1"
$cluster = "SmartCode-Staging-Api-ClusterEB0386A7-kui0eKwQiwwl"
$tag = "phase12-" + (git rev-parse --short HEAD)
$registry = "520891536638.dkr.ecr.ap-south-1.amazonaws.com"
$ecr = "$registry/smartcode-staging-api-apirepositoryb8378b43-uwmkykm3m9lp"
```

## 1. Snapshot the database (safety net)

```powershell
$db = aws rds describe-db-instances --profile $p --region $r --query "DBInstances[0].DBInstanceIdentifier" --output text
aws rds create-db-snapshot --profile $p --region $r --db-instance-identifier $db --db-snapshot-identifier "pre-$tag"
aws rds wait db-snapshot-available --profile $p --region $r --db-snapshot-identifier "pre-$tag"
```

## 2. Build and push both images

```powershell
aws ecr get-login-password --profile $p --region $r | docker login --username AWS --password-stdin $registry
docker build -f apps/api/Dockerfile --target runtime  -t "${ecr}:$tag" .
docker build -f apps/api/Dockerfile --target migrator -t "${ecr}:$tag-migrator" .
docker push "${ecr}:$tag"; docker push "${ecr}:$tag-migrator"
```

## 3. Deploy the infrastructure change (new task definitions with the new image)

```powershell
cd infra/cdk
$flags = "-c","env=staging","-c","imageTag=$tag","-c","webUrl=https://smartcode-v2-web-staging.vercel.app","-c","appUrl=https://smartcode-v2-web-staging.vercel.app","-c","mailFrom=ashok.p@smartcluestech.com","-c","backupRetentionDays=1","-c","httpsApiGateway=true"
pnpm exec cdk diff SmartCode-Staging-Api --exclusively --profile $p @flags
pnpm exec cdk deploy SmartCode-Staging-Api --exclusively --require-approval never --profile $p @flags
cd ../..
```

The diff should show only the image tag. The new API starts while the database is still the old one; the new screens simply stay empty until step 4 (no existing screen depends on the new tables).

## 4. Run the migration

```powershell
$stack = "SmartCode-Staging-Api"
$migrate = aws cloudformation describe-stacks --profile $p --region $r --stack-name $stack --query "Stacks[0].Outputs[?OutputKey=='MigrateTaskDefinitionArn'].OutputValue" --output text
$svc = aws ecs list-services --profile $p --region $r --cluster $cluster --query "serviceArns[0]" --output text
$net = aws ecs describe-services --profile $p --region $r --cluster $cluster --services $svc --query "services[0].networkConfiguration.awsvpcConfiguration" | ConvertFrom-Json
node infra/cdk/scripts/run-task.mjs --profile $p --region $r --cluster $cluster --task-def $migrate --subnets ($net.subnets -join ",") --security-group $net.securityGroups[0] --command "pnpm exec prisma migrate deploy"
```

Expect `container exit code: 0` and "1 migration applied" (or "No pending migrations" if it ran before).

## 5. Check the API

```powershell
aws ecs describe-services --profile $p --region $r --cluster $cluster --services $svc --query "services[0].deployments"
curl https://cwt08exi48.execute-api.ap-south-1.amazonaws.com/health/ready
$env:SMOKE_API_URL = "https://cwt08exi48.execute-api.ap-south-1.amazonaws.com"
$env:SMOKE_WEB_URL = "https://smartcode-v2-web-staging.vercel.app"
pnpm smoke
```

## 6. Deploy the web

```powershell
vercel deploy --prod --yes --scope smartclues12s-projects
```

(Retry once on "Not authorized".)

## 7. Check the screens

Manager: Chart repository, Reports (download Excel, CSV, PDF), Audit log, Activity, Approvals, Visitors, Internal audit, Smart HRMS. HR: Visitors (register a visit, check in, print badge), Approvals (ask for a role change). Team Lead / Vendor Admin / Quality Coach: dashboard and Approvals.

## Rollback

Application: repeat steps 2–3 with the previous tag (`phase11-4c560a3`). The migration only adds tables, so the old API ignores them. Database restore from `pre-$tag` only if data was damaged (see `docs/runbooks/backup-restore.md`).

## Optional: load test (after step 5)

Sign in as the Manager in the browser, copy the `sc_at` cookie value from the browser's developer tools (Application → Cookies) and keep it private:

```powershell
$env:LOADTEST_API_URL = "https://cwt08exi48.execute-api.ap-south-1.amazonaws.com"
$env:LOADTEST_TOKEN = "<paste here, in your own terminal only>"
pnpm loadtest -- --users 25 --seconds 30
```
