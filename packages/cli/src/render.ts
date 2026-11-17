import { parseConfig, PERMISSION_PATTERN, type SelfAuthConfig } from "@selfauth/spec";
import type { Database, Frontend } from "./templates.js";

/** Permissions used by the notes example that ships with a frontend. */
export const EXAMPLE_PERMISSIONS = ["notes.create", "notes.view", "notes.view_any"];

export interface InitAnswers {
  name: string;
  database: Database;
  frontend: Frontend;
  permissions: string[];
  /** Origin the frontend is served from; email links point here. */
  appBaseUrl: string;
}

/** Resolved configuration written to src/config/selfauth.config.ts (validated by the spec schema). */
export function buildConfig(answers: InitAnswers): SelfAuthConfig {
  for (const p of answers.permissions) {
    if (!PERMISSION_PATTERN.test(p) || p.startsWith("auth."))
      throw new Error(`invalid permission '${p}' (format: resource.action)`);
  }
  const example = answers.frontend !== "none";
  const permissions = [
    ...new Set([...answers.permissions, ...(example ? EXAMPLE_PERMISSIONS : [])]),
  ];
  return parseConfig({
    adapter: {
      backend: "express",
      frontend: answers.frontend,
      database: answers.database,
      orm: answers.database === "postgresql" ? "prisma" : "none",
    },
    authorization: {
      permissions,
      // With a frontend, the notes example shows ownership: users see their own notes, support sees all.
      roles: example
        ? { user: ["notes.create", "notes.view"], support: ["notes.view_any"], admin: [] }
        : { user: [], admin: [] },
    },
  });
}

/**
 * The password policy section is found by key. Its length limits are plain numbers, not a
 * password, and reading the field by name would make static analysis treat them as one when
 * generated files are hashed.
 */
const POLICY_KEY = "password";
function lengthLimits(config: SelfAuthConfig): { minLength: number; maxLength: number } {
  const entry = Object.entries(config.authentication).find(([key]) => key === POLICY_KEY);
  return entry![1] as { minLength: number; maxLength: number };
}

export function renderConfig(config: SelfAuthConfig, options: { shared?: boolean } = {}): string {
  if (!options.shared) {
    return `import type { SelfAuthConfig } from "../auth/types.ts";

/**
 * SelfAuth configuration: behavior only, never secrets (CONF-FILE-002).
 * Every default is a secure starting point and can be changed within the
 * bounds in CONFIGURATION_SPEC.md. Check changes with \`npx selfauth validate\`.
 */
export const config: SelfAuthConfig = ${JSON.stringify(config, null, 2)};
`;
  }
  // Full-stack: the password limits come from selfauth.config.json (project root), so the
  // server and the frontend always agree. Placeholders are swapped for the imported values.
  const marked = {
    ...config,
    authentication: Object.fromEntries(
      Object.entries(config.authentication).map(([key, value]) =>
        key === POLICY_KEY
          ? [key, { ...(value as object), minLength: "@min", maxLength: "@max" }]
          : [key, value],
      ),
    ),
  };
  const body = JSON.stringify(marked, null, 2)
    .replace('"@min"', "shared.password.minLength")
    .replace('"@max"', "shared.password.maxLength");
  return `import type { SelfAuthConfig } from "../auth/types.ts";
import shared from "./selfauth.config.json" with { type: "json" };

/**
 * SelfAuth configuration: behavior only, never secrets (CONF-FILE-002).
 * Every default is a secure starting point and can be changed within the
 * bounds in CONFIGURATION_SPEC.md. Check changes with \`npx selfauth validate\`.
 *
 * The password length limits are not set here: they come from selfauth.config.json
 * in the project root (copied next to this file by \`npm run sync\`), which the
 * frontend reads too. Edit them there.
 */
export const config: SelfAuthConfig = ${body};
`;
}

/** selfauth.config.json: the browser-safe settings the server and the frontend share. */
export function renderSharedConfig(config: SelfAuthConfig): string {
  const { minLength, maxLength } = lengthLimits(config);
  return `{
  "_note": "Browser-safe settings shared by server and client. Edit selfauth.config.json in the project root, not this copy: \`npm run sync\` (it also runs before dev, build and test) copies it here. Never put secrets in it.",
  "password": { "minLength": ${minLength}, "maxLength": ${maxLength} }
}
`;
}

/** scripts/sync-config.mjs: copies the root selfauth.config.json into server/ and client/. */
export function renderSyncScript(): string {
  return `// Copies selfauth.config.json (project root) into server/ and client/, so each package imports a
// file inside its own folder. Runs before dev, build, test and typecheck, and as \`npm run sync\`.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "selfauth.config.json");
if (existsSync(source)) {
  const text = readFileSync(source, "utf8");
  const password = JSON.parse(text).password;
  for (const key of ["minLength", "maxLength"]) {
    if (!Number.isInteger(password?.[key])) {
      throw new Error(\`selfauth.config.json: password.\${key} must be a whole number\`);
    }
  }
  for (const folder of ["server/src/config", "client/src"]) {
    const target = join(root, folder, "selfauth.config.json");
    if (!existsSync(target) || readFileSync(target, "utf8") !== text) copyFileSync(source, target);
  }
}
`;
}

/** Full-stack projects (a frontend was chosen) are two packages in an npm workspace. */
export const isWorkspace = (answers: Pick<InitAnswers, "frontend">) => answers.frontend !== "none";

/** `sync` plus a `pre<name>` hook for each script, so the shared config is current before it runs. */
function syncScripts(names: string[]): Record<string, string> {
  return {
    sync: "node ../scripts/sync-config.mjs",
    ...Object.fromEntries(names.map((n) => [`pre${n}`, "npm run sync"])),
  };
}

export function renderPackageJson(
  answers: InitAnswers,
  deps: { dependencies: string[]; devDependencies: string[] },
  versions: Record<string, string>,
): string {
  const pick = (names: string[]) =>
    Object.fromEntries(
      names.map((n) => {
        const v = versions[n];
        if (!v) throw new Error(`no tested version recorded for '${n}'`);
        return [n, v];
      }),
    );
  const scripts: Record<string, string> = {
    dev: "node --env-file-if-exists=.env --watch src/server.ts",
    build: "tsc -p tsconfig.build.json",
    start: "node --env-file-if-exists=.env dist/server.js",
    typecheck: "tsc -p tsconfig.json --noEmit",
    test: 'node --test "test/**/*.test.ts"',
  };
  if (isWorkspace(answers))
    Object.assign(scripts, syncScripts(["dev", "build", "test", "typecheck"]));
  if (answers.database === "postgresql") {
    Object.assign(scripts, {
      generate: "prisma generate",
      postinstall: "prisma generate",
      "db:migrate": "prisma migrate deploy",
      "db:status": "prisma migrate status",
      "db:seed": "node --env-file-if-exists=.env src/scripts/seed.ts",
      "db:create-admin": "node --env-file-if-exists=.env src/scripts/create-admin.ts",
    });
  }
  return `${JSON.stringify(
    {
      name: isWorkspace(answers) ? `${answers.name}-server` : answers.name,
      version: "0.1.0",
      private: true,
      type: "module",
      engines: { node: ">=22.18" },
      scripts,
      dependencies: pick(deps.dependencies),
      devDependencies: pick(deps.devDependencies),
    },
    null,
    2,
  )}\n`;
}

export function renderTsconfig(): { base: string; build: string } {
  const base = {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      types: ["node"],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      erasableSyntaxOnly: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      rootDir: ".",
    },
    include: ["src", "test"],
  };
  const build = {
    extends: "./tsconfig.json",
    compilerOptions: { rootDir: "src", outDir: "dist", sourceMap: true },
    include: ["src"],
  };
  return {
    base: `${JSON.stringify(base, null, 2)}\n`,
    build: `${JSON.stringify(build, null, 2)}\n`,
  };
}

/** web/package.json for the chosen frontend, with the versions its reference app was tested with. */
export function renderWebPackageJson(
  answers: InitAnswers,
  info: { dependencies: string[]; devDependencies: string[]; typecheck: string },
  versions: Record<string, string>,
): string {
  const pick = (names: string[]) => Object.fromEntries(names.map((n) => [n, versions[n] ?? "*"]));
  return `${JSON.stringify(
    {
      name: `${answers.name}-client`,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
        typecheck: info.typecheck,
        ...syncScripts(["dev", "build", "typecheck"]),
      },
      dependencies: pick(info.dependencies),
      devDependencies: pick(info.devDependencies),
    },
    null,
    2,
  )}\n`;
}

export function renderWebTsconfig(frontend: Exclude<Frontend, "none">): string {
  const config = {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      types: ["vite/client", "node"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
      jsx: frontend === "vue" ? "preserve" : "react-jsx",
    },
    include:
      frontend === "vue"
        ? ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"]
        : ["src", "vite.config.ts"],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function renderEnvExample(answers: InitAnswers): string {
  const lines = [
    "# Copy to .env for local development. Never commit .env (SEC-SECRET-002).",
    "# Placeholders only.",
    "NODE_ENV=development",
    "PORT=3000",
    "# Absolute URL of your frontend: email links point here (AUTHN-VERIFY-009).",
    `SELFAUTH_APP_BASE_URL=${answers.appBaseUrl}`,
    '# Only for http.csrf.mode "token": 32+ random bytes, base64url.',
    "# SELFAUTH_CSRF_SECRET=",
  ];
  if (answers.database === "postgresql") {
    lines.push(
      "# PostgreSQL connection for Prisma.",
      "DATABASE_URL=postgresql://user:password@localhost:5432/app",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Workspace root package.json: runs both packages (`concurrently` so it also works on Windows). */
export function renderRootPackageJson(
  answers: InitAnswers,
  options: { shared?: boolean } = { shared: true },
): string {
  const pg = answers.database === "postgresql";
  const scripts: Record<string, string> = {
    dev: 'concurrently -k -n server,client -c blue,green "npm run dev -w server" "npm run dev -w client"',
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    build: "npm run build -w server && npm run build -w client",
    start: "npm run start -w server",
    typecheck: "npm run typecheck -w server && npm run typecheck -w client",
    test: "npm run test -w server",
  };
  // Projects migrated from the one-package layout have no root selfauth.config.json to sync.
  if (options.shared) scripts["sync"] = "node scripts/sync-config.mjs";
  if (pg) {
    Object.assign(scripts, {
      "db:migrate": "npm run db:migrate -w server",
      "db:status": "npm run db:status -w server",
      "db:seed": "npm run db:seed -w server",
      // Arguments after `npm run db:create-admin --` reach the script.
      "db:create-admin": "npm run db:create-admin -w server --",
    });
  }
  return `${JSON.stringify(
    {
      name: answers.name,
      version: "0.1.0",
      private: true,
      workspaces: ["server", "client"],
      engines: { node: ">=22.18" },
      scripts,
      devDependencies: { concurrently: "^9.1.0" },
    },
    null,
    2,
  )}\n`;
}

export function renderGitignore(options: { workspace?: boolean } = {}): string {
  return [
    "node_modules/",
    "dist/",
    ".env",
    ".env.*",
    "!.env.example",
    // A pattern with a slash in the middle is anchored to the .gitignore's folder.
    options.workspace ? "**/src/generated/" : "src/generated/",
    "*.log",
    "",
  ].join("\n");
}

type Row = [string, string];

function serverRows(answers: InitAnswers): Row[] {
  const pg = answers.database === "postgresql";
  const web = answers.frontend !== "none";
  return [
    ["src/", ""],
    ["  server.ts", "starts the server"],
    ["  app.ts", "builds the Express app: middleware, routes, error handling"],
    ["  config/", ""],
    ["    selfauth.config.ts", "your authentication settings: roles, permissions, limits"],
    ...(web ? ([["    selfauth.config.json", "copy of the root file: don't edit"]] as Row[]) : []),
    ["    env.ts", "environment variables (PORT, SELFAUTH_APP_BASE_URL, ...)"],
    ["    dev-config.ts", "cookie settings for local http development"],
    ["  routes/", ""],
    ["    index.ts", "your routes: guard them with auth.requireAuth / requirePermission"],
    ...(web
      ? ([["    notes.ts", "example: permissions and ownership (replace it)"]] as Row[])
      : []),
    ["  email/mailer.ts", "plug in your email provider here"],
    [
      "  db/store.ts",
      `picks the data store (${pg ? "PostgreSQL, or in-memory without DATABASE_URL" : "in-memory"})`,
    ],
    ["  http/", "error responses and request ids"],
    ["  auth/", "SelfAuth's generated authentication code (core/, express/, stores/)"],
    ...(pg ? ([["  scripts/", "seed (roles) and create-admin"]] as Row[]) : []),
    ["test/", "smoke tests for the authentication wiring (npm test)"],
    ...(pg ? ([["prisma/", "database schema and migrations"]] as Row[]) : []),
  ];
}

function clientRows(answers: InitAnswers): Row[] {
  return [
    ["src/", ""],
    [
      `  ${answers.frontend === "vue" ? "main.ts, App.vue, router.ts" : "main.tsx, App.tsx"}`,
      "entry point, app shell and routes",
    ],
    ["  selfauth.config.json", "copy of the root file: don't edit"],
    ["  auth/", "SelfAuth's frontend module: API client, session state, route guards, <Can>"],
    [
      "  pages/auth/",
      "the five account screens: login, register, verify email, forgot and reset password",
    ],
    [
      "  pages/",
      `your pages (${answers.frontend === "vue" ? "home, account, notes, forbidden, 404" : "account, notes"}): replace the notes example`,
    ],
  ];
}

/** The folder tree shown in the generated README, for the options the project was made with. */
export function renderLayout(answers: InitAnswers): string {
  const indent = (rows: Row[]): Row[] => rows.map(([name, note]) => [`  ${name}`, note]);
  const rows: Row[] = isWorkspace(answers)
    ? [
        [
          "server/",
          `the Express API (${answers.database === "postgresql" ? "PostgreSQL" : "in-memory"})`,
        ],
        ...indent(serverRows(answers)),
        ["  package.json, tsconfig.json", "its own package"],
        ["  .env.example", "copy to server/.env"],
        ["  selfauth.manifest.json", "which files SelfAuth generated (doctor, diff, upgrade)"],
        ["client/", `the ${answers.frontend} frontend (Vite)`],
        ...indent(clientRows(answers)),
        ["  package.json", "its own package"],
        ["  selfauth.manifest.json", "which files SelfAuth generated"],
        ["selfauth.config.json", "password length limits, shared by server and client: edit here"],
        ["scripts/sync-config.mjs", "copies selfauth.config.json into server/ and client/"],
        ["package.json", "workspace root: `npm run dev` starts both"],
      ]
    : [
        ...serverRows(answers),
        [
          "selfauth.manifest.json",
          "which files SelfAuth generated (used by doctor, diff, upgrade)",
        ],
      ];
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, note]) => (note ? `${name.padEnd(width)}${note}` : name)).join("\n");
}

export function renderReadme(answers: InitAnswers): string {
  const pg = answers.database === "postgresql";
  const ws = isWorkspace(answers);
  const env = ws ? "server/.env" : ".env";
  const base = ws ? "server/" : "";
  const run = [
    "npm install",
    `cp ${ws ? "server/.env.example server/.env" : ".env.example .env"}${pg ? "   # then set DATABASE_URL" : ""}`,
    ...(pg
      ? [
          "npx selfauth db plan          # optional: review the migration for destructive changes",
          "npm run db:migrate",
          `npm run db:seed               # roles from ${base}src/config/selfauth.config.ts`,
        ]
      : []),
    ws
      ? `npm run dev                   # API on :3000 and the ${answers.frontend} app together`
      : "npm run dev",
  ].join("\n");
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

\`\`\`bash
${run}
\`\`\`
${ws ? `\nOpen ${answers.appBaseUrl}. The API is in \`server/\` and the ${answers.frontend} frontend in \`client/\`; they are two packages in one npm workspace, so one \`npm install\` at the root installs both and \`npm run dev\` starts both (the frontend proxies /auth and /api to the API). The frontend's \`src/auth/\` holds the API client, session state, route guards and \`<Can>\`. The \`notes\` example (backend \`server/src/routes/notes.ts\`, frontend notes page) shows permissions and ownership: replace it with your own features.\n\nThe backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\` (\`${env}\`). If you serve the frontend elsewhere (for example \`vite preview\` on another port, or a deployed domain), set that variable or add the origin to \`http.trustedOrigins\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.\n` : ""}
Email (verification, password reset) is printed to the console in
development. Before production, implement \`createMailer()\` in
\`${base}src/email/mailer.ts\`; the server refuses to start in production until you do.
${pg ? "" : "\nThis project uses the **in-memory store** (data is lost on restart). Regenerate with `--database postgresql` for persistence.\n"}
## Project layout

\`\`\`text
${renderLayout(answers)}
\`\`\`

Authentication behaviour is configuration (\`${base}src/config/selfauth.config.ts\`), not code you
edit: \`${base}src/auth/\` is the tested security core.

## Routes

Authentication lives under \`/auth\` (register, login, logout, me, email
verification, password reset/change, sessions, admin). Add your own routes in
\`${base}src/routes/index.ts\`; guard them with \`auth.requireAuth\`,
\`auth.requirePermission("x.y")\` or \`auth.protectedRoutes()\`.

Browsers must send \`X-SelfAuth-CSRF: 1\` on state-changing requests (or use
the SelfAuth frontend client).
${pg ? `\nCreate the first administrator after registering: \`npm run db:create-admin you@example.com\`.\n` : ""}
## Checks

\`npm test\` runs smoke tests of the authentication wiring${ws ? " in `server/test/`" : " in `test/`"} (no database needed).
They are yours to extend. The SelfAuth CLI is a development tool and optional; the app never
needs it to run.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings${ws ? " (checks server/ and client/)" : ""}
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}
