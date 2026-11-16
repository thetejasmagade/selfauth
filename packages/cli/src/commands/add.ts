import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { applyPlan, ConflictError, planAdd } from "../plan.js";
import { preflightAdd } from "../preflight.js";
import { stackDependencies, templateSource, type Database } from "../templates.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface AddOptions {
  database?: string;
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

/** `selfauth add [dir]`: add SelfAuth to an existing Express project without editing its files. */
export async function add(dirArg: string | undefined, options: AddOptions): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  const database = (options.database ?? "memory") as Database;
  say(`SelfAuth add → ${dir}`);
  if (!["memory", "postgresql"].includes(database)) {
    fail(`Unsupported database '${database}'.`);
    return 1;
  }

  const check = await preflightAdd(dir, {
    database,
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
    files = await planAdd(answers);
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
  ok(
    `Created ${files.length} files under src/selfauth/${database === "postgresql" ? " and prisma/" : ""}.`,
  );

  const deps = stackDependencies(database);
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
  say(
    `${step++}. Wire SelfAuth into your Express app (before your routes, error handler after them):`,
  );
  say(`     import { setupSelfAuth } from "./selfauth/setup.ts";`);
  say(`     const selfauth = await setupSelfAuth(app);`);
  say(`     // your routes, e.g. app.get("/api/me", selfauth.auth.requireAuth, handler)`);
  say(`     app.use(selfauth.errorHandler);`);
  say(
    `${step++}. Set SELFAUTH_APP_BASE_URL (your frontend's URL) in your environment; see src/selfauth/env.ts.`,
  );
  if (database === "postgresql") {
    say(
      `${step++}. Ignore the generated client: add "src/selfauth/generated/" to .gitignore, then:`,
    );
    say("     npx prisma generate && npx selfauth db plan && npx selfauth db migrate");
    say("     node --env-file=.env src/selfauth/scripts/seed.ts");
  }
  say(
    `${step}. Browsers must send "X-SelfAuth-CSRF: 1" on POST/PUT/PATCH/DELETE requests (CSRF protection covers the whole app).`,
  );
  say("\nThen run `npx selfauth doctor`.");
  return 0;
}
