#!/usr/bin/env bash
# Packs every published package exactly as `pnpm publish` would, checks each
# tarball's contents, installs the tarballs into an empty project outside the
# monorepo with npm, and runs the installed CLI.
#   scripts/pack-check.sh [install-dir]
# The install dir (default: a temp dir) is kept so CI can run the smoke test
# with the packaged CLI: SELFAUTH_SMOKE_CLI=<dir>/node_modules/@selfauth/cli/dist/bin.js
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
INSTALL="${1:-$(mktemp -d)}"
PACKAGES=(packages/spec packages/migration conformance packages/cli packages/selfauth)

fail() { echo "FAIL $*"; exit 1; }
ok() { echo "ok   $*"; }

for p in "${PACKAGES[@]}"; do
  (cd "$REPO/$p" && pnpm pack --pack-destination "$OUT" > /dev/null)
done
cd "$OUT"
for tgz in *.tgz; do
  files="$(tar -tzf "$tgz")"
  for required in package/package.json package/README.md package/LICENSE; do
    grep -qx "$required" <<< "$files" || fail "$tgz is missing $required"
  done
  if grep -E '^package/(src|test|scripts)/|\.test\.|tsconfig|\.tsbuildinfo$' <<< "$files" | grep -v '^package/dist/templates/' | grep -v '^package/dist/skill/' > /dev/null; then
    fail "$tgz ships sources or tests: $(grep -E '^package/(src|test|scripts)/' <<< "$files" | grep -v dist | head -3)"
  fi
  manifest="$(tar -xzOf "$tgz" package/package.json)"
  grep -q '"workspace:' <<< "$manifest" && fail "$tgz still has workspace: dependencies"
  ok "$tgz ($(wc -l <<< "$files") files)"
done
cli_files="$(tar -tzf selfauth-cli-*.tgz)"
for required in package/dist/bin.js package/dist/templates/versions.json package/dist/skill/selfauth/SKILL.md \
  package/dist/templates/apps/playground/src/auth/core/crypto.ts; do
  grep -qx "$required" <<< "$cli_files" || fail "@selfauth/cli tarball is missing $required"
done
grep -q '^package/specs/AUTHENTICATION_SPEC.md$' <<< "$(tar -tzf selfauth-spec-*.tgz)" || fail "@selfauth/spec ships no specs/"
ok "tarball contents"

mkdir -p "$INSTALL" && cd "$INSTALL"
[[ -f package.json ]] || echo '{ "name": "pack-check", "private": true, "type": "module" }' > package.json
npm install --no-audit --no-fund --loglevel=error "$OUT"/*.tgz
VERSION="$(node -p "require('$REPO/packages/cli/package.json').version")"
[[ "$(npx --no-install selfauth --version)" == "$VERSION" ]] || fail "npx selfauth --version"
ok "npx selfauth --version → $VERSION (the selfauth wrapper)"
node node_modules/@selfauth/cli/dist/bin.js list --json > /dev/null && ok "installed @selfauth/cli runs"
node -e "import('@selfauth/spec').then(m => { if (!m.SPEC_VERSION) process.exit(1) })" && ok "@selfauth/spec imports"
node -e "import('@selfauth/migration').then(m => { if (!m.PrismaMigrationAdapter) process.exit(1) })" && ok "@selfauth/migration imports"
node node_modules/@selfauth/conformance/dist/report.js > /dev/null && ok "selfauth-coverage runs"
echo -e "\nPackages OK. Installed in $INSTALL"
