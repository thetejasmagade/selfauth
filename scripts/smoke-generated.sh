#!/usr/bin/env bash
# Generates a project with the CLI outside the monorepo, installs it from npm,
# and proves it works: typecheck, build, migrations (PostgreSQL), and a real
# sign-up → email verification → login → protected route flow.
#   scripts/smoke-generated.sh memory [none|vue|react|add]
#   SMOKE_DATABASE_URL=postgresql://… scripts/smoke-generated.sh postgresql [none|vue|react]
# The second argument adds a frontend (installed, typechecked and built), or
# runs `selfauth add` against an existing Express app instead of `init`.
set -euo pipefail
DB="${1:?usage: smoke-generated.sh memory|postgresql [none|vue|react|add]}"
MODE="${2:-none}"
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

if [[ "$MODE" == "add" ]]; then
  step "existing Express app + selfauth add ($DB)"
  mkdir -p "$APP/src"
  cd "$APP"
  cat > package.json <<'JSON'
{ "name": "existing-app", "private": true, "type": "module",
  "dependencies": { "express": "^5.3.0" },
  "devDependencies": { "typescript": "~6.0.3", "@types/express": "^5.0.6", "@types/node": "^22.20.5" } }
JSON
  cat > tsconfig.json <<'JSON'
{
  // the app's own settings
  "compilerOptions": { "target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
    "types": ["node"], "strict": true, "skipLibCheck": true, "noEmit": true },
  "include": ["src"]
}
JSON
  printf '.env\nnode_modules/\n' > .gitignore
  npm install --no-audit --no-fund --loglevel=error
  node "$CLI" add . --database "$DB" --yes --install > add.log
  cat add.log | sed -n '/Finish the integration/,$p'
  # Apply the printed instructions, exactly as a developer would.
  sed -i 's#"noEmit": true }#"noEmit": true, "allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true }#' tsconfig.json
  cat > src/server.ts <<'TS'
import express from "express";
import { setupSelfAuth } from "./selfauth/setup.ts";

const app = express();
app.use(express.json());
const selfauth = await setupSelfAuth(app);
app.get("/api/legacy", (_req, res) => {
  res.json({ legacy: true });
});
app.get("/api/hello", selfauth.auth.requireAuth, (_req, res) => {
  res.json({ hello: selfauth.auth.context(res)!.user.email });
});
app.use(selfauth.errorHandler);
app.listen(Number(process.env["PORT"] ?? 3000));
TS
  npx tsc --noEmit
  printf 'NODE_ENV=development\nSELFAUTH_APP_BASE_URL=http://localhost:5173\n' > .env
  START=(node --env-file=.env src/server.ts)
else
  step "selfauth init ($DB, frontend: $MODE)"
  node "$CLI" init "$APP" --database "$DB" --frontend "$MODE" --permissions orders.view,orders.create --yes > /dev/null
  cd "$APP"
  echo "generated $(find . -type f | wc -l) files"

  step "npm install, typecheck, build"
  npm install --no-audit --no-fund --loglevel=error
  npm run -s typecheck
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
else
  expect "protected route" "$(curl "${H[@]}" "localhost:$PORT/api/hello")" "\"hello\":\"$EMAIL\""
fi
if [[ "$MODE" == "add" ]]; then
  expect "existing route untouched" "$(curl -s "localhost:$PORT/api/legacy")" '"legacy":true'
fi
expect "CSRF enforced" "$(curl -s -b jar -X POST "localhost:$PORT/auth/logout-all")" CSRF_FAILED
expect logout "$(curl "${H[@]}" -o /dev/null -w '%{http_code}' -X POST "localhost:$PORT/auth/logout")" 204
expect "signed out" "$(curl "${H[@]}" "localhost:$PORT/auth/me")" UNAUTHENTICATED
echo -e "\nGenerated $DB project ($MODE): all checks passed."
