import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { detectProject } from "../detect.js";
import { applyPlan, ConflictError, planAddFrontend, selfauthRoot } from "../plan.js";
import { preflightAddFrontend } from "../preflight.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface AddFrontendOptions {
  frontend?: string;
  src?: string;
  yes?: boolean;
  dryRun?: boolean;
  install?: boolean;
}

/** `selfauth add-frontend [dir]`: add the authentication module to an existing Vue or React app. */
export async function addFrontend(
  dirArg: string | undefined,
  options: AddFrontendOptions,
): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  say(`SelfAuth add-frontend → ${dir}`);
  const check = await preflightAddFrontend(dir, {
    frontend: options.frontend,
    srcDir: options.src,
  });
  check.warnings.forEach(warn);
  if (check.errors.length || !check.frontend) {
    check.errors.forEach(fail);
    say("\nNothing was written.");
    return 1;
  }

  const frontend = check.frontend;
  const root = selfauthRoot(check.srcDir);
  const files = await planAddFrontend({ frontend, srcDir: check.srcDir });
  say(
    `\nPlan: create ${files.length} new files under ${root}/; your existing files are not modified.`,
  );
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
  ok(`Created ${files.length} files under ${root}/.`);

  const pm = (await detectProject(dir)).packageManager;
  const install =
    check.missingPackages.length > 0
      ? pm === "pnpm"
        ? ["pnpm", "add", ...check.missingPackages]
        : pm === "yarn"
          ? ["yarn", "add", ...check.missingPackages]
          : pm === "bun"
            ? ["bun", "add", ...check.missingPackages]
            : ["npm", "install", ...check.missingPackages]
      : null;
  if (install && options.install) {
    say(`\n$ ${install.join(" ")}`);
    if (spawnSync(install[0]!, install.slice(1), { cwd: dir, stdio: "inherit" }).status !== 0) {
      fail("Installing dependencies failed; run the command yourself.");
      return 1;
    }
  }

  say("\nFinish the integration (SelfAuth does not edit your files):\n");
  let step = 1;
  if (install && !options.install)
    say(`${step++}. Install the missing packages:\n     ${install.join(" ")}`);
  if (Object.keys(check.tsconfigChanges).length) {
    say(`${step++}. For type checking, add to compilerOptions in tsconfig.json:`);
    for (const [k, v] of Object.entries(check.tsconfigChanges))
      say(`     "${k}": ${JSON.stringify(v)},`);
  }
  if (frontend === "vue") {
    say(
      `${step++}. In your entry file (main.ts, next to the selfauth/ folder), create the client and store, guard the router, install the plugin:`,
    );
    say(
      `     import { createAuthClient, createAuthPlugin, createAuthStore, installAuthGuard } from "./selfauth/index.ts";`,
    );
    say(
      `     const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });`,
    );
    say(`     const store = createAuthStore(client);`);
    say(
      `     installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/" });`,
    );
    say(`     createApp(App).use(createAuthPlugin(store)).use(router).mount("#app");`);
    say(
      `   Mark protected routes with meta: { requiresAuth: true } (and permission: "x.y" where needed).`,
    );
  } else {
    say(
      `${step++}. In your entry file (main.tsx, next to the selfauth/ folder), create the client and store and wrap the app:`,
    );
    say(
      `     import { AuthProvider, createAuthClient, createAuthStore } from "./selfauth/index.ts";`,
    );
    say(
      `     const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });`,
    );
    say(`     const store = createAuthStore(client);`);
    say(`     <AuthProvider store={store}><BrowserRouter><App /></BrowserRouter></AuthProvider>`);
    say(`   Wrap protected routes in <RequireAuth> (and <GuestOnly> for the login page).`);
  }
  say(
    `${step++}. Decide how the browser reaches the API. Same origin (a dev-server proxy for /auth and /api, one domain in production) is the default and the most secure. If the API is on another origin, pass baseUrl to createAuthClient and set the API's http.trustedOrigins; see docs/frontend-deployment.md.`,
  );
  say(
    `${step++}. Build your own login, sign-up, verify-email and reset-password pages with the client (client.login(...), client.register(...), verifyEmail(token) from the URL fragment). SelfAuth does not generate pages for an existing app.`,
  );
  say(
    `${step}. Browsers send "X-SelfAuth-CSRF: 1" automatically through the client; use client.api(...) for your own calls.`,
  );
  say("\nThen run `npx selfauth validate` in this folder.");
  return 0;
}
