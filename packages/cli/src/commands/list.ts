import { say } from "./output.js";

export interface Integration {
  kind: "backend" | "database" | "frontend";
  id: string;
  label: string;
  /** Usable in production (the in-memory store is for trying SelfAuth out). */
  production: boolean;
  /** Available to `selfauth add` as well as `selfauth init`. */
  add: boolean;
}

/** What the CLI can generate. Agents must not offer anything outside this list (plan §7). */
export const INTEGRATIONS: Integration[] = [
  {
    kind: "backend",
    id: "express",
    label: "Express 5 + TypeScript (reference implementation, 90/90 conformance cases)",
    production: true,
    add: true,
  },
  {
    kind: "backend",
    id: "fastify",
    label:
      "Fastify 5 + TypeScript (90/90 conformance cases, authorization level; `selfauth init --backend fastify`)",
    production: true,
    add: true,
  },
  {
    kind: "backend",
    id: "gin",
    label:
      "Gin (Go): a Go port of the core, 90/90 conformance cases on PostgreSQL and in-memory; API only; new projects (`selfauth init --backend gin`)",
    production: false,
    add: false,
  },
  {
    kind: "database",
    id: "postgresql",
    label: "PostgreSQL via Prisma 7 (migrations reviewed with `selfauth db plan`)",
    production: true,
    add: true,
  },
  {
    kind: "database",
    id: "mysql",
    label:
      "MySQL 8 via Prisma 7 (derived from the PostgreSQL reference; 90/90 conformance cases, authorization level)",
    production: true,
    add: true,
  },
  {
    kind: "database",
    id: "mongodb",
    label:
      "MongoDB 6+ via Mongoose 9 (its own store, not derived from SQL; authorization level; indexes via `selfauth db migrate`)",
    production: true,
    add: true,
  },
  {
    kind: "database",
    id: "sqlite",
    label:
      "SQLite via Prisma 7: one file on one host, no server to run (derived from the PostgreSQL reference; 90/90 conformance cases, authorization level)",
    production: true,
    add: true,
  },
  {
    kind: "database",
    id: "memory",
    label: "In-memory store for trying SelfAuth out (not for production)",
    production: false,
    add: true,
  },
  { kind: "frontend", id: "none", label: "API only", production: true, add: true },
  {
    kind: "frontend",
    id: "vue",
    label:
      "Vue 3 + Vite in client/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app",
    production: true,
    add: true,
  },
  {
    kind: "frontend",
    id: "react",
    label:
      "React + Vite in client/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app",
    production: true,
    add: true,
  },
];

export const PLANNED = ["Prisma schema merging for `selfauth add`"];

export function list(options: { json?: boolean } = {}): number {
  if (options.json) {
    say(JSON.stringify({ integrations: INTEGRATIONS, planned: PLANNED }, null, 2));
    return 0;
  }
  say("Supported integrations (selfauth init):\n");
  const titles = { backend: "Backend", database: "Database", frontend: "Frontend" };
  let last = "";
  for (const i of INTEGRATIONS) {
    const title = i.kind === last ? "" : titles[i.kind];
    last = i.kind;
    say(`  ${title.padEnd(10)} ${i.id.padEnd(16)} ${i.label}`);
  }
  say(
    "\nExisting Express or Fastify + TypeScript projects: `selfauth add` (new files only, ADR 0019).\nGin supports PostgreSQL and in-memory only, no frontend, and new projects only.",
  );
  say(`Planned, not available yet: ${PLANNED.join("; ")}.`);
  return 0;
}
