import { spawnSync } from "node:child_process";
import { basename, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProject } from "../detect.js";
import { applyPlan, ConflictError, planInit } from "../plan.js";
import type { InitAnswers } from "../render.js";
import {
  BACKENDS,
  frontendInfo,
  type Backend,
  type Database,
  type Frontend,
} from "../templates.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface InitOptions {
  backend?: string;
  database?: string;
  frontend?: string;
  permissions?: string;
  appBaseUrl?: string;
  yes?: boolean;
  dryRun?: boolean;
  install?: boolean;
}

const DATABASES: Database[] = ["postgresql", "memory"];
const FRONTENDS: Frontend[] = ["none", "vue", "react"];

async function ask(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} (${fallback}) `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

/** `selfauth init [dir]`: generate a new project. Returns the process exit code. */
export async function init(dirArg: string | undefined, options: InitOptions): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  const project = await detectProject(dir);
  const interactive = process.stdin.isTTY && !options.yes;

  say(`SelfAuth init → ${dir}`);
  if (project.selfauth) {
    fail("This directory already contains a SelfAuth project (selfauth.manifest.json).");
    return 1;
  }
  if (project.hasPackageJson) {
    fail("This directory already has a package.json.");
    info(
      "For an existing Express or Fastify project use `selfauth add` (`selfauth detect` checks compatibility).",
    );
    if (project.existingAuth.length)
      warn(`Existing authentication packages detected: ${project.existingAuth.join(", ")}`);
    return 1;
  }
  if (!project.empty) info("Directory is not empty; existing files will never be overwritten.");

  let backend = options.backend as Backend | undefined;
  if (!backend && interactive)
    backend = (await ask(`Backend? ${BACKENDS.join(" | ")}`, "express")) as Backend;
  backend ??= "express";
  if (!BACKENDS.includes(backend)) {
    fail(
      `Unsupported backend '${backend}'. Supported: ${BACKENDS.join(", ")} (see \`selfauth list\`).`,
    );
    return 1;
  }
  let database = options.database as Database | undefined;
  if (!database && interactive)
    database = (await ask(`Database? ${DATABASES.join(" | ")}`, "postgresql")) as Database;
  database ??= "postgresql";
  if (!DATABASES.includes(database)) {
    fail(
      `Unsupported database '${database}'. Supported: ${DATABASES.join(", ")} (see \`selfauth list\`).`,
    );
    return 1;
  }
  let frontend = options.frontend as Frontend | undefined;
  if (!frontend && interactive)
    frontend = (await ask(`Frontend? ${FRONTENDS.join(" | ")}`, "none")) as Frontend;
  frontend ??= "none";
  if (!FRONTENDS.includes(frontend)) {
    fail(`Unsupported frontend '${frontend}'. Supported: ${FRONTENDS.join(", ")}.`);
    return 1;
  }
  let permissions = options.permissions;
  if (permissions === undefined && interactive) {
    permissions = await ask(
      "Application permissions, comma-separated (e.g. orders.view,orders.create)?",
      "",
    );
  }
  const answers: InitAnswers = {
    name:
      basename(dir)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "app",
    backend,
    database,
    frontend,
    permissions: (permissions ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    appBaseUrl:
      options.appBaseUrl ??
      `http://localhost:${frontend === "none" ? 5173 : frontendInfo(frontend).port}`,
  };

  let files;
  try {
    files = await planInit(answers);
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }

  say(
    `\nPlan: create ${files.length} files (${backend === "fastify" ? "Fastify" : "Express"} + ${database === "postgresql" ? "PostgreSQL/Prisma" : "in-memory store"}${frontend === "none" ? "" : ` + ${frontend} in client/`})`,
  );
  for (const f of files) say(`  + ${f.path}`);
  if (options.dryRun) {
    say("\nDry run: nothing written.");
    return 0;
  }
  if (interactive && !/^y(es)?$/i.test(await ask("\nCreate these files?", "y"))) {
    say("Cancelled. Nothing written.");
    return 1;
  }

  try {
    await applyPlan(dir, files);
  } catch (error) {
    if (error instanceof ConflictError) {
      fail(error.message);
      info("Nothing was written.");
      return 1;
    }
    throw error;
  }
  ok(
    frontend === "none"
      ? `Created ${files.length} files and selfauth.manifest.json`
      : `Created ${files.length} files: server/ (API), client/ (${frontend}) and a workspace root. Each package has its own selfauth.manifest.json.`,
  );

  if (options.install) {
    say("\nInstalling dependencies (npm install)…");
    const result = spawnSync("npm", ["install"], { cwd: dir, stdio: "inherit" });
    if (result.status !== 0) {
      fail("npm install failed; run it yourself after fixing the problem.");
      return 1;
    }
  }

  const cd = relative(process.cwd(), dir) || ".";
  say("\nNext steps:");
  if (cd !== ".") say(`  cd ${cd}`);
  const ws = frontend !== "none";
  if (!options.install)
    say(ws ? "  npm install               # installs server/ and client/" : "  npm install");
  say(
    `  cp ${ws ? "server/.env.example server/.env" : ".env.example .env"}` +
      (database === "postgresql" ? "   # set DATABASE_URL" : ""),
  );
  if (database === "postgresql") {
    say("  npx selfauth db plan      # review the migration first");
    say("  npm run db:migrate && npm run db:seed");
  }
  say(
    ws
      ? `  npm run dev               # API and ${frontend} app together; open ${answers.appBaseUrl}`
      : "  npm run dev",
  );
  say(
    `\nBefore production: implement createMailer() in ${ws ? "server/" : ""}src/email/mailer.ts, then run \`npx selfauth doctor\`.`,
  );
  return 0;
}
