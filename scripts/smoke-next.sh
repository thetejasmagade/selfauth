#!/usr/bin/env bash
# Generates a Next.js project with the CLI outside the monorepo and proves it works: install,
# typecheck, the project's own tests, `next build` (with no environment variables), migrations,
# and a real sign-up → email verification → login → protected route flow against `next dev`,
# then the agent skill's validate-auth against the running server.
#   scripts/smoke-next.sh memory                 (Next.js API only)
#   scripts/smoke-next.sh memory next            (one Next.js app: pages and API)
#   scripts/smoke-next.sh memory react           (Next.js API in server/, a Vite React app in client/)
#   scripts/smoke-next.sh memory next express    (an Express API in server/, a Next.js app in client/)
#   scripts/smoke-next.sh sqlite                 (a database file in the project; no server)
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-next.sh postgresql [frontend] [backend]
#   SMOKE_MYSQL_URL=mysql://… scripts/smoke-next.sh mysql [frontend] [backend]
#   SMOKE_MONGODB_URL=mongodb://… scripts/smoke-next.sh mongodb [frontend] [backend]
# Needs the built CLI (pnpm build).
set -euo pipefail
DB="${1:?usage: smoke-next.sh memory|postgresql|mysql|sqlite|mongodb [none|vue|react|next] [next|express|fastify]}"
FRONTEND="${2:-none}"
BACKEND="${3:-next}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${SELFAUTH_SMOKE_CLI:-$REPO/packages/cli/dist/bin.js}"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3971}"
# `next dev` starts child processes that keep writing into the project, so the whole process group
# is stopped (the server runs under setsid) before the folder is removed.
cleanup() {
  [[ -n "${SERVER:-}" ]] && kill -- "-$SERVER" 2>/dev/null || true
  sleep 1
  rm -rf "$WORK" 2>/dev/null || { sleep 2; rm -rf "$WORK" || true; }
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
skill() { SELFAUTH_CLI="$CLI" node "$APP/.claude/skills/selfauth/scripts/$1" "${@:2}"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

step "selfauth init ($BACKEND, $DB, frontend: $FRONTEND)"
node "$CLI" skill install "$APP" --agent claude > /dev/null
expect "skill recommends init" "$(skill detect-project.ts "$APP")" "**Recommendation: init**"
node "$CLI" init "$APP" --backend "$BACKEND" --database "$DB" --frontend "$FRONTEND" --permissions orders.view,orders.create --yes > /dev/null
cd "$APP"
echo "generated $(find . -type f -not -path './.claude/*' | wc -l) files"

# One package (the Next.js API, alone or with its own pages), or a workspace of server/ and client/.
if [[ "$FRONTEND" == "none" || ( "$BACKEND" == "next" && "$FRONTEND" == "next" ) ]]; then
  ENVFILE=.env
  SERVER_DIR="$APP"
  test ! -e server && test ! -e client
else
  ENVFILE=server/.env
  SERVER_DIR="$APP/server"
  test -f server/package.json && test -f client/package.json && test -f server/selfauth.manifest.json && test -f client/selfauth.manifest.json
fi

step "npm install, typecheck, the project's own tests, build"
npm install --no-audit --no-fund --loglevel=error
npm run -s typecheck
# The workspace root's `npm test` runs the server's tests; a single package runs its own.
# (The Next.js project ships 7 smoke tests, the Express and Fastify ones 6.)
PASSING=6
[[ "$BACKEND" == "next" ]] && PASSING=7
expect "the generated project's own tests pass" "$(npm test 2>&1)" "# pass $PASSING"
# `next build` needs no environment variables: SelfAuth starts on the first request.
env -u DATABASE_URL -u SELFAUTH_APP_BASE_URL npm run -s build
if [[ "$FRONTEND" == "next" && "$BACKEND" == "next" ]]; then
  test -d .next
  echo "ok   the pages are built"
elif [[ "$FRONTEND" == "next" ]]; then
  test -d client/.next && echo "ok   the Next.js client is built"
elif [[ "$FRONTEND" != "none" ]]; then
  test -f client/dist/index.html && echo "ok   the client is built"
fi
cp "$([[ "$ENVFILE" == .env ]] && echo .env.example || echo server/.env.example)" "$ENVFILE"

if [[ "$DB" != "memory" ]]; then
  if [[ "$DB" == "sqlite" ]]; then SMOKE_DATABASE_URL="file:./smoke.db"
  elif [[ "$DB" == "mongodb" ]]; then : "${SMOKE_MONGODB_URL:?set SMOKE_MONGODB_URL}"; SMOKE_DATABASE_URL="$SMOKE_MONGODB_URL"
  elif [[ "$DB" == "mysql" ]]; then : "${SMOKE_MYSQL_URL:?set SMOKE_MYSQL_URL}"; SMOKE_DATABASE_URL="$SMOKE_MYSQL_URL"
  else : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"; fi
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" "$ENVFILE"
  step "selfauth db plan / migrate / status, seed"
  node "$CLI" db plan
  node "$CLI" db migrate
  node "$CLI" db status
  npm run -s db:seed
fi

step "selfauth doctor and validate"
node "$CLI" doctor
node "$CLI" validate

step "boot the API with next dev and exercise it"
# `next dev` runs development mode (a printed mailer, plain-http cookies); `next start` is
# production, which refuses to start until a real mailer is configured.
export PORT
if [[ "$BACKEND" == "next" ]]; then
  setsid bash -c 'cd "$1" && exec npx next dev' _ "$SERVER_DIR" > server.log 2>&1 &
else
  # Express/Fastify API with a Next.js client: the API is the server under test.
  setsid bash -c 'cd "$1" && exec node --env-file=.env --watch src/server.ts' _ "$SERVER_DIR" > server.log 2>&1 &
fi
SERVER=$!
for _ in $(seq 1 300); do curl -sf "localhost:$PORT/health" > /dev/null && break; sleep 0.2; done
curl -sf "localhost:$PORT/health" > /dev/null || { echo "FAIL the server did not start"; cat server.log; exit 1; }
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
EMAIL="smoke@example.test"
PASSWORD="correct horse battery staple"

expect register "$(curl "${H[@]}" "localhost:$PORT/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" '"accepted"'
expect "login before verification" "$(curl "${H[@]}" "localhost:$PORT/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" EMAIL_NOT_VERIFIED
TOKEN="$(grep -o 'token=[A-Za-z0-9_-]*' server.log | head -1 | cut -d= -f2)"
expect verify "$(curl "${H[@]}" "localhost:$PORT/auth/email/verify" -d "{\"token\":\"$TOKEN\"}")" '"verified"'
expect login "$(curl "${H[@]}" "localhost:$PORT/auth/login" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" "\"email\":\"$EMAIL\""
expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" "\"hello\":\"$EMAIL\""
expect "unknown API path gets the error envelope" "$(curl -s "localhost:$PORT/api/no/such/route")" NOT_FOUND
if [[ "$BACKEND" == "next" && "$FRONTEND" == "next" ]]; then
  step "the pages are served by the same app"
  # The pages look the session up in the browser, so the server's HTML is the shell, not the form.
  expect "login page" "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/login")" 200
  expect "register page" "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/register")" 200
  expect "an unknown page is Next.js's own 404" "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/no/such/page")" 404
fi
if [[ "$DB" != "memory" ]]; then
  step "create-admin (a developer-run command, never the API)"
  (cd "$SERVER_DIR" && npm run -s db:create-admin "$EMAIL") | grep -q "administrator"
  expect "admin role is read on the next request" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" '"admin"'
fi

step "agent skill: validate-auth (static checks, the project's tests, live probes)"
VALIDATION="$(skill validate-auth.ts "$APP" --url "http://localhost:$PORT" --protected /api/hello || true)"
echo "$VALIDATION"
expect "validate-auth passes" "$VALIDATION" "RESULT: PASS"
expect "skill reports SelfAuth installed" "$(skill detect-project.ts "$APP")" "**Recommendation: upgrade**"

step "CSRF and logout"
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated $BACKEND project ($DB, frontend: $FRONTEND): all checks passed."
