import { parseConfig, PERMISSION_PATTERN, type SelfAuthConfig } from "@selfauth/spec";
import {
  DATABASE_INFO,
  hasDatabase,
  ormFor,
  usesPrisma,
  type Backend,
  type Database,
  type Frontend,
} from "./templates.js";

export interface InitAnswers {
  name: string;
  database: Database;
  frontend: Frontend;
  /** The HTTP framework; Express when not given. */
  backend?: Backend;
  /** Gin only: the Go module path (go.mod and imports). Defaults to the project name. */
  module?: string;
  permissions: string[];
  /** Origin the frontend is served from; email links point here. */
  appBaseUrl: string;
}

/** Resolved configuration written to src/config/selfauth.config.ts (validated by the spec schema). */
/**
 * A message when `value` is not a usable frontend address, otherwise null. It is written into
 * `.env`, so spaces and control characters (a newline would add a line) are refused outright.
 */
export function appBaseUrlProblem(value: string): string | null {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\s]/.test(value))
    return "The address must not contain spaces or control characters.";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? null
      : "Use an http:// or https:// address.";
  } catch {
    return "That is not a web address (for example http://localhost:5173).";
  }
}

function checkedBaseUrl(value: string): string {
  const problem = appBaseUrlProblem(value);
  if (problem) throw new Error(`invalid app base URL: ${problem}`);
  return value;
}

/** A message when `permission` is not a valid application permission, otherwise null. */
export function permissionProblem(permission: string): string | null {
  return !PERMISSION_PATTERN.test(permission) || permission.startsWith("auth.")
    ? `invalid permission '${permission}' (format: resource.action, lowercase; 'auth.' is reserved)`
    : null;
}

/** Splits `a.b, c.d` into permissions, dropping empty entries. */
export function parsePermissions(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function buildConfig(answers: InitAnswers): SelfAuthConfig {
  for (const p of answers.permissions) {
    const problem = permissionProblem(p);
    if (problem) throw new Error(problem);
  }
  const permissions = [...new Set(answers.permissions)];
  return parseConfig({
    adapter: {
      backend: answers.backend ?? "express",
      frontend: answers.frontend,
      database: answers.database,
      orm: ormFor(answers.database, answers.backend),
    },
    authorization: {
      permissions,
      roles: { user: [], admin: [] },
    },
  });
}

export function renderConfig(config: SelfAuthConfig): string {
  return `import type { SelfAuthConfig } from "../auth/types.ts";

/**
 * SelfAuth configuration: behavior only, never secrets (CONF-FILE-002).
 * Every default is a secure starting point and can be changed within the
 * bounds in CONFIGURATION_SPEC.md. Check changes with \`npx selfauth validate\`.
 */
export const config: SelfAuthConfig = ${JSON.stringify(config, null, 2)};
`;
}

/** Configuration of a Go project: selfauth.config.json, read by the application at start-up. */
export function renderConfigJson(config: SelfAuthConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export const frameworkName = (answers: Pick<InitAnswers, "backend">) =>
  answers.backend === "fastify" ? "Fastify" : answers.backend === "gin" ? "Gin" : "Express";

/** Full-stack projects (a frontend was chosen) are two packages in an npm workspace. */
export const isWorkspace = (answers: Pick<InitAnswers, "frontend">) => answers.frontend !== "none";

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
  if (usesPrisma(answers.database)) {
    Object.assign(scripts, {
      generate: "prisma generate",
      postinstall: "prisma generate",
      "db:migrate": "prisma migrate deploy",
      "db:status": "prisma migrate status",
      "db:seed": "node --env-file-if-exists=.env src/scripts/seed.ts",
      "db:create-admin": "node --env-file-if-exists=.env src/scripts/create-admin.ts",
    });
  } else if (answers.database === "mongodb") {
    // MongoDB has no SQL migrations: db:migrate creates the indexes (never drops one).
    Object.assign(scripts, {
      "db:migrate": "node --env-file-if-exists=.env src/scripts/migrate.ts",
      "db:status": "node --env-file-if-exists=.env src/scripts/migrate.ts --plan",
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

/** Go projects: build output and local environment files. */
export function renderGoGitignore(): string {
  return [
    "/bin/",
    "/server",
    ".env",
    ".env.*",
    "!.env.example",
    "*.test",
    "*.out",
    "*.log",
    "",
  ].join("\n");
}

function renderGoEnvExample(answers: InitAnswers): string {
  const lines = [
    "# Environment of the server (the Go server reads the process environment; load this file",
    "# with your shell or a tool such as direnv). Never commit .env (SEC-SECRET-002).",
    "# Placeholders only.",
    "APP_ENV=development",
    "PORT=3000",
    "# Absolute URL of your frontend: email links point here (AUTHN-VERIFY-009).",
    `SELFAUTH_APP_BASE_URL=${checkedBaseUrl(answers.appBaseUrl)}`,
    '# Only for http.csrf.mode "token": 32+ random bytes, base64url.',
    "# SELFAUTH_CSRF_SECRET=",
  ];
  if (hasDatabase(answers.database)) {
    const info = DATABASE_INFO[answers.database];
    lines.push(`# ${info.label} connection.`, `DATABASE_URL=${info.urlExample}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderEnvExample(answers: InitAnswers): string {
  if (answers.backend === "gin") return renderGoEnvExample(answers);
  const lines = [
    "# Copy to .env for local development. Never commit .env (SEC-SECRET-002).",
    "# Placeholders only.",
    "NODE_ENV=development",
    "PORT=3000",
    "# Absolute URL of your frontend: email links point here (AUTHN-VERIFY-009).",
    `SELFAUTH_APP_BASE_URL=${checkedBaseUrl(answers.appBaseUrl)}`,
    '# Only for http.csrf.mode "token": 32+ random bytes, base64url.',
    "# SELFAUTH_CSRF_SECRET=",
  ];
  if (answers.backend === "fastify") {
    lines.push(
      "# Interface the server listens on: 0.0.0.0 (every IPv4 interface) by default;",
      "# 127.0.0.1 keeps it local, :: also accepts IPv6.",
      "# HOST=0.0.0.0",
    );
  }
  if (hasDatabase(answers.database)) {
    const info = DATABASE_INFO[answers.database];
    const tool = answers.database === "mongodb" ? "Mongoose" : "Prisma";
    lines.push(`# ${info.label} connection for ${tool}.`, `DATABASE_URL=${info.urlExample}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Workspace root package.json: runs both packages (`concurrently` so it also works on Windows). */
export function renderRootPackageJson(answers: InitAnswers): string {
  if (answers.backend === "gin") return renderGoRootPackageJson(answers);
  const pg = hasDatabase(answers.database);
  const scripts: Record<string, string> = {
    dev: 'concurrently -k -n server,client -c blue,green "npm run dev -w server" "npm run dev -w client"',
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    build: "npm run build -w server && npm run build -w client",
    start: "npm run start -w server",
    typecheck: "npm run typecheck -w server && npm run typecheck -w client",
    test: "npm run test -w server",
  };
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

/** Root package.json of a Gin + frontend project: npm runs the client, Go runs the server. */
function renderGoRootPackageJson(answers: InitAnswers): string {
  const scripts: Record<string, string> = {
    dev: 'concurrently -k -n server,client -c blue,green "npm run dev:server" "npm run dev:client"',
    "dev:server": "node scripts/dev-server.mjs",
    "dev:client": "npm run dev -w client",
    build: "cd server && go build -o bin/server ./cmd/server && cd .. && npm run build -w client",
    typecheck: "cd server && go vet ./... && cd .. && npm run typecheck -w client",
    test: "cd server && go test ./...",
  };
  if (hasDatabase(answers.database)) {
    Object.assign(scripts, {
      "db:migrate": "cd server && go run ./cmd/migrate up",
      "db:status": "cd server && go run ./cmd/migrate status",
      "db:seed": "cd server && go run ./cmd/seed",
      // Arguments after `npm run db:create-admin --` are appended to the command.
      "db:create-admin": "cd server && go run ./cmd/create-admin",
    });
  }
  return `${JSON.stringify(
    {
      name: answers.name,
      version: "0.1.0",
      private: true,
      workspaces: ["client"],
      engines: { node: ">=22.18" },
      scripts,
      devDependencies: { concurrently: "^9.1.0" },
    },
    null,
    2,
  )}\n`;
}

/**
 * `npm run dev:server` for a Gin + frontend project. The Go server reads the process environment
 * and never a .env file, so this loads server/.env (and gives the development defaults) first.
 */
export function renderGoDevServer(appBaseUrl: string): string {
  return `// Starts the Go server for \`npm run dev\`. The server reads the process environment, not a .env
// file, so this loads server/.env first (copy server/.env.example to server/.env).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync("server/.env")) process.loadEnvFile("server/.env");
process.env.APP_ENV ??= "development";
process.env.SELFAUTH_APP_BASE_URL ??= "${checkedBaseUrl(appBaseUrl)}";

const child = spawn("go", ["run", "./cmd/server"], {
  cwd: "server",
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
`;
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
  const pg = hasDatabase(answers.database);
  return [
    ["src/", ""],
    ["  server.ts", "starts the server"],
    ["  app.ts", `builds the ${frameworkName(answers)} app: hooks, routes, error handling`],
    ["  config/", ""],
    ["    selfauth.config.ts", "your authentication settings: roles, permissions, limits"],
    ["    env.ts", "environment variables (PORT, SELFAUTH_APP_BASE_URL, ...)"],
    ["    dev-config.ts", "cookie settings for local http development"],
    ["  routes/", ""],
    ["    index.ts", "your routes: guard them with auth.requireAuth / requirePermission"],
    ["  email/mailer.ts", "plug in your email provider here"],
    [
      "  db/store.ts",
      `picks the data store (${pg ? `${DATABASE_INFO[answers.database].label}, or in-memory without DATABASE_URL` : "in-memory"})`,
    ],
    ["  http/", "error responses and request ids"],
    [
      "  auth/",
      `SelfAuth's generated authentication code (core/, ${answers.backend ?? "express"}/, stores/)`,
    ],
    ...(pg
      ? ([
          [
            "  scripts/",
            answers.database === "mongodb"
              ? "migrate (indexes), seed (roles) and create-admin"
              : "seed (roles) and create-admin",
          ],
        ] as Row[])
      : []),
    ["test/", "smoke tests for the authentication wiring (npm test)"],
    ...(usesPrisma(answers.database)
      ? ([["prisma/", "database schema and migrations"]] as Row[])
      : []),
  ];
}

function clientRows(answers: InitAnswers): Row[] {
  return [
    ["src/", ""],
    [
      `  ${answers.frontend === "vue" ? "main.ts, App.vue, router.ts" : "main.tsx, App.tsx"}`,
      "entry point, app shell and routes",
    ],
    ["  auth/", "SelfAuth's frontend module: API client, session state, route guards, <Can>"],
    [
      "  pages/auth/",
      "the five account screens (unstyled HTML; add your own styles): login, register, verify email, forgot and reset password",
    ],
    [
      "  pages/",
      `your pages (${answers.frontend === "vue" ? "home, account, forbidden, 404" : "account"}): add yours here`,
    ],
  ];
}

/** The folder tree shown in the generated README, for the options the project was made with. */
export function renderLayout(answers: InitAnswers): string {
  const indent = (rows: Row[]): Row[] => rows.map(([name, note]) => [`  ${name}`, note]);
  const rows: Row[] = isWorkspace(answers)
    ? [
        ["server/", `the ${frameworkName(answers)} API (${DATABASE_INFO[answers.database].label})`],
        ...indent(serverRows(answers)),
        ["  package.json, tsconfig.json", "its own package"],
        ["  .env.example", "copy to server/.env"],
        ["  selfauth.manifest.json", "which files SelfAuth generated (doctor, diff, upgrade)"],
        ["client/", `the ${answers.frontend} frontend (Vite)`],
        ...indent(clientRows(answers)),
        ["  package.json", "its own package"],
        ["  selfauth.manifest.json", "which files SelfAuth generated"],
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

function renderGoWorkspaceReadme(answers: InitAnswers): string {
  const pg = hasDatabase(answers.database);
  const run = [
    "npm install                    # installs the client",
    `cp server/.env.example server/.env${pg ? "   # then set DATABASE_URL" : ""}`,
    ...(pg
      ? [
          "npm run db:status              # applied and pending migrations",
          "npm run db:migrate             # read the migration first; take a backup in production",
          "npm run db:seed                # roles from server/selfauth.config.json",
        ]
      : []),
    `npm run dev                    # the Go API on :3000 and the ${answers.frontend} app on :${new URL(answers.appBaseUrl).port || "5173"}`,
  ].join("\n");
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

You need Node.js 22.18+ and Go 1.26+.

\`\`\`bash
${run}
\`\`\`

Open ${answers.appBaseUrl}. The API is the Go module in \`server/\` and the ${answers.frontend} frontend is in \`client/\`. \`npm run dev\` starts both (the frontend proxies /auth and /api to the API). The Go server reads the process environment, not a \`.env\` file, so \`scripts/dev-server.mjs\` loads \`server/.env\` for you.
${pg ? `\nCreate the first administrator after registering and verifying: \`npm run db:create-admin -- you@example.com\`.\n` : "\nThis project uses the **in-memory store** (data is lost on restart, production refuses to start). Regenerate with `--database postgresql` for persistence.\n"}
The backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\` (\`server/.env\`). If you serve the frontend elsewhere, set that variable or add the origin to \`http.trustedOrigins\` in \`server/selfauth.config.json\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.

Email (verification, password reset) is printed to the console in development. Before production, implement \`NewMailer\` in \`server/internal/email/mailer.go\`; the server refuses to start in production until you do.

## Project layout

\`\`\`text
server/                       the Go API (Gin)
  cmd/server/main.go          starts the server
${pg ? "  cmd/migrate, cmd/seed,      apply migrations, synchronize roles, grant the first admin\n    cmd/create-admin\n  db/migrations/            the PostgreSQL schema\n" : ""}  internal/
    auth/                     SelfAuth's core: the rules, no HTTP (the tested security code)
    ginauth/                  the Gin binding: cookies, CORS, CSRF, the /auth routes, guards
    store/                    data stores (memory${pg ? ", postgres" : ""})
    email/mailer.go           plug in your email provider here
    routes/routes.go          your routes: guard them with a.RequirePermission(...)
    config/, app/, httpx/     configuration, wiring, request ids and errors
  selfauth.config.json        your authentication settings: roles, permissions, limits
  .env.example                copy to server/.env
  selfauth.manifest.json      which files SelfAuth generated (doctor, diff, upgrade)
client/                       the ${answers.frontend} frontend (Vite)
  src/auth/                   SelfAuth's frontend module: API client, session state, route guards, <Can>
  src/pages/auth/             the five account screens (unstyled HTML; add your own styles)
  src/pages/                  your pages: add yours here
  selfauth.manifest.json      which files SelfAuth generated
scripts/dev-server.mjs        starts the Go server for \`npm run dev\`
package.json                  workspace root: \`npm run dev\` starts both
\`\`\`

Authentication behaviour is configuration (\`server/selfauth.config.json\`), not code you edit:
\`server/internal/auth\` is the tested security core.

## Checks

\`npm test\` runs the Go tests and \`npm run typecheck\` runs \`go vet\` and the client's type check.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings (checks server/ and client/)
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}

function renderGoReadme(answers: InitAnswers): string {
  if (isWorkspace(answers)) return renderGoWorkspaceReadme(answers);
  const pg = hasDatabase(answers.database);
  const env = [
    "export APP_ENV=development",
    `export SELFAUTH_APP_BASE_URL=${answers.appBaseUrl}`,
    ...(pg ? [`export DATABASE_URL=${DATABASE_INFO[answers.database].urlExample}`] : []),
  ];
  const run = [
    ...env,
    ...(pg
      ? [
          "go run ./cmd/migrate status   # applied and pending migrations",
          "go run ./cmd/migrate up       # read the migration first; take a backup in production",
          "go run ./cmd/seed             # roles from selfauth.config.json",
        ]
      : []),
    "go run ./cmd/server",
  ].join("\n");
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

\`\`\`bash
${run}
\`\`\`

The server reads the process environment (see \`.env.example\`); it does not load a \`.env\` file
itself. Email (verification, password reset) is printed to the console in development. Before
production, implement \`NewMailer\` in \`internal/email/mailer.go\`; the server refuses to start in
production until you do.
${pg ? `\nCreate the first administrator after registering and verifying: \`go run ./cmd/create-admin you@example.com\`.\n` : "\nThis project uses the **in-memory store** (data is lost on restart, production refuses to start). Regenerate with `--database postgresql` for persistence.\n"}
## Project layout

\`\`\`text
cmd/server/main.go          starts the server
${pg ? "cmd/migrate, cmd/seed,     apply migrations, synchronize roles, grant the first admin\n  cmd/create-admin\ndb/migrations/            the PostgreSQL schema\n" : ""}internal/
  auth/                     SelfAuth's core: the rules, no HTTP (the tested security code)
  ginauth/                  the Gin binding: cookies, CORS, CSRF, the /auth routes, guards
  httpx/                    request ids, error responses, body limit
  store/                    data stores (memory${pg ? ", postgres" : ""})
  email/mailer.go           plug in your email provider here
  routes/routes.go          your routes: guard them with a.RequirePermission(...)
  config/                   selfauth.config.json and the environment
  app/                      wiring
selfauth.config.json        your authentication settings: roles, permissions, limits
selfauth.manifest.json      which files SelfAuth generated (doctor, diff, upgrade)
\`\`\`

Authentication behaviour is configuration (\`selfauth.config.json\`), not code you edit:
\`internal/auth\` is the tested security core.

## Routes

Authentication lives under \`/auth\` (register, login, logout, me, email verification, password
reset/change, sessions, admin). Add your own routes in \`internal/routes/routes.go\`; routes on
\`a.ProtectedRoutes(...)\` are denied unless a guard such as \`a.RequirePermission("x.y")\` allows them.

Browsers must send \`X-SelfAuth-CSRF: 1\` on state-changing requests.

## Checks

\`go vet ./... && go test ./...\` runs the tests (no database needed for most of them). They are yours to
extend. The SelfAuth CLI is a development tool and optional; the app never needs it to run.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}

export function renderReadme(answers: InitAnswers): string {
  if (answers.backend === "gin") return renderGoReadme(answers);
  const pg = hasDatabase(answers.database);
  const ws = isWorkspace(answers);
  const env = ws ? "server/.env" : ".env";
  const base = ws ? "server/" : "";
  const run = [
    "npm install",
    `cp ${ws ? "server/.env.example server/.env" : ".env.example .env"}${pg ? "   # then set DATABASE_URL" : ""}`,
    ...(pg
      ? [
          answers.database === "mongodb"
            ? "npx selfauth db plan          # optional: show the indexes db:migrate would create"
            : "npx selfauth db plan          # optional: review the migration for destructive changes",
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
${ws ? `\nOpen ${answers.appBaseUrl}. The API is in \`server/\` and the ${answers.frontend} frontend in \`client/\`; they are two packages in one npm workspace, so one \`npm install\` at the root installs both and \`npm run dev\` starts both (the frontend proxies /auth and /api to the API). The frontend's \`src/auth/\` holds the API client, session state, route guards and \`<Can>\`. Your API routes go in \`server/src/routes/\` (guard them with \`auth.requireAuth\` or \`auth.requirePermission\`), your pages in \`client/src/pages/\`.\n\nThe backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\` (\`${env}\`). If you serve the frontend elsewhere (for example \`vite preview\` on another port, or a deployed domain), set that variable or add the origin to \`http.trustedOrigins\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.\n` : ""}
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
