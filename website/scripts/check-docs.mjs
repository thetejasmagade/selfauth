/* eslint-disable no-console, no-undef */
// Checks that the documentation covers what the code defines. Run with `pnpm docs:check`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(site, "..");
const problems = [];
const read = (p) => readFileSync(p, "utf8");

function pages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "scripts" || name === "public")
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}
const all = pages(site);
const text = (rel) => read(join(site, rel));

// 1. Frontmatter and placeholders
for (const file of all) {
  const rel = relative(site, file);
  const src = read(file);
  const fm = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? "";
  if (!/^title:\s*\S/m.test(fm)) problems.push(`${rel}: missing frontmatter title`);
  if (!/^description:\s*\S/m.test(fm)) problems.push(`${rel}: missing frontmatter description`);
  if (/\b(TODO|TBD|FIXME|lorem ipsum)\b/i.test(src.replace(/```[\s\S]*?```/g, "")))
    problems.push(`${rel}: contains a placeholder marker`);
}

// 2. Sidebar <-> pages
const config = read(join(site, ".vitepress/config.mts"));
const sidebarLinks = [...config.matchAll(/link: "(\/[^"#]*)"/g)].map((m) => m[1]);
const known = new Set(
  all.map(
    (f) =>
      "/" +
      relative(site, f)
        .replace(/\.md$/, "")
        .replace(/(^|\/)index$/, "$1"),
  ),
);
known.add("/");
for (const l of sidebarLinks) {
  const norm = l === "/" ? l : l.replace(/\/$/, "") || "/";
  const ok = known.has(l) || known.has(norm) || known.has(l + "index");
  if (!ok) problems.push(`config: link ${l} has no page`);
}
for (const k of known) {
  if (k === "/") continue;
  const inSide = sidebarLinks.some((l) => l === k || l.replace(/\/$/, "") === k.replace(/\/$/, ""));
  if (!inSide) problems.push(`page ${k} is not linked from the sidebar or nav`);
}

// 3. CLI commands and options
const bin = read(join(repo, "packages/cli/src/bin.ts"));
const cliText = [
  "reference/cli/index.md",
  "reference/cli/init.md",
  "reference/cli/add.md",
  "reference/cli/inspect.md",
  "reference/cli/upgrade.md",
  "reference/cli/db.md",
  "reference/cli/skill.md",
]
  .map(text)
  .join("\n");
for (const m of bin.matchAll(/\.command\("([a-z-]+)/g))
  if (!cliText.includes(m[1])) problems.push(`CLI command not documented: ${m[1]}`);
for (const m of bin.matchAll(/\.option\(\s*"(?:-[a-z], )?(--[a-z-]+)/g))
  if (!cliText.includes(m[1])) problems.push(`CLI option not documented: ${m[1]}`);
for (const m of bin.matchAll(/\["([a-z]+)", "/g))
  if (!text("reference/cli/db.md").includes(m[1]))
    problems.push(`db subcommand not documented: ${m[1]}`);

// 4. Configuration keys
const spec = read(join(repo, "packages/spec/specs/CONFIGURATION_SPEC.md"));
const confText = text("reference/config-file.md");
for (const m of spec.matchAll(/^\| `([a-zA-Z.<>]+)` \|/gm)) {
  const key = m[1];
  if (key.includes("<op>") || key === "specVersion") continue;
  const short = key.replace(/^authentication\./, "");
  if (!confText.includes("`" + short + "`") && !confText.includes(key))
    problems.push(`config key not documented: ${key}`);
}

// 5. HTTP routes
const httpDocs = read(join(repo, "docs/api/http.md"));
const httpText = text("reference/http.md");
for (const m of httpDocs.matchAll(/^\| `((?:GET|POST|DELETE) \/auth[^`]*)`/gm))
  if (!httpText.includes(m[1])) problems.push(`HTTP route not documented: ${m[1]}`);

// 6. Error codes
const errors = read(join(repo, "packages/spec/specs/ERRORS.md"));
const errText = text("reference/errors.md");
for (const m of errors.matchAll(/^\| `([A-Z_]+)` \|/gm))
  if (!errText.includes(m[1])) problems.push(`error code not documented: ${m[1]}`);

// 7. Environment variables
const envText = text("reference/environment.md");
const envNames = new Set();
for (const f of ["templates/express/src/config/env.ts", "templates/gin/internal/config/env.go"])
  for (const m of read(join(repo, f)).matchAll(
    /["']((?:SELFAUTH|NODE|APP|PORT|DATABASE)[A-Z_]*)["']/g,
  ))
    envNames.add(m[1]);
for (const n of envNames)
  if (!envText.includes(n)) problems.push(`environment variable not documented: ${n}`);

if (problems.length) {
  console.error(`Documentation check failed (${problems.length}):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`Documentation check passed: ${all.length} pages.`);
