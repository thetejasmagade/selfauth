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
    label: "Express 5 + TypeScript (reference implementation, 87/87 conformance cases)",
    production: true,
    add: true,
  },
  {
    kind: "backend",
    id: "fastify",
    label:
      "Fastify 5 + TypeScript (87/87 conformance cases, authorization level; `selfauth init --backend fastify`)",
    production: true,
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
      "Vue 3 + Vite in web/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app",
    production: true,
    add: true,
  },
  {
    kind: "frontend",
    id: "react",
    label:
      "React + Vite in web/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app",
    production: true,
    add: true,
  },
];

export const PLANNED = ["MongoDB + Mongoose", "Prisma schema merging for `selfauth add`"];

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
  say("\nExisting Express + TypeScript projects: `selfauth add` (new files only, ADR 0019).");
  say(`Planned, not available yet: ${PLANNED.join("; ")}.`);
  return 0;
}
