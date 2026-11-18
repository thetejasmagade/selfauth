import { spawnSync } from "node:child_process";
import { basename, relative, resolve } from "node:path";
import { detectProject } from "../detect.js";
import { applyPlan, ConflictError, planInit } from "../plan.js";
import { createPrompter, PromptCancelled, type Prompter } from "../prompt.js";
import {
  appBaseUrlProblem,
  parsePermissions,
  permissionProblem,
  type InitAnswers,
} from "../render.js";
import {
  BACKENDS,
  DATABASE_INFO,
  DATABASES,
  usesPrisma,
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
  /** Tests supply their own questions; the CLI uses the terminal prompts. */
  prompter?: Prompter;
}

const FRONTENDS: Frontend[] = ["none", "vue", "react"];

/** Folder names `init` accepts when it asks for one: a plain relative path, or `.` for here. */
const FOLDER = /^(\.|[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/;

async function folderProblem(answer: string): Promise<string | null> {
  if (!FOLDER.test(answer)) {
    return "Use a simple folder name such as my-app (letters, numbers, . _ -), or . for the current folder.";
  }
  const project = await detectProject(resolve(answer));
  if (project.selfauth) return `${answer} already contains a SelfAuth project.`;
  if (project.hasPackageJson) {
    return `${answer} already has a package.json. For an existing project use \`selfauth add\`.`;
  }
  return null;
}

const permissionsProblem = (answer: string): string | null =>
  parsePermissions(answer).map(permissionProblem).find(Boolean) ?? null;

/** `selfauth init [dir]`: generate a new project. Returns the process exit code. */
export async function init(dirArg: string | undefined, options: InitOptions): Promise<number> {
  // Flags are checked before anything is asked, so a typo fails at once.
  for (const [label, value, allowed] of [
    ["backend", options.backend, BACKENDS],
    ["database", options.database, DATABASES],
    ["frontend", options.frontend, FRONTENDS],
  ] as const) {
    if (value !== undefined && !(allowed as readonly string[]).includes(value)) {
      fail(
        `Unsupported ${label} '${value}'. Supported: ${allowed.join(", ")} (see \`selfauth list\`).`,
      );
      return 1;
    }
  }
  const invalid =
    parsePermissions(options.permissions).map(permissionProblem).find(Boolean) ??
    (options.appBaseUrl === undefined ? null : appBaseUrlProblem(options.appBaseUrl));
  if (invalid) {
    fail(invalid);
    return 1;
  }

  // Questions are asked only in a terminal, and only for what no flag already answered.
  const prompter =
    options.prompter ?? (process.stdin.isTTY && !options.yes ? createPrompter() : undefined);
  try {
    return await run(dirArg, options, prompter);
  } catch (error) {
    if (error instanceof PromptCancelled) {
      say("\nCancelled. Nothing written.");
      return 130;
    }
    throw error;
  }
}

async function run(
  dirArg: string | undefined,
  options: InitOptions,
  prompter: Prompter | undefined,
): Promise<number> {
  if (prompter) {
    say("SelfAuth: new project (Ctrl-C cancels; nothing is written until you confirm)\n");
  }
  let folder = dirArg;
  if (folder === undefined && prompter) {
    const here = await detectProject(resolve("."));
    folder = await prompter.text("Project folder (. for the current folder)", {
      default: here.empty ? "." : "my-app",
      validate: folderProblem,
    });
  }
  const dir = resolve(folder ?? ".");
  const project = await detectProject(dir);

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

  const backend = (options.backend ??
    (prompter
      ? await prompter.select<Backend>(
          "Which backend?",
          [
            { value: "express", label: "Express 5", hint: "the reference implementation" },
            { value: "fastify", label: "Fastify 5", hint: "same core, Fastify adapter" },
          ],
          "express",
        )
      : "express")) as Backend;
  const database = (options.database ??
    (prompter
      ? await prompter.select<Database>(
          "Which database?",
          [
            { value: "postgresql", label: "PostgreSQL", hint: "via Prisma; for real use" },
            { value: "mysql", label: "MySQL", hint: "via Prisma; MySQL 8 or MariaDB" },
            { value: "sqlite", label: "SQLite", hint: "via Prisma; one file, no server to run" },
            {
              value: "memory",
              label: "In-memory",
              hint: "to try SelfAuth out; not for production",
            },
          ],
          "postgresql",
        )
      : "postgresql")) as Database;
  const frontend = (options.frontend ??
    (prompter
      ? await prompter.select<Frontend>(
          "Which frontend?",
          [
            { value: "none", label: "None", hint: "API only" },
            { value: "vue", label: "Vue 3", hint: "Vite, in client/" },
            { value: "react", label: "React", hint: "Vite, in client/" },
          ],
          "none",
        )
      : "none")) as Frontend;
  const permissions =
    options.permissions ??
    (prompter
      ? await prompter.text(
          "Application permissions, comma-separated (e.g. orders.view,orders.create; Enter for none)",
          { validate: permissionsProblem },
        )
      : "");
  // A generated frontend has a known dev-server address; an API-only project needs yours.
  const appBaseUrl =
    options.appBaseUrl ??
    (frontend === "none" && prompter
      ? await prompter.text("Where will your frontend run? (used in email links)", {
          default: "http://localhost:5173",
          validate: appBaseUrlProblem,
        })
      : `http://localhost:${frontend === "none" ? 5173 : frontendInfo(frontend).port}`);
  const install =
    options.install ??
    (prompter ? await prompter.confirm("Run npm install after creating the files?", true) : false);

  const answers: InitAnswers = {
    name:
      basename(dir)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "app",
    backend,
    database,
    frontend,
    permissions: parsePermissions(permissions),
    appBaseUrl,
  };

  let files;
  try {
    files = await planInit(answers);
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }

  say(
    `\nPlan: create ${files.length} files (${backend === "fastify" ? "Fastify" : "Express"} + ${usesPrisma(database) ? `${DATABASE_INFO[database].label}/Prisma` : "in-memory store"}${frontend === "none" ? "" : ` + ${frontend} in client/`})`,
  );
  for (const f of files) say(`  + ${f.path}`);
  if (options.dryRun) {
    say("\nDry run: nothing written.");
    return 0;
  }
  if (prompter && !(await prompter.confirm("Create these files?", true))) {
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

  if (install) {
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
  if (!install)
    say(ws ? "  npm install               # installs server/ and client/" : "  npm install");
  say(
    `  cp ${ws ? "server/.env.example server/.env" : ".env.example .env"}` +
      (usesPrisma(database) ? "   # set DATABASE_URL" : ""),
  );
  if (usesPrisma(database)) {
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
