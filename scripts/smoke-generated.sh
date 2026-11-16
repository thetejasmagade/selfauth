#!/usr/bin/env bash
# Generates a project with the CLI outside the monorepo, installs it from npm,
# and proves it works: typecheck, build, migrations (PostgreSQL), and a real
# sign-up → email verification → login → protected route flow.
#   scripts/smoke-generated.sh memory
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-generated.sh postgresql
set -euo pipefail
DB="${1:?usage: smoke-generated.sh memory|postgresql}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/packages/cli/dist/bin.js"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3950}"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

step() { printf '\n== %s\n' "$*"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

step "selfauth init ($DB)"
node "$CLI" init "$APP" --database "$DB" --permissions orders.view,orders.create --yes > /dev/null
cd "$APP"
echo "generated $(find . -type f | wc -l) files"

step "npm install, typecheck, build"
npm install --no-audit --no-fund --loglevel=error
npm run -s typecheck
npm run -s build

cp .env.example .env
if [[ "$DB" == "postgresql" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" .env
  step "selfauth db plan / migrate / validate"
  node "$CLI" db plan
  node "$CLI" db migrate
  node "$CLI" db status
  npm run -s db:seed
  node "$CLI" validate
fi

step "selfauth doctor"
node "$CLI" doctor

step "boot and exercise the API"
PORT="$PORT" node --env-file=.env dist/server.js > server.log 2>&1 &
SERVER=$!
for _ in $(seq 1 50); do curl -sf "localhost:$PORT/health" > /dev/null && break; sleep 0.2; done
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
EMAIL="smoke@example.test"
PASSWORD="correct horse battery staple"

expect register "$(curl "${H[@]}" "localhost:$PORT/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" '"accepted"'
expect "login before verification" "$(curl "${H[@]}" "localhost:$PORT/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" EMAIL_NOT_VERIFIED
TOKEN="$(grep -o 'token=[A-Za-z0-9_-]*' server.log | head -1 | cut -d= -f2)"
expect verify "$(curl "${H[@]}" "localhost:$PORT/auth/email/verify" -d "{\"token\":\"$TOKEN\"}")" '"verified"'
expect login "$(curl "${H[@]}" "localhost:$PORT/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" "\"email\":\"$EMAIL\""
expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" "\"hello\":\"$EMAIL\""
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" UNAUTHENTICATED
echo -e "\nGenerated $DB project: all checks passed."
