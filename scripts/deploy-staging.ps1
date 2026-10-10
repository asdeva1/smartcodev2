<#
  Staging deployment in one go: snapshot -> images -> CDK -> migrations -> API check -> smoke -> web.
  Run from the repository root in Windows PowerShell:   .\scripts\deploy-staging.ps1
  Stops at the first failure. Nothing here prints a secret.
  Skip the web step with -SkipWeb. Use -Tag to deploy an existing image tag.
#>
param(
  [string]$Tag = "",
  [switch]$SkipSnapshot,
  [switch]$SkipWeb
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "FAILED: $what (exit code $LASTEXITCODE)" } }

if (-not (Test-Path "apps/api/Dockerfile")) { throw "Run this from the repository root (C:\Users\ADMIN\smartcodev2)." }
if (git status --porcelain --untracked-files=no) { throw "There are uncommitted changes. Commit or stash them first." }

$p = "smartcode-staging"; $r = "ap-south-1"
$cluster = "SmartCode-Staging-Api-ClusterEB0386A7-kui0eKwQiwwl"
$registry = "520891536638.dkr.ecr.ap-south-1.amazonaws.com"
$ecr = "$registry/smartcode-staging-api-apirepositoryb8378b43-uwmkykm3m9lp"
$api = "https://cwt08exi48.execute-api.ap-south-1.amazonaws.com"
$web = "https://smartcode-v2-web-staging.vercel.app"
if (-not $Tag) { $Tag = "team-" + (git rev-parse --short HEAD) }
Write-Host "== Deploying $(git branch --show-current) @ $(git rev-parse --short HEAD) as image tag $Tag" -ForegroundColor Cyan

aws sts get-caller-identity --profile $p --region $r --query Account --output text | Out-Null; Check "AWS sign-in (run: aws sso login --profile $p)"

if (-not $SkipSnapshot) {
  Write-Host "== 1/7 Database snapshot" -ForegroundColor Cyan
  $db = aws rds describe-db-instances --profile $p --region $r --query "DBInstances[0].DBInstanceIdentifier" --output text; Check "find database"
  aws rds create-db-snapshot --profile $p --region $r --db-instance-identifier $db --db-snapshot-identifier "pre-$Tag" | Out-Null; Check "create snapshot"
  aws rds wait db-snapshot-available --profile $p --region $r --db-snapshot-identifier "pre-$Tag"; Check "wait for snapshot"
}

Write-Host "== 2/7 Build and push images" -ForegroundColor Cyan
aws ecr get-login-password --profile $p --region $r | docker login --username AWS --password-stdin $registry; Check "docker login"
docker buildx build -f apps/api/Dockerfile --target runtime -t "${ecr}:$Tag" --push .; Check "runtime image"
docker buildx build -f apps/api/Dockerfile --target migrator -t "${ecr}:$Tag-migrator" --push .; Check "migrator image"

Write-Host "== 3/7 Infrastructure (CDK)" -ForegroundColor Cyan
Push-Location infra/cdk
try {
  $flags = "-c","env=staging","-c","imageTag=$Tag","-c","webUrl=$web","-c","appUrl=$web","-c","mailFrom=ashok.p@smartcluestech.com","-c","backupRetentionDays=1","-c","httpsApiGateway=true"
  pnpm exec cdk deploy SmartCode-Staging-Api --exclusively --require-approval never --profile $p @flags; Check "cdk deploy"
} finally { Pop-Location }

Write-Host "== 4/7 Database migrations" -ForegroundColor Cyan
$migrate = aws cloudformation describe-stacks --profile $p --region $r --stack-name SmartCode-Staging-Api --query "Stacks[0].Outputs[?OutputKey=='MigrateTaskDefinitionArn'].OutputValue" --output text; Check "migration task"
$svc = aws ecs list-services --profile $p --region $r --cluster $cluster --query "serviceArns[0]" --output text; Check "list services"
$net = aws ecs describe-services --profile $p --region $r --cluster $cluster --services $svc --query "services[0].networkConfiguration.awsvpcConfiguration" | ConvertFrom-Json
node infra/cdk/scripts/run-task.mjs --profile $p --region $r --cluster $cluster --task-def $migrate --subnets ($net.subnets -join ",") --security-group $net.securityGroups[0] --command "pnpm exec prisma migrate deploy"; Check "migrations"

Write-Host "== 5/7 Wait for the new API to be healthy" -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  try { $h = Invoke-RestMethod "$api/health/ready" -TimeoutSec 10; if ($h.status -eq "ready" -or $h.status -eq "ok") { $ok = $true; break } } catch { }
  Start-Sleep -Seconds 10
}
if (-not $ok) { aws ecs describe-services --profile $p --region $r --cluster $cluster --services $svc --query "services[0].events[:5].message" --output text; throw "API did not become ready within 5 minutes. See the ECS events above." }
Write-Host "API ready."

Write-Host "== 6/7 Smoke test" -ForegroundColor Cyan
$env:SMOKE_API_URL = $api; $env:SMOKE_WEB_URL = $web
pnpm smoke; Check "smoke test"

if (-not $SkipWeb) {
  Write-Host "== 7/7 Web (Vercel)" -ForegroundColor Cyan
  vercel deploy --prod --yes --scope smartclues12s-projects
  if ($LASTEXITCODE -ne 0) { Write-Host "Retrying once..." -ForegroundColor Yellow; vercel deploy --prod --yes --scope smartclues12s-projects; Check "vercel deploy" }
}
Write-Host "== Done. Image tag $Tag. Rollback tag: phase12-ae3910d" -ForegroundColor Green
