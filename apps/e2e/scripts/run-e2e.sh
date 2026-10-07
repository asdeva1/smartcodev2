#!/usr/bin/env bash
# Runs the Playwright suite against a real PostgreSQL database, the built API and the built web app.
#
#   DATABASE_ADMIN_URL=postgresql://user:pass@localhost:5432/postgres  apps/e2e/scripts/run-e2e.sh [playwright args]
#
# It (re)creates a throw-away database, applies the migrations, runs the system seed, bootstraps the first Manager
# through the real activation workflow (no password exists anywhere), starts both servers with the file mail
# transport so the tests can read the emailed links, runs the tests and stops the servers.
# Set E2E_USE_PSQL=1 where the Prisma schema engine cannot be downloaded: migrations are then applied with psql.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ADMIN="${DATABASE_ADMIN_URL:?set DATABASE_ADMIN_URL (a connection to the postgres maintenance database)}"
DB_NAME="${E2E_DB_NAME:-smartcode_e2e}"
export DATABASE_URL="${ADMIN%/*}/${DB_NAME}"
WORK="${E2E_WORK_DIR:-$(mktemp -d)}"
export MAIL_TRANSPORT=file MAIL_FILE_DIR="$WORK/mail" E2E_MAIL_DIR="$WORK/mail"
export WEB_URL="${WEB_URL:-http://localhost:3000}" API_URL="${API_URL:-http://localhost:4000}"
export E2E_MANAGER_EMAIL="${E2E_MANAGER_EMAIL:-e2e.manager@example.test}"
mkdir -p "$MAIL_FILE_DIR"

psql "$ADMIN" -q -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME}"
if [ "${E2E_USE_PSQL:-0}" = "1" ]; then
  for dir in "$ROOT"/apps/api/prisma/migrations/*/; do
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/migration.sql" >/dev/null
  done
else
  (cd "$ROOT/apps/api" && pnpm exec prisma migrate deploy)
fi
(cd "$ROOT/apps/api" && pnpm db:seed \
  && BOOTSTRAP_MANAGER_EMAIL="$E2E_MANAGER_EMAIL" BOOTSTRAP_MANAGER_NAME="E2E Manager" BOOTSTRAP_MANAGER_EMPLOYEE_ID="MGR-E2E" pnpm bootstrap:manager)

# Each server runs in its own process group so that stopping it also stops the child processes `pnpm` spawns —
# a leftover server from an earlier build would otherwise keep the port and serve stale files.
for port in 3000 4000; do
  if curl -s -o /dev/null "http://localhost:$port" 2>/dev/null; then echo "Port $port is already in use; stop that server first."; exit 1; fi
done
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill -- "-$p" 2>/dev/null || true; done; }
trap cleanup EXIT
(cd "$ROOT/apps/api" && exec setsid node dist/main.js) >"$WORK/api.log" 2>&1 & PIDS+=($!)
(cd "$ROOT/apps/web" && exec setsid pnpm start) >"$WORK/web.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 60); do
  curl -sf "$API_URL/health/ready" >/dev/null && curl -sf "$WEB_URL/login" >/dev/null && break
  sleep 1
done
curl -sf "$API_URL/health/ready" >/dev/null || { echo "API did not start"; tail -20 "$WORK/api.log"; exit 1; }

cd "$ROOT/apps/e2e"
pnpm exec playwright test "$@"
