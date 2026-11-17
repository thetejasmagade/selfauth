#!/usr/bin/env bash
# Generates a project with the CLI outside the monorepo, installs it from npm,
# and proves it works: typecheck, build, migrations (PostgreSQL), and a real
# sign-up → email verification → login → protected route flow.
#   scripts/smoke-generated.sh memory [none|vue|react|add|add-layout|manual]
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-generated.sh postgresql [none|vue|react|manual]
# The second argument adds a frontend (installed, typechecked and built), or
# runs `selfauth add` against an existing Express app instead of `init` (add-layout:
# the app's code lives in server/, not src/), or
# (manual) copies templates/express by hand and never runs any SelfAuth tool:
# plain npm and Prisma, as in docs/manual-integration.md.
# Each run also follows the agent skill's workflow: the skill is installed
# with `selfauth skill install`, and its detect-project / validate-auth scripts
# (the installed copies) must recommend the right command and pass.
set -euo pipefail
DB="${1:?usage: smoke-generated.sh memory|postgresql [none|vue|react|add|add-layout|manual]}"
MODE="${2:-none}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# SELFAUTH_SMOKE_CLI: run a packaged CLI (scripts/pack-check.sh) instead of the workspace build.
CLI="${SELFAUTH_SMOKE_CLI:-$REPO/packages/cli/dist/bin.js}"
WORK="$(mktemp -d)"
APP="$WORK/app"
PORT="${SMOKE_PORT:-3950}"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

# Where the API's .env lives: the project root, or server/ in a full-stack project (two packages).
ENVFILE=.env

step() { printf '\n== %s\n' "$*"; }
# The installed skill's scripts, run as an agent would (SELFAUTH_CLI: this build, not npm).
skill() { SELFAUTH_CLI="$CLI" node "$APP/.claude/skills/selfauth/scripts/$1" "${@:2}"; }
expect() { # expect <label> <haystack> <needle>
  if [[ "$2" != *"$3"* ]]; then echo "FAIL $1: expected '$3' in: $2"; exit 1; fi
  echo "ok   $1"
}

if [[ "$MODE" == "add" || "$MODE" == "add-layout" ]]; then
  step "existing Express app + selfauth add ($DB, $MODE)"
  # examples/existing-express-app: a small shop API with its own test suite.
  mkdir -p "$APP"
  cp -r "$REPO/examples/existing-express-app/." "$APP"
  cd "$APP"
  SRC=src
  PATCH="$REPO/examples/existing-express-app.selfauth.patch"
  if [[ "$MODE" == "add-layout" ]]; then
    # The same app with its code in server/: no src/ folder, tsconfig lists "server".
    SRC=server
    mv src server
    sed -i 's#src/#server/#g; s#"src"#"server"#g' package.json tsconfig.json test/app.test.ts
    PATCH="$WORK/layout.patch"
    sed 's#src/#server/#g; s#"src"#"server"#g' "$REPO/examples/existing-express-app.selfauth.patch" > "$PATCH"
  fi
  npm install --no-audit --no-fund --loglevel=error
  expect "existing tests pass before" "$(npm test 2>&1)" "# pass 3"
  step "agent skill: install, detect"
  node "$CLI" skill install . --agent claude > /dev/null
  expect "skill recommends add" "$(skill detect-project.ts .)" "**Recommendation: add**"
  if [[ "$MODE" == "add-layout" ]]; then
    expect "detect finds the source folder" "$(skill detect-project.ts .)" "server/selfauth/"
  fi
  node "$CLI" add . --database "$DB" --yes --install > add.log
  expect "files are under $SRC/selfauth" "$(ls "$SRC/selfauth")" "setup.ts"
  if [[ "$MODE" == "add-layout" ]]; then test ! -e src; fi
  cat add.log | sed -n '/Finish the integration/,$p'
  # The edits an agent makes after `add` (wiring, one protected route, tsconfig, .env loading),
  # kept as a reviewable patch next to the example.
  patch -p1 < "$PATCH"
  npx tsc --noEmit
  printf 'NODE_ENV=development\nSELFAUTH_APP_BASE_URL=http://localhost:5173\n' > .env
  expect "existing tests still pass, plus the new one" "$(npm test 2>&1)" "# pass 4"
  START=(node --env-file=.env "$SRC/server.ts")
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
    step "full-stack ($MODE): two packages in one workspace, built by the root scripts"
    # One `npm install` at the root installed server/ and client/; `typecheck` and `build` above
    # ran both packages.
    test -f server/package.json && test -f client/package.json
    test ! -e web && test ! -e src
    test -f server/selfauth.manifest.json && test -f client/selfauth.manifest.json
    test -f client/dist/index.html
    grep -q 'name="referrer" content="no-referrer"' client/dist/index.html && echo "ok   built index.html sets Referrer-Policy"

    step "separate frontend: add-frontend into a copy of client/ whose auth module was removed"
    # An existing app that has no SelfAuth yet: same pages, auth module absent, then added elsewhere.
    WEB2="$WORK/web2"
    mkdir -p "$WEB2"
    (cd client && tar --exclude=node_modules --exclude=dist --exclude=src/auth --exclude=selfauth.manifest.json -cf - .) | tar -xf - -C "$WEB2"
    # Outside the workspace there is no root file to sync from (docs/customization.md): drop the hooks.
    (cd "$WEB2" && node -e 'const f="package.json",p=JSON.parse(require("fs").readFileSync(f));for(const k of Object.keys(p.scripts))if(k==="sync"||k.startsWith("pre"))delete p.scripts[k];require("fs").writeFileSync(f,JSON.stringify(p,null,2))')
    # Re-point only imports of the module (…/auth/index.ts), not the pages/auth/ folder.
    grep -rl '/auth/index.ts' "$WEB2/src" | xargs sed -i 's#/auth/index\.ts#/selfauth/index.ts#g'
    (cd "$WEB2" && node "$CLI" add-frontend --yes > "$WORK/add-frontend.log" \
      && sed -n '/Finish the integration/,$p' "$WORK/add-frontend.log" | head -12 \
      && npm install --no-audit --no-fund --loglevel=error \
      && npm run -s typecheck && npm run -s build && node "$CLI" validate . \
      && test -f dist/index.html)
    echo "ok   frontend module works from src/selfauth in a separate app"
  fi
  if [[ "$MODE" == "none" ]]; then
    cp .env.example .env
    START=(node --env-file=.env dist/server.js)
  else
    ENVFILE=server/.env
    cp server/.env.example "$ENVFILE"
    START=(node "--env-file=$ENVFILE" server/dist/server.js)
  fi
fi
if [[ "$DB" == "postgresql" && "$MODE" == "manual" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" "$ENVFILE"
  step "migrate with Prisma directly, seed roles"
  npm run -s db:migrate
  npm run -s db:seed
elif [[ "$DB" == "postgresql" ]]; then
  : "${SMOKE_DATABASE_URL:?set SMOKE_DATABASE_URL}"
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$SMOKE_DATABASE_URL#" "$ENVFILE"
  step "selfauth db plan / migrate / validate (from the project root)"
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
elif [[ "$MODE" == "add" || "$MODE" == "add-layout" ]]; then
  expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/account")" "\"email\":\"$EMAIL\""
else
  expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" "\"hello\":\"$EMAIL\""
fi
if [[ "$MODE" == "add" || "$MODE" == "add-layout" ]]; then
  expect "existing route untouched" "$(curl -s "localhost:$PORT/api/products")" '"Coffee"'
fi
if [[ "$MODE" != "manual" ]]; then
  step "agent skill: validate-auth (static checks, project scripts, live probes)"
  PROTECTED=/api/hello
  [[ "$MODE" == "vue" || "$MODE" == "react" ]] && PROTECTED=/api/notes
  [[ "$MODE" == "add" || "$MODE" == "add-layout" ]] && PROTECTED=/api/account
  VALIDATION="$(skill validate-auth.ts . --url "http://localhost:$PORT" --protected "$PROTECTED" || true)"
  echo "$VALIDATION"
  expect "validate-auth passes" "$VALIDATION" "RESULT: PASS"
  # The root scripts of a full-stack project run server/ and client/ ("workspace").
  TESTS_LABEL=backend
  [[ "$MODE" == "vue" || "$MODE" == "react" ]] && TESTS_LABEL=workspace
  [[ "$MODE" != "add" && "$MODE" != "add-layout" ]] && expect "validate-auth ran the project's tests" "$VALIDATION" "PASS    $TESTS_LABEL: test"
  expect "skill reports SelfAuth installed" "$(skill detect-project.ts .)" "**Recommendation: upgrade**"
fi

step "CSRF and logout"
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated $DB project ($MODE): all checks passed."
