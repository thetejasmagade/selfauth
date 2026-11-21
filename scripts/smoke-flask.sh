#!/usr/bin/env bash
# Generates a Flask (Python) project with the CLI outside the monorepo and proves it works: the
# project's own tests, migrations (SQL databases and MongoDB indexes), and a real sign-up → email
# verification → login → protected route flow, then the agent skill's validate-auth against the
# running server.
#   scripts/smoke-flask.sh memory
#   scripts/smoke-flask.sh memory react        (Flask + a frontend: server/ and client/ in one workspace)
#   scripts/smoke-flask.sh sqlite              (a temporary file, no server)
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-flask.sh postgresql   (an empty database)
#   SMOKE_DATABASE_URL=mysql://… scripts/smoke-flask.sh mysql            (an empty database)
#   SMOKE_DATABASE_URL=mongodb://…/smoke scripts/smoke-flask.sh mongodb  (an empty database)
# Needs Python 3.11+ and the built CLI (pnpm build). SMOKE_PYTHON picks the interpreter.
set -euo pipefail
DB="${1:?usage: smoke-flask.sh memory|postgresql|mysql|sqlite|mongodb [none|vue|react]}"
FRONTEND="${2:-none}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${SELFAUTH_SMOKE_CLI:-$REPO/packages/cli/dist/bin.js}"
PYTHON="${SMOKE_PYTHON:-python3}"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3961}"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

step() { printf '\n== %s\n' "$*"; }
skill() { SELFAUTH_CLI="$CLI" node "$APP/.claude/skills/selfauth/scripts/$1" "${@:2}"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

step "selfauth init (flask, $DB, frontend: $FRONTEND)"
node "$CLI" skill install "$APP" --agent claude > /dev/null
expect "skill recommends init" "$(skill detect-project.ts "$APP")" "**Recommendation: init**"
node "$CLI" init "$APP" --backend flask --database "$DB" --frontend "$FRONTEND" --permissions orders.view,orders.create --yes > /dev/null
cd "$APP"
echo "generated $(find . -type f -not -path './.claude/*' | wc -l) files"
if [[ "$FRONTEND" == "none" ]]; then
  SERVER_DIR="$APP"
  test ! -e package.json
else
  SERVER_DIR="$APP/server"
  test -e package.json && test -e client/package.json && test -e scripts/dev-server.mjs
  step "the frontend: npm install, typecheck, build"
  npm install --no-audit --no-fund > /dev/null
  npm run typecheck
  npm run build
fi
cd "$SERVER_DIR"
test -e requirements.txt && test -e app/wsgi.py && test ! -e go.mod

step "virtual environment and the project's own tests"
"$PYTHON" -m venv .venv
.venv/bin/pip install --quiet -r requirements-dev.txt
PY="$SERVER_DIR/.venv/bin/python"
"$PY" -m pytest -q

export APP_ENV=development SELFAUTH_APP_BASE_URL=http://localhost:5173
if [[ "$DB" != "memory" ]]; then
  [[ "$DB" == "sqlite" ]] && SMOKE_DATABASE_URL="file:$WORK/smoke.db"
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  export DATABASE_URL="$SMOKE_DATABASE_URL"
  step "selfauth db plan / migrate / status, seed"
  node "$CLI" db plan
  node "$CLI" db migrate
  node "$CLI" db status
  "$PY" -m app.cmd.seed
fi

step "selfauth doctor and validate"
node "$CLI" doctor
node "$CLI" validate

step "boot and exercise the API"
PORT="$PORT" "$PY" -m app.cmd.server > server.log 2>&1 &
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
if [[ "$DB" != "memory" ]]; then
  step "create-admin (a developer-run command, never the API)"
  "$PY" -m app.cmd.create_admin "$EMAIL" | grep -q "now an administrator"
  expect "admin role is read on the next request" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" '"admin"'
fi

step "agent skill: validate-auth (static checks, the project's pytest, live probes)"
VALIDATION="$(skill validate-auth.ts "$SERVER_DIR" --url "http://localhost:$PORT" --protected /api/hello || true)"
echo "$VALIDATION"
expect "validate-auth passes" "$VALIDATION" "RESULT: PASS"
expect "validate-auth ran pytest" "$VALIDATION" "PASS    backend: pytest"
expect "skill reports SelfAuth installed" "$(skill detect-project.ts "$SERVER_DIR")" "**Recommendation: upgrade**"

step "CSRF and logout"
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated Flask project ($DB): all checks passed."
