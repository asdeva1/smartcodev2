# Staging deployment — Projects with teams, and Messages (feature/project-team-collaboration)

Contains: a project is worked by one team (team name in the Projects list, team dashboard when a Manager opens a project, team changes flow to the project, Manager-only team creation) and Messages (team channels, channels, direct messages, audio/video calls and screen sharing).

**Two database migrations** (additive only): `20261013000000_project_team`, `20261014000000_collaboration`. Order: snapshot → images → CDK → **migrate** → web → smoke. Calls stay switched off until the LiveKit keys are stored (section 8); everything else works immediately.

```powershell
cd C:\Users\ADMIN\smartcodev2
git fetch origin; git checkout feature/project-team-collaboration; git pull
$p = "smartcode-staging"; $r = "ap-south-1"
$cluster = "SmartCode-Staging-Api-ClusterEB0386A7-kui0eKwQiwwl"
$tag = "team-" + (git rev-parse --short HEAD)
$registry = "520891536638.dkr.ecr.ap-south-1.amazonaws.com"
$ecr = "$registry/smartcode-staging-api-apirepositoryb8378b43-uwmkykm3m9lp"
```

## 1. Snapshot the database

```powershell
$db = aws rds describe-db-instances --profile $p --region $r --query "DBInstances[0].DBInstanceIdentifier" --output text
aws rds create-db-snapshot --profile $p --region $r --db-instance-identifier $db --db-snapshot-identifier "pre-$tag"
aws rds wait db-snapshot-available --profile $p --region $r --db-snapshot-identifier "pre-$tag"
```

## 2. Build and push both images

```powershell
aws ecr get-login-password --profile $p --region $r | docker login --username AWS --password-stdin $registry
docker buildx build -f apps/api/Dockerfile --target runtime  -t "${ecr}:$tag" --push .
docker buildx build -f apps/api/Dockerfile --target migrator -t "${ecr}:$tag-migrator" --push .
```

## 3. Deploy the infrastructure (new image, plus the empty call-keys secret)

```powershell
cd infra/cdk
$flags = "-c","env=staging","-c","imageTag=$tag","-c","webUrl=https://smartcode-v2-web-staging.vercel.app","-c","appUrl=https://smartcode-v2-web-staging.vercel.app","-c","mailFrom=ashok.p@smartcluestech.com","-c","backupRetentionDays=1","-c","httpsApiGateway=true"
pnpm exec cdk diff SmartCode-Staging-Api --exclusively --profile $p @flags
pnpm exec cdk deploy SmartCode-Staging-Api --exclusively --require-approval never --profile $p @flags
cd ../..
```

The diff should show the new image tag and one new secret (`CallsSecret`).

## 4. Run the migrations

```powershell
$stack = "SmartCode-Staging-Api"
$migrate = aws cloudformation describe-stacks --profile $p --region $r --stack-name $stack --query "Stacks[0].Outputs[?OutputKey=='MigrateTaskDefinitionArn'].OutputValue" --output text
$svc = aws ecs list-services --profile $p --region $r --cluster $cluster --query "serviceArns[0]" --output text
$net = aws ecs describe-services --profile $p --region $r --cluster $cluster --services $svc --query "services[0].networkConfiguration.awsvpcConfiguration" | ConvertFrom-Json
node infra/cdk/scripts/run-task.mjs --profile $p --region $r --cluster $cluster --task-def $migrate --subnets ($net.subnets -join ",") --security-group $net.securityGroups[0] --command "pnpm exec prisma migrate deploy"
```

Expect `container exit code: 0` and "2 migrations applied".

## 5. Check the API

```powershell
curl.exe https://cwt08exi48.execute-api.ap-south-1.amazonaws.com/health/ready
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

1. Manager → Teams: create a team, choose its Team Lead, add Coders and a Group Coach.
2. Manager → Projects → Create project → choose the team. The list shows the team name; opening the project shows the team dashboard first.
3. Add another Coder to the team: the project's members include them within a moment.
4. Everyone → Messages: the team channel exists; send a message from two accounts and see it arrive.
5. A project created before this release shows a yellow note when it has people added one by one; assign a team to take it over.

## 8. Switch calls on (when you have LiveKit keys)

See `docs/collaboration-and-calls.md`. Without it the call buttons show "Calls not set up yet".

## Rollback

Application: repeat steps 2–3 with the previous tag (`phase12-ae3910d`). Both migrations only add columns and tables, so the old API ignores them. Database restore from `pre-$tag` only if data was damaged (`docs/runbooks/backup-restore.md`).
