// Copies template sources (the tested reference implementations) into
// dist/templates so the published CLI is self-contained, and records the
// dependency versions the reference apps were tested with.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkgDir, "..", "..");
const out = join(pkgDir, "dist", "templates");
const registry = JSON.parse(readFileSync(join(pkgDir, "src", "registry.json"), "utf8"));

const sources = new Set();
for (const stack of Object.values(registry.stacks)) {
  for (const f of stack.files) sources.add(f.source);
  if (stack.postgresql?.manifest) sources.add(stack.postgresql.manifest);
}
for (const source of sources) {
  mkdirSync(dirname(join(out, source)), { recursive: true });
  cpSync(join(repo, source), join(out, source), { recursive: true });
}

const versions = {};
for (const p of ["package.json", "apps/playground/package.json"]) {
  const pkg = JSON.parse(readFileSync(join(repo, p), "utf8"));
  Object.assign(versions, pkg.devDependencies, pkg.dependencies);
}
for (const [name, v] of Object.entries(versions)) if (String(v).startsWith("workspace:")) delete versions[name];
writeFileSync(join(out, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
console.log(`bundled ${sources.size} template sources into dist/templates`);
