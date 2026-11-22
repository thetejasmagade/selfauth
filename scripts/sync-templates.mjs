/* global console, process */
/* eslint-disable no-console -- build script output */
// Writes templates/: complete, copyable projects for manual installation
// (no CLI, no LLM). Each is exactly what the CLI generates (planInit/planAdd
// from the built @selfauth/cli), so it's the tested reference implementation.
//   node scripts/sync-templates.mjs           rewrite templates/
//   node scripts/sync-templates.mjs --check   fail if templates/ is stale
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repo, "packages/cli/dist/index.js");
if (!existsSync(cli)) throw new Error("build @selfauth/cli first (pnpm build)");
const { planInit, planAdd } = await import(cli);

const base = { permissions: [], appBaseUrl: "http://localhost:5173" };
/** Directory under templates/ → what the CLI would generate. */
export const TEMPLATES = {
  express: () =>
    planInit({ ...base, name: "selfauth-app", database: "postgresql", frontend: "none" }),
  "express-vue": () =>
    planInit({ ...base, name: "selfauth-app", database: "postgresql", frontend: "vue" }),
  "express-react": () =>
    planInit({ ...base, name: "selfauth-app", database: "postgresql", frontend: "react" }),
  fastify: () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "fastify",
      database: "postgresql",
      frontend: "none",
    }),
  "fastify-vue": () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "fastify",
      database: "postgresql",
      frontend: "vue",
    }),
  "fastify-react": () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "fastify",
      database: "postgresql",
      frontend: "react",
    }),
  next: () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "next",
      database: "postgresql",
      frontend: "none",
    }),
  "next-next": () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "next",
      database: "postgresql",
      frontend: "next",
      appBaseUrl: "http://localhost:3000",
    }),
  "express-next": () =>
    planInit({
      ...base,
      name: "selfauth-app",
      database: "postgresql",
      frontend: "next",
      appBaseUrl: "http://localhost:5175",
    }),
  gin: () =>
    planInit({
      ...base,
      name: "selfauth-app",
      backend: "gin",
      database: "postgresql",
      frontend: "none",
    }),
  "existing-express": () =>
    planAdd({ ...base, name: "existing-app", database: "postgresql", frontend: "none" }),
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  // Ignore what running a template in place creates (npm install, build, prisma generate).
  return readdirSync(dir)
    .filter(
      (n) => !["node_modules", "dist", "generated", ".env", ".next", "next-env.d.ts"].includes(n),
    )
    .flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
}

const check = process.argv.includes("--check");
let stale = 0;
for (const [name, plan] of Object.entries(TEMPLATES)) {
  const root = join(repo, "templates", name);
  const files = await plan();
  const expected = new Map(files.map((f) => [f.path, f.content]));
  const actual = new Map(
    walk(root).map((f) => [relative(root, f).split("\\").join("/"), readFileSync(f, "utf8")]),
  );
  const changed = [
    ...[...expected].filter(([p, c]) => actual.get(p) !== c).map(([p]) => p),
    ...[...actual.keys()].filter((p) => !expected.has(p)),
  ];
  if (!changed.length) continue;
  if (check) {
    console.error(
      `templates/${name} is stale: ${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}`,
    );
    stale++;
    continue;
  }
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of expected) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  console.log(`wrote templates/${name} (${expected.size} files)`);
}
if (stale) {
  console.error("Run `pnpm templates:sync` (after `pnpm build`).");
  process.exit(1);
}
