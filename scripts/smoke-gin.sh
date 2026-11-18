#!/usr/bin/env bash
# Generates a Gin (Go) project with the CLI outside the monorepo and proves it works: vet, build,
# the project's own tests, migrations (PostgreSQL), and a real sign-up → email verification →
# login → protected route flow, then the agent skill's validate-auth against the running server.
#   scripts/smoke-gin.sh memory
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-gin.sh postgresql   (an empty database)
# Needs Go (the version in go.mod) and the built CLI (pnpm build).
set -euo pipefail
DB="${1:?usage: smoke-gin.sh memory|postgresql}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${SELFAUTH_SMOKE_CLI:-$REPO/packages/cli/dist/bin.js}"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3951}"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

step() { printf '\n== %s\n' "$*"; }
skill() { SELFAUTH_CLI="$CLI" node "$APP/.claude/skills/selfauth/scripts/$1" "${@:2}"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

step "selfauth init (gin, $DB)"
node "$CLI" skill install "$APP" --agent claude > /dev/null
expect "skill recommends init" "$(skill detect-project.ts "$APP")" "**Recommendation: init**"
node "$CLI" init "$APP" --backend gin --database "$DB" --module smoke/app --permissions orders.view,orders.create --yes > /dev/null
cd "$APP"
echo "generated $(find . -type f -not -path './.claude/*' | wc -l) files"
test ! -e package.json
head -1 go.mod | grep -qx 'module smoke/app'

step "go vet, build and the project's own tests"
go vet ./...
go build -o "$WORK/server" ./cmd/server
go test -count=1 ./... | grep -v 'no test files'

export APP_ENV=development SELFAUTH_APP_BASE_URL=http://localhost:5173
if [[ "$DB" == "postgresql" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  export DATABASE_URL="$SMOKE_DATABASE_URL"
  step "selfauth db plan / migrate / status, seed"
  node "$CLI" db plan
  node "$CLI" db migrate
  node "$CLI" db status
  go run ./cmd/seed
  step "the PostgreSQL tests of the generated project, against the same database"
  TEST_DATABASE_URL="$SMOKE_DATABASE_URL" SELFAUTH_REQUIRE_POSTGRES=1 go test -count=1 ./internal/store/postgres/
fi

step "selfauth doctor and validate"
node "$CLI" doctor
node "$CLI" validate

step "boot and exercise the API"
PORT="$PORT" "$WORK/server" > server.log 2>&1 &
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
if [[ "$DB" == "postgresql" ]]; then
  step "create-admin (a developer-run command, never the API)"
  go run ./cmd/create-admin "$EMAIL" | grep -q "now an administrator"
  expect "admin role is read on the next request" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" '"admin"'
fi

step "agent skill: validate-auth (static checks, the project's go tests, live probes)"
VALIDATION="$(skill validate-auth.ts . --url "http://localhost:$PORT" --protected /api/hello || true)"
echo "$VALIDATION"
expect "validate-auth passes" "$VALIDATION" "RESULT: PASS"
expect "validate-auth ran go test" "$VALIDATION" "PASS    backend: go test"
expect "skill reports SelfAuth installed" "$(skill detect-project.ts .)" "**Recommendation: upgrade**"

step "CSRF and logout"
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated Gin project ($DB): all checks passed."
