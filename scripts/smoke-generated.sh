#!/usr/bin/env bash
# Generates a project with the CLI outside the monorepo, installs it from npm,
# and proves it works: typecheck, build, migrations (PostgreSQL), and a real
# sign-up → email verification → login → protected route flow.
#   scripts/smoke-generated.sh memory [none|vue|react|add|manual]
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-generated.sh postgresql [none|vue|react|manual]
# The second argument adds a frontend (installed, typechecked and built), or
# runs `selfauth add` against an existing Express app instead of `init`, or
# (manual) copies templates/express by hand and never runs any SelfAuth tool:
# plain npm and Prisma, as in docs/manual-integration.md.
# Each run also follows the agent skill's workflow: the skill is installed
# with `selfauth skill install`, and its detect-project / validate-auth scripts
# (the installed copies) must recommend the right command and pass.
set -euo pipefail
DB="${1:?usage: smoke-generated.sh memory|postgresql [none|vue|react|add|manual]}"
MODE="${2:-none}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# SELFAUTH_SMOKE_CLI: run a packaged CLI (scripts/pack-check.sh) instead of the workspace build.
CLI="${SELFAUTH_SMOKE_CLI:-$REPO/packages/cli/dist/bin.js}"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3950}"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

step() { printf '\n== %s\n' "$*"; }
# The installed skill's scripts, run as an agent would (SELFAUTH_CLI: this build, not npm).
skill() { SELFAUTH_CLI="$CLI" node "$APP/.claude/skills/selfauth/scripts/$1" "${@:2}"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

if [[ "$MODE" == "add" ]]; then
  step "existing Express app + selfauth add ($DB)"
  # examples/existing-express-app: a small shop API with its own test suite.
  mkdir -p "$APP"
  cp -r "$REPO/examples/existing-express-app/." "$APP"
  cd "$APP"
  npm install --no-audit --no-fund --loglevel=error
  expect "existing tests pass before" "$(npm test 2>&1)" "# pass 3"
  step "agent skill: install, detect"
  node "$CLI" skill install . --agent claude > /dev/null
  expect "skill recommends add" "$(skill detect-project.ts .)" "**Recommendation: add**"
  node "$CLI" add . --database "$DB" --yes --install > add.log
  cat add.log | sed -n '/Finish the integration/,$p'
  # The edits an agent makes after `add` (wiring, one protected route, tsconfig, .env loading),
  # kept as a reviewable patch next to the example.
  patch -p1 < "$REPO/examples/existing-express-app.selfauth.patch"
  npx tsc --noEmit
  printf 'NODE_ENV=development\nSELFAUTH_APP_BASE_URL=http://localhost:5173\n' > .env
  expect "existing tests still pass, plus the new one" "$(npm test 2>&1)" "# pass 4"
  START=(node --env-file=.env src/server.ts)
elif [[ "$MODE" == "manual" ]]; then
  step "manual installation: copy templates/express, no SelfAuth tooling ($DB)"
  CLI=/nonexistent/selfauth-must-not-be-used
  cp -r "$REPO/templates/express" "$APP"
  cd "$APP"
  if grep -q '@selfauth/\|"selfauth"' package.json; then echo "FAIL template depends on SelfAuth"; exit 1; fi
  npm install --no-audit --no-fund --loglevel=error
  npm run -s typecheck
  expect "the template's own tests pass" "$(npm test 2>&1)" "# pass 6"
  npm run -s build
  cp .env.example .env
  START=(node --env-file=.env dist/server.js)
else
  step "selfauth init ($DB, frontend: $MODE)"
  node "$CLI" skill install "$APP" --agent claude > /dev/null
  expect "skill recommends init" "$(skill detect-project.ts "$APP")" "**Recommendation: init**"
  node "$CLI" init "$APP" --database "$DB" --frontend "$MODE" --permissions orders.view,orders.create --yes > /dev/null
  cd "$APP"
  echo "generated $(find . -type f | wc -l) files"

  step "npm install, typecheck, build"
  npm install --no-audit --no-fund --loglevel=error
  npm run -s typecheck
  expect "the generated project's own tests pass" "$(npm test 2>&1)" "# pass 6"
  npm run -s build
  if [[ "$MODE" != "none" ]]; then
    step "frontend ($MODE): install, typecheck, build"
    npm --prefix web install --no-audit --no-fund --loglevel=error
    npm --prefix web run -s typecheck
    npm --prefix web run -s build
    test -f web/dist/index.html
    grep -q 'name="referrer" content="no-referrer"' web/dist/index.html && echo "ok   built index.html sets Referrer-Policy"
  fi
  cp .env.example .env
  START=(node --env-file=.env dist/server.js)
fi
if [[ "$DB" == "postgresql" && "$MODE" == "manual" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" .env
  step "migrate with Prisma directly, seed roles"
  npm run -s db:migrate
  npm run -s db:seed
elif [[ "$DB" == "postgresql" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" .env
  step "selfauth db plan / migrate / validate"
  node "$CLI" db plan
  node "$CLI" db migrate
  node "$CLI" db status
  npm run -s db:seed
  node "$CLI" validate
fi

if [[ "$MODE" != "manual" ]]; then
  step "selfauth doctor"
  node "$CLI" doctor
fi

step "boot and exercise the API"
PORT="$PORT" "${START[@]}" > server.log 2>&1 &
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
if [[ "$MODE" == "vue" || "$MODE" == "react" ]]; then
  expect "notes example" "$(curl "${H[@]}" "localhost:$PORT/api/notes" -d '{"text":"from smoke"}')" '"from smoke"'
elif [[ "$MODE" == "add" ]]; then
  expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/account")" "\"email\":\"$EMAIL\""
else
  expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" "\"hello\":\"$EMAIL\""
fi
if [[ "$MODE" == "add" ]]; then
  expect "existing route untouched" "$(curl -s "localhost:$PORT/api/products")" '"Coffee"'
fi
if [[ "$MODE" != "manual" ]]; then
  step "agent skill: validate-auth (static checks, project scripts, live probes)"
  PROTECTED=/api/hello
  [[ "$MODE" == "vue" || "$MODE" == "react" ]] && PROTECTED=/api/notes
  [[ "$MODE" == "add" ]] && PROTECTED=/api/account
  VALIDATION="$(skill validate-auth.ts . --url "http://localhost:$PORT" --protected "$PROTECTED" || true)"
  echo "$VALIDATION"
  expect "validate-auth passes" "$VALIDATION" "RESULT: PASS"
  [[ "$MODE" != "add" ]] && expect "validate-auth ran the project's tests" "$VALIDATION" "PASS    backend: test"
  expect "skill reports SelfAuth installed" "$(skill detect-project.ts .)" "**Recommendation: upgrade**"
fi

step "CSRF and logout"
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated $DB project ($MODE): all checks passed."
