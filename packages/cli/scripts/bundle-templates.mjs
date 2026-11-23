/* global console */
/* eslint-disable no-console -- build script output */
// Copies template sources (the tested reference implementations) into
// dist/templates so the published CLI is self-contained, and records the
// dependency versions the reference apps were tested with.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkgDir, "..", "..");
const out = join(pkgDir, "dist", "templates");
const registry = JSON.parse(readFileSync(join(pkgDir, "src", "registry.json"), "utf8"));

// Start clean: a file moved or deleted in the reference apps must not survive in an old dist/.
rmSync(out, { recursive: true, force: true });

const sources = new Set();
for (const stack of [...Object.values(registry.stacks), ...Object.values(registry.frontends)]) {
  for (const f of stack.files) sources.add(f.source);
  if (stack.postgresql?.manifest) sources.add(stack.postgresql.manifest);
}
for (const dialect of Object.values(registry.dialects ?? {})) sources.add(dialect.migrations);
for (const source of sources) {
  mkdirSync(dirname(join(out, source)), { recursive: true });
  cpSync(join(repo, source), join(out, source), { recursive: true });
}

const versions = {};
for (const p of [
  "package.json",
  "apps/playground/package.json",
  "apps/playground-fastify/package.json",
  "apps/playground-next/package.json",
  "apps/playground-vue/package.json",
  "apps/playground-react/package.json",
  "apps/playground-next-web/package.json",
]) {
  const pkg = JSON.parse(readFileSync(join(repo, p), "utf8"));
  Object.assign(versions, pkg.devDependencies, pkg.dependencies);
}
for (const [name, v] of Object.entries(versions))
  if (String(v).startsWith("workspace:")) delete versions[name];
writeFileSync(join(out, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
console.log(`bundled ${sources.size} template sources into dist/templates`);

// The agent skill ships with the CLI so `selfauth skill install` matches the CLI's commands.
rmSync(join(pkgDir, "dist", "skill"), { recursive: true, force: true });
cpSync(join(repo, "skills", "selfauth"), join(pkgDir, "dist", "skill", "selfauth"), {
  recursive: true,
});
console.log("bundled the selfauth skill into dist/skill");
