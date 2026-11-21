import { runCommand } from "../run.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
  BACKEND_DATABASES,
  DATABASE_INFO,
  goModuleProblem,
  DATABASES,
  hasDatabase,
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
  /** Gin: the Go module path (default: the project name). */
  module?: string;
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

/** The database library the generated project uses, for the plan line. */
function databaseDriver(backend: Backend, database: Database): string {
  if (backend === "gin")
    return database === "postgresql"
      ? "pgx"
      : database === "mongodb"
        ? "mongo-driver"
        : "database/sql";
  if (backend === "flask")
    return database === "postgresql"
      ? "psycopg"
      : database === "mysql"
        ? "PyMySQL"
        : database === "sqlite"
          ? "sqlite3"
          : "PyMongo";
  return database === "mongodb" ? "Mongoose" : "Prisma";
}

/** What to do after a Flask project is created. */
function flaskNextSteps(answers: InitAnswers, install: boolean): number {
  const database = hasDatabase(answers.database);
  const workspace = answers.frontend !== "none";
  const server = workspace ? "server/" : "";
  if (workspace) {
    if (!install) say("  npm install               # installs the client (and the root scripts)");
    say("  python3 -m venv server/.venv");
    say(
      `  server/.venv/bin/pip install -r server/requirements.txt   # Windows: server\\.venv\\Scripts\\pip`,
    );
    say(`  cp server/.env.example server/.env${database ? "   # set DATABASE_URL" : ""}`);
    if (database) say("  npm run db:migrate && npm run db:seed   # read the migration first");
    say(
      `  npm run dev               # Flask API and ${answers.frontend} app together; open ${answers.appBaseUrl}`,
    );
  } else {
    say(
      "  python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate",
    );
    say("  pip install -r requirements.txt");
    say(`  cp .env.example .env${database ? "   # set DATABASE_URL" : ""}`);
    if (database) {
      say(
        "  python -m app.cmd.migrate status && python -m app.cmd.migrate up   # read the migration first",
      );
      say("  python -m app.cmd.seed");
    }
    say("  python -m app.cmd.server");
  }
  say(
    `\nBefore production: implement create_mailer in ${server}app/mailer.py, then run \`npx selfauth doctor\`.`,
  );
  return 0;
}

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
  if (options.backend === "gin" || options.backend === "flask") {
    if (
      options.database !== undefined &&
      !BACKEND_DATABASES[options.backend].includes(options.database as Database)
    ) {
      fail(
        `The ${options.backend === "gin" ? "Gin" : "Flask"} backend supports ${BACKEND_DATABASES[options.backend].join(" and ")} (got '${options.database}').`,
      );
      return 1;
    }
  }
  if (options.module !== undefined && options.backend !== "gin") {
    fail("--module is for the Gin backend (the Go module path).");
    return 1;
  }
  if (options.module !== undefined && goModuleProblem(options.module)) {
    fail(`--module: ${goModuleProblem(options.module)}`);
    return 1;
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
  for (const file of ["go.mod", "pyproject.toml", "requirements.txt"]) {
    if (existsSync(join(dir, file))) {
      fail(`This directory already has a ${file}. \`selfauth init\` creates new projects only.`);
      return 1;
    }
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
            {
              value: "gin",
              label: "Gin (Go)",
              hint: "a Go port of the core; any database",
            },
            {
              value: "flask",
              label: "Flask (Python)",
              hint: "a Python port of the core; any database",
            },
          ],
          "express",
        )
      : "express")) as Backend;
  const gin = backend === "gin";
  const flask = backend === "flask";
  const database = (options.database ??
    (prompter
      ? await prompter.select<Database>(
          "Which database?",
          (
            [
              {
                value: "postgresql",
                label: "PostgreSQL",
                hint: gin
                  ? "via pgx; for real use"
                  : flask
                    ? "via psycopg; for real use"
                    : "via Prisma; for real use",
              },
              {
                value: "mysql",
                label: "MySQL",
                hint: `via ${flask ? "PyMySQL" : "Prisma"}; MySQL 8 or MariaDB`,
              },
              {
                value: "mongodb",
                label: "MongoDB",
                hint: `via ${flask ? "PyMongo" : "Mongoose"}; MongoDB 6 or newer`,
              },
              {
                value: "sqlite",
                label: "SQLite",
                hint: `via ${flask ? "sqlite3" : "Prisma"}; one file, no server to run`,
              },
              {
                value: "memory",
                label: "In-memory",
                hint: "to try SelfAuth out; not for production",
              },
            ] as const
          ).filter((choice) => BACKEND_DATABASES[backend].includes(choice.value)),
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
  const projectName =
    basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app";
  const module = gin
    ? (options.module ??
      (prompter
        ? await prompter.text("Go module path (go.mod and imports)", {
            default: projectName,
            validate: goModuleProblem,
          })
        : projectName))
    : undefined;
  // A Go or Python project without a frontend has nothing for npm to install.
  const install =
    (gin || flask) && frontend === "none"
      ? false
      : (options.install ??
        (prompter
          ? await prompter.confirm("Run npm install after creating the files?", true)
          : false));

  const answers: InitAnswers = {
    name: projectName,
    backend,
    ...(module === undefined ? {} : { module }),
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
    `\nPlan: create ${files.length} files (${backend === "fastify" ? "Fastify" : gin ? "Gin (Go)" : flask ? "Flask (Python)" : "Express"} + ${hasDatabase(database) ? `${DATABASE_INFO[database].label}/${databaseDriver(backend, database)}` : "in-memory store"}${frontend === "none" ? "" : ` + ${frontend} in client/`})`,
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
    const result = runCommand(["npm", "install"], dir);
    if (!result.ok) {
      fail(`npm install failed (${result.reason}); run it yourself after fixing the problem.`);
      return 1;
    }
  }

  const cd = relative(process.cwd(), dir) || ".";
  say("\nNext steps:");
  if (cd !== ".") say(`  cd ${cd}`);
  if (flask) return flaskNextSteps(answers, install);
  if (gin && frontend !== "none") {
    if (!install) say("  npm install               # installs the client (and the root scripts)");
    say(
      "  cp server/.env.example server/.env" +
        (hasDatabase(database) ? "   # set DATABASE_URL" : ""),
    );
    if (hasDatabase(database)) {
      say("  npm run db:migrate && npm run db:seed   # read the migration first");
    }
    say(
      `  npm run dev               # Go API and ${frontend} app together; open ${answers.appBaseUrl}`,
    );
    say(
      "\nBefore production: implement NewMailer in server/internal/email/mailer.go, then run `npx selfauth doctor`.",
    );
    return 0;
  }
  if (gin) {
    say(
      `  export SELFAUTH_APP_BASE_URL=${answers.appBaseUrl}   # the server reads the environment, not .env`,
    );
    if (hasDatabase(database)) {
      say("  export DATABASE_URL=...   # see .env.example");
      say("  go run ./cmd/migrate status && go run ./cmd/migrate up   # read the migration first");
      say("  go run ./cmd/seed");
    }
    say("  go run ./cmd/server");
    say(
      "\nBefore production: implement NewMailer in internal/email/mailer.go, then run `npx selfauth doctor`.",
    );
    return 0;
  }
  const ws = frontend !== "none";
  if (!install)
    say(ws ? "  npm install               # installs server/ and client/" : "  npm install");
  say(
    `  cp ${ws ? "server/.env.example server/.env" : ".env.example .env"}` +
      (hasDatabase(database) ? "   # set DATABASE_URL" : ""),
  );
  if (hasDatabase(database)) {
    say(
      database === "mongodb"
        ? "  npx selfauth db plan      # show the indexes db:migrate would create"
        : "  npx selfauth db plan      # review the migration first",
    );
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
