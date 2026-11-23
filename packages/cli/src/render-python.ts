import { DATABASE_INFO, hasDatabase } from "./templates.js";
import { checkedBaseUrl, clientTree, isWorkspace } from "./render.js";
import type { InitAnswers } from "./render.js";

/** The Python libraries each database needs (the project installs only the one it uses). */
const DATABASE_REQUIREMENTS: Record<string, string> = {
  postgresql: "psycopg[binary]>=3.2",
  mysql: "PyMySQL[rsa]>=1.1",
  mongodb: "pymongo>=4.9",
};

/** requirements.txt of a Flask project: the runtime libraries, and the one database driver it uses. */
export function renderRequirements(answers: InitAnswers): string {
  const driver = DATABASE_REQUIREMENTS[answers.database];
  return [
    "# What the server needs. Install with: pip install -r requirements.txt",
    "flask>=3.1,<4",
    "argon2-cffi>=23.1",
    "waitress>=3.0",
    ...(driver ? [`${driver}`] : []),
    "",
  ].join("\n");
}

/** requirements-dev.txt: the runtime libraries plus what the tests need. */
export function renderRequirementsDev(): string {
  return ["-r requirements.txt", "pytest>=8", ""].join("\n");
}

/** pytest.ini: tests import the project's own `app` package, so the project root is on the path. */
export function renderPytestIni(): string {
  return ["[pytest]", "testpaths = tests", "pythonpath = .", ""].join("\n");
}

export function renderPythonGitignore(): string {
  return [
    "__pycache__/",
    "*.py[cod]",
    ".venv/",
    "venv/",
    ".pytest_cache/",
    ".env",
    ".env.*",
    "!.env.example",
    "*.log",
    // SQLite database files: never commit data.
    "*.db",
    "*.db-journal",
    "*.db-shm",
    "*.db-wal",
    "",
  ].join("\n");
}

/** .env.example of a Flask project: the server loads `.env` itself in development. */
export function renderPythonEnvExample(answers: InitAnswers): string {
  const lines = [
    "# Copy to .env for local development; the server loads it (variables already set in the real",
    "# environment win). Never commit .env (SEC-SECRET-002). Placeholders only.",
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

/** Root package.json of a Flask + frontend project: npm runs the client, Python runs the server. */
export function renderPythonRootPackageJson(answers: InitAnswers): string {
  const scripts: Record<string, string> = {
    dev: 'concurrently -k -n server,client -c blue,green "npm run dev:server" "npm run dev:client"',
    "dev:server": "node scripts/dev-server.mjs",
    "dev:client": "npm run dev -w client",
    build: "npm run build -w client",
    typecheck: "npm run typecheck -w client",
    test: "node scripts/dev-server.mjs -m pytest",
  };
  if (hasDatabase(answers.database)) {
    Object.assign(scripts, {
      "db:migrate": "node scripts/dev-server.mjs migrate up",
      "db:status": "node scripts/dev-server.mjs migrate status",
      "db:seed": "node scripts/dev-server.mjs seed",
      // Arguments after `npm run db:create-admin --` are appended to the command.
      "db:create-admin": "node scripts/dev-server.mjs create-admin",
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
 * `npm run dev:server` for a Flask + frontend project: runs a command of the Python server with
 * the project's virtual environment (server/.venv) when it has one.
 */
export function renderPythonDevServer(appBaseUrl: string): string {
  return `// Runs a command of the Flask server: \`npm run dev\` starts the server (python -m app.cmd.server),
// \`node scripts/dev-server.mjs seed\` runs python -m app.cmd.seed, and so on. \`-m pytest\` runs the tests.
// It uses server/.venv when you created one (python3 -m venv server/.venv), else the python on your PATH.
// The server loads server/.env itself; this also loads it so the defaults below do not override it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync("server/.env")) process.loadEnvFile("server/.env");
process.env.APP_ENV ??= "development";
process.env.SELFAUTH_APP_BASE_URL ??= "${checkedBaseUrl(appBaseUrl)}";

const windows = process.platform === "win32";
const venv = windows ? "server/.venv/Scripts/python.exe" : "server/.venv/bin/python";
const python = existsSync(venv) ? resolve(venv) : windows ? "python" : "python3";

const [command = "server", ...args] = process.argv.slice(2);
if (!/^(-m|[a-z][a-z-]*)$/.test(command)) throw new Error(\`unknown command: \${command}\`);
const moduleArgs =
  command === "-m" ? ["-m", ...args] : ["-m", \`app.cmd.\${command.replaceAll("-", "_")}\`, ...args];
const child = spawn(python, moduleArgs, {
  cwd: "server",
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
`;
}

function layout(answers: InitAnswers) {
  const sql = ["postgresql", "mysql", "sqlite"].includes(answers.database);
  return {
    sql,
    label: answers.database === "memory" ? "" : DATABASE_INFO[answers.database].label,
    stores: sql
      ? "memory and SQL"
      : answers.database === "mongodb"
        ? "memory and MongoDB"
        : "memory",
  };
}

/** README of a Flask project, single package or the server/ of a full-stack one. */
export function renderPythonReadme(answers: InitAnswers): string {
  const ws = isWorkspace(answers);
  const pg = hasDatabase(answers.database);
  const lay = layout(answers);
  const base = ws ? "server/" : "";
  const venv = ws ? "server/.venv" : ".venv";
  const run = ws
    ? [
        "npm install                    # installs the client",
        "python3 -m venv server/.venv",
        "server/.venv/bin/pip install -r server/requirements-dev.txt   # Windows: server\\.venv\\Scripts\\pip",
        `cp server/.env.example server/.env${pg ? "   # then set DATABASE_URL" : ""}`,
        ...(pg
          ? [
              "npm run db:status              # applied and pending migrations",
              "npm run db:migrate             # read the migration first; take a backup in production",
              "npm run db:seed                # roles from server/selfauth.config.json",
            ]
          : []),
        `npm run dev                    # the Flask API on :3000 and the ${answers.frontend} app on :${new URL(answers.appBaseUrl).port || "5173"}`,
      ]
    : [
        "python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\\Scripts\\activate",
        "pip install -r requirements-dev.txt",
        `cp .env.example .env${pg ? "   # then set DATABASE_URL" : ""}`,
        ...(pg
          ? [
              `python -m app.cmd.migrate status   # ${lay.sql ? "applied and pending migrations" : "the indexes still to create"}`,
              `python -m app.cmd.migrate up       # ${lay.sql ? "read the migration first; take a backup in production" : "creates the missing indexes; never drops one"}`,
              "python -m app.cmd.seed             # roles from selfauth.config.json",
            ]
          : []),
        "python -m app.cmd.server",
      ];
  const admin = ws
    ? "npm run db:create-admin -- you@example.com"
    : "python -m app.cmd.create_admin you@example.com";
  const tree = `${ws ? "server/                       the Flask API\n" : ""}${base ? "  " : ""}app/
${base ? "  " : ""}  cmd/                      server, migrate, seed, create_admin
${base ? "  " : ""}  auth/                     SelfAuth's core: the rules, no HTTP (the tested security code)
${base ? "  " : ""}  flask_auth.py             the Flask binding: cookies, CORS, CSRF, the /auth routes, guards
${base ? "  " : ""}  store/                    data stores (${lay.stores})
${base ? "  " : ""}  mailer.py                 plug in your email provider here
${base ? "  " : ""}  routes.py                 your routes: guard them with @auth.require_permission(...)
${base ? "  " : ""}  config.py, factory.py, wsgi.py, httpx.py   configuration, wiring, errors
${base ? "  " : ""}${lay.sql ? "db/migrations/              the " + lay.label + " schema\n" + (base ? "  " : "") : ""}tests/                     pytest tests (no database needed)
${base ? "  " : ""}selfauth.config.json         your authentication settings: roles, permissions, limits
${base ? "  " : ""}requirements.txt             what the server installs (requirements-dev.txt adds pytest)
${base ? "  " : ""}.env.example                 copy to ${base}.env
${base ? "  " : ""}selfauth.manifest.json       which files SelfAuth generated (doctor, diff, upgrade)`;
  const client = ws
    ? `${clientTree(answers)}
  selfauth.manifest.json      which files SelfAuth generated
scripts/dev-server.mjs        starts the Flask server for \`npm run dev\`
package.json                  workspace root: \`npm run dev\` starts both
`
    : "";
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

You need Python 3.11+${ws ? " and Node.js 22.18+" : ""}.

\`\`\`bash
${run.join("\n")}
\`\`\`
${ws ? `\nOpen ${answers.appBaseUrl}. The API is the Flask app in \`server/\` and the ${answers.frontend} frontend is in \`client/\`. \`npm run dev\` starts both (the frontend proxies /auth and /api to the API).\n\nThe backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\` (\`server/.env\`). If you serve the frontend elsewhere, set that variable or add the origin to \`http.trustedOrigins\` in \`server/selfauth.config.json\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.\n` : ""}
The server loads \`${base}.env\` itself in development (variables already set in the real environment win).
Email (verification, password reset) is printed to the console in development. Before production,
implement \`create_mailer\` in \`${base}app/mailer.py\`; the server refuses to start in production until you do.
${pg ? `\nCreate the first administrator after registering and verifying: \`${admin}\`.\n` : "\nThis project uses the **in-memory store** (data is lost on restart, production refuses to start). Regenerate with `--database postgresql` for persistence.\n"}
## Project layout

\`\`\`text
${tree}
${client}\`\`\`

Authentication behaviour is configuration (\`${base}selfauth.config.json\`), not code you edit:
\`${base}app/auth\` is the tested security core.

## Routes

Authentication lives under \`/auth\` (register, login, logout, me, email verification, password
reset/change, sessions, admin). Add your own routes in \`${base}app/routes.py\`; routes on
\`auth.protected(app, "/api")\` are denied unless a guard such as \`@auth.require_permission("x.y")\` allows them.

Browsers must send \`X-SelfAuth-CSRF: 1\` on state-changing requests.

## Checks

\`${ws ? "npm test" : "pytest"}\` runs the tests (they use the in-memory store, so no database is needed). They are
yours to extend. The virtual environment is \`${venv}\`. The SelfAuth CLI is a development tool and
optional; the app never needs it to run.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings${ws ? " (checks server/ and client/)" : ""}
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}
