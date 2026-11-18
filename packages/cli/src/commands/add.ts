import { spawnSync } from "node:child_process";
import { basename, posix, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectSourceLayout } from "../layout.js";
import { applyPlan, ConflictError, planAdd, selfauthRoot } from "../plan.js";
import { preflightAdd } from "../preflight.js";
import {
  BACKENDS,
  DATABASES,
  stackDependencies,
  templateSource,
  type Backend,
  type Database,
  usesPrisma,
} from "../templates.js";
import { detectProject } from "../detect.js";
import { appBaseUrlProblem } from "../render.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface AddOptions {
  /** `express` or `fastify`; default: the framework found in package.json. */
  backend?: string;
  database?: string;
  /** Source folder to write under (`<src>/selfauth/`). Default: found from the backend entry file. */
  src?: string;
  permissions?: string;
  appBaseUrl?: string;
  allowExistingAuth?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  install?: boolean;
}

function installCommand(pm: string | null, packages: string[], dev: boolean): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "add", ...(dev ? ["-D"] : []), ...packages];
    case "yarn":
      return ["yarn", "add", ...(dev ? ["-D"] : []), ...packages];
    case "bun":
      return ["bun", "add", ...(dev ? ["-d"] : []), ...packages];
    default:
      return ["npm", "install", ...(dev ? ["-D"] : []), ...packages];
  }
}

/** `selfauth add [dir]`: add SelfAuth to an existing Express or Fastify project without editing its files. */
export async function add(dirArg: string | undefined, options: AddOptions): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  const database = (options.database ?? "memory") as Database;
  say(`SelfAuth add → ${dir}`);
  if (!DATABASES.includes(database)) {
    fail(`Unsupported database '${database}'.`);
    return 1;
  }

  const urlProblem =
    options.appBaseUrl === undefined ? null : appBaseUrlProblem(options.appBaseUrl);
  if (urlProblem) {
    fail(`--app-base-url: ${urlProblem}`);
    return 1;
  }
  const detected = await detectProject(dir);
  const requested = options.backend ?? detected.framework ?? undefined;
  if (requested !== undefined && !BACKENDS.includes(requested as Backend)) {
    fail(`Unsupported backend '${requested}'. Supported: ${BACKENDS.join(", ")}.`);
    return 1;
  }
  const backend = (requested ?? "express") as Backend;
  const layout = await detectSourceLayout(dir, backend);
  const srcDir = options.src ?? layout.sourceDir;
  say(`Source folder: ${srcDir} (${options.src ? "from --src" : layout.basis})`);
  const check = await preflightAdd(dir, {
    database,
    backend,
    srcDir,
    ...(options.allowExistingAuth ? { allowExistingAuth: true } : {}),
  });
  check.warnings.forEach(warn);
  if (check.errors.length) {
    check.errors.forEach(fail);
    say("\nNothing was written.");
    return 1;
  }

  const answers = {
    name: basename(dir),
    backend,
    database,
    frontend: "none" as const,
    permissions: (options.permissions ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    appBaseUrl: options.appBaseUrl ?? "http://localhost:5173",
  };
  let files;
  try {
    files = await planAdd(answers, undefined, { srcDir: check.srcDir });
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }

  say(`\nPlan: create ${files.length} new files; your existing files are not modified.`);
  for (const f of files) say(`  + ${f.path}`);
  if (options.dryRun) {
    say("\nDry run: nothing written.");
    return 0;
  }
  if (process.stdin.isTTY && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nCreate these files? (y/N) ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      say("Cancelled. Nothing written.");
      return 1;
    }
  } else if (!options.yes) {
    fail("Refusing to write without confirmation; pass --yes.");
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
  const root = selfauthRoot(check.srcDir);
  ok(`Created ${files.length} files under ${root}/${usesPrisma(database) ? " and prisma/" : ""}.`);

  const deps = stackDependencies(database, backend);
  const versions = await templateSource().versions();
  const spec = (names: string[]) => names.map((n) => `${n}@${versions[n]}`);
  const commands = [
    installCommand(check.project.packageManager, spec(deps.dependencies), false),
    installCommand(check.project.packageManager, spec(deps.devDependencies), true),
  ];
  if (options.install) {
    for (const cmd of commands) {
      say(`\n$ ${cmd.join(" ")}`);
      if (spawnSync(cmd[0]!, cmd.slice(1), { cwd: dir, stdio: "inherit" }).status !== 0) {
        fail("Installing dependencies failed; run the command yourself.");
        return 1;
      }
    }
  }

  say("\nFinish the integration (SelfAuth does not edit your files):\n");
  let step = 1;
  if (!options.install) {
    say(`${step++}. Install the dependencies:`);
    for (const cmd of commands) say(`     ${cmd.join(" ")}`);
  }
  if (Object.keys(check.tsconfigChanges).length) {
    say(`${step++}. Add to compilerOptions in tsconfig.json:`);
    for (const [k, v] of Object.entries(check.tsconfigChanges))
      say(`     "${k}": ${JSON.stringify(v)},`);
  }
  const fromDir = layout.entryFile ? posix.dirname(layout.entryFile) : check.srcDir;
  let importPath = posix.relative(fromDir, `${root}/setup.ts`);
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  if (backend === "fastify") {
    say(
      `${step++}. Wire SelfAuth into your Fastify app (before your routes; create the app with the server options):`,
    );
    say(`     import { selfAuthServerOptions, setupSelfAuth } from "${importPath}";`);
    say(`     const app = Fastify({ ...selfAuthServerOptions() });`);
    say(`     const selfauth = await setupSelfAuth(app);`);
    say(
      `     // your routes, e.g. app.get("/api/me", { preHandler: selfauth.auth.requireAuth }, handler)`,
    );
    say(
      `     app.setErrorHandler(selfauth.errorHandler);   // or call selfauth.auth.handleError(error, req, reply) in yours`,
    );
  } else {
    say(
      `${step++}. Wire SelfAuth into your Express app (before your routes, error handler after them):`,
    );
    say(`     import { setupSelfAuth } from "${importPath}";`);
    say(`     const selfauth = await setupSelfAuth(app);`);
    say(`     // your routes, e.g. app.get("/api/me", selfauth.auth.requireAuth, handler)`);
    say(`     app.use(selfauth.errorHandler);`);
  }
  say(
    `${step++}. Set SELFAUTH_APP_BASE_URL (your frontend's URL) in your environment; see ${root}/config/env.ts.`,
  );
  if (usesPrisma(database)) {
    say(`${step++}. Ignore the generated client: add "${root}/generated/" to .gitignore, then:`);
    say("     npx prisma generate && npx selfauth db plan && npx selfauth db migrate");
    say(`     node --env-file=.env ${root}/scripts/seed.ts`);
  } else if (database === "mongodb") {
    say(
      `${step++}. Create the indexes (the unique email index keeps accounts unique), then seed the roles:`,
    );
    say("     npx selfauth db plan && npx selfauth db migrate");
    say(`     node --env-file=.env ${root}/scripts/seed.ts`);
  }
  say(
    `${step}. Browsers must send "X-SelfAuth-CSRF: 1" on POST/PUT/PATCH/DELETE requests (CSRF protection covers the whole app).`,
  );
  say("\nThen run `npx selfauth doctor`.");
  return 0;
}
