import { DATABASE_INFO, hasDatabase, usesPrisma } from "./templates.js";
import type { InitAnswers } from "./render.js";

/**
 * One Next.js app that is both the API and the frontend: a single package, no client/ and
 * server/ split. (Next.js as the backend with a Vue or React frontend, and Next.js as the
 * frontend of another backend, are workspaces like every other full-stack project.)
 */
export const isNextFullStack = (answers: Pick<InitAnswers, "backend" | "frontend">): boolean =>
  answers.backend === "next" && answers.frontend === "next";

/** tsconfig.json of a Next.js package (the API, the full-stack app or a client/). */
export function renderNextTsconfig(): string {
  const config = {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      types: ["node"],
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      verbatimModuleSyntax: true,
      isolatedModules: true,
      erasableSyntaxOnly: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
      incremental: true,
      jsx: "react-jsx",
      plugins: [{ name: "next" }],
      // Next.js adds these two itself the first time it runs; written here, it leaves the file alone.
      allowJs: true,
      esModuleInterop: true,
    },
    include: ["next-env.d.ts", "src", "test", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
    exclude: ["node_modules"],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** The npm scripts of a package that runs Next.js (`next` reads PORT and .env itself). */
export function nextScripts(options: { port?: number } = {}): Record<string, string> {
  const port = options.port === undefined ? "" : ` --port ${options.port}`;
  return {
    dev: `next dev${port}`,
    build: "next build",
    start: `next start${port}`,
    typecheck: "tsc -p tsconfig.json --noEmit",
  };
}

type Row = [string, string];

const rowsToText = (rows: Row[]): string => {
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, note]) => (note ? `${name.padEnd(width)}${note}` : name)).join("\n");
};

/** The files of the API half of a Next.js project, for the README's layout section. */
function apiRows(answers: InitAnswers, indent: string): Row[] {
  const pg = hasDatabase(answers.database);
  const rows: Row[] = [
    ["src/", ""],
    [
      "  app/auth/[[...path]]/route.ts",
      "every /auth route (register, login, me, ...) is served here",
    ],
    ["  app/api/", "your API routes: one route.ts per path, built with withAuth"],
    ["    [[...path]]/route.ts", "unknown /api paths get the error envelope, not an HTML 404"],
    ["  app/health/route.ts", "health check"],
    ["  lib/auth.ts", "builds SelfAuth on the first request; withAuth() for your handlers"],
    ["  instrumentation.ts", "starts SelfAuth when the server boots (bad configuration stops it)"],
    ["  config/", ""],
    ["    selfauth.config.ts", "your authentication settings: roles, permissions, limits"],
    ["    env.ts", "environment variables (SELFAUTH_APP_BASE_URL, ...)"],
    ["    dev-config.ts", "cookie settings for local http development"],
    ["  email/mailer.ts", "plug in your email provider here"],
    [
      "  db/store.ts",
      `picks the data store (${pg ? `${DATABASE_INFO[answers.database].label}, or in-memory without DATABASE_URL` : "in-memory"})`,
    ],
    ["  http/errors.ts", "error responses"],
    ["  auth/", "SelfAuth's generated authentication code (core/, next/, stores/)"],
  ];
  if (pg) {
    rows.push([
      "  scripts/",
      answers.database === "mongodb"
        ? "migrate (indexes), seed (roles) and create-admin"
        : "seed (roles) and create-admin",
    ]);
  }
  rows.push(["test/", "smoke tests for the authentication wiring (npm test)"]);
  if (usesPrisma(answers.database)) rows.push(["prisma/", "database schema and migrations"]);
  rows.push(["next.config.ts", "Next.js settings (database packages are not bundled)"]);
  return rows.map(([name, note]) => [`${indent}${name}`, note]);
}

/** The folders of the Next.js frontend, for the README's layout section. */
export function nextClientRows(indent: string): Row[] {
  const rows: Row[] = [
    ["src/", ""],
    [
      "  app/",
      "the pages (App Router): home, login, register, verify-email, forgot/reset-password, account",
    ],
    ["  app/layout.tsx", "the shell: header, session state"],
    [
      "  auth-client/",
      "SelfAuth's frontend module: API client, session state, route guards, <Can>",
    ],
    ["  screens/auth/", "the five account screens (unstyled HTML; add your own styles)"],
    ["  screens/", "your screens: add yours here"],
  ];
  return rows.map(([name, note]) => [`${indent}${name}`, note]);
}

/** The README's folder tree for a project whose backend is Next.js. */
export function renderNextLayout(answers: InitAnswers): string {
  const manifest: Row = [
    "selfauth.manifest.json",
    "which files SelfAuth generated (used by doctor, diff, upgrade)",
  ];
  if (isNextFullStack(answers)) {
    return rowsToText([
      ...apiRows(answers, ""),
      ...nextClientRows("").filter(([name]) => name !== "src/"),
      ["package.json, tsconfig.json", "the one package; .env.example is the environment to copy"],
      manifest,
    ]);
  }
  if (answers.frontend === "none") {
    return rowsToText([...apiRows(answers, ""), manifest]);
  }
  return rowsToText([
    ["server/", `the Next.js API (${DATABASE_INFO[answers.database].label})`],
    ...apiRows(answers, "  "),
    ["  package.json, tsconfig.json", "its own package"],
    ["  .env.example", "copy to server/.env"],
    ["  selfauth.manifest.json", "which files SelfAuth generated (doctor, diff, upgrade)"],
    ["client/", `the ${answers.frontend} frontend (Vite)`],
    ["  src/", ""],
    ["    main.*, App.*", "entry point, app shell and routes"],
    ["    auth/", "SelfAuth's frontend module: API client, session state, route guards, <Can>"],
    ["    pages/auth/", "the five account screens (unstyled HTML; add your own styles)"],
    ["    pages/", "your pages: add yours here"],
    ["  package.json", "its own package"],
    ["package.json", "workspace root: `npm run dev` starts both"],
  ]);
}

/** README.md of a project whose backend is Next.js (API only, full-stack, or with a Vite frontend). */
export function renderNextReadme(answers: InitAnswers): string {
  const pg = hasDatabase(answers.database);
  const full = isNextFullStack(answers);
  const ws = !full && answers.frontend !== "none";
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
      ? `npm run dev                   # the Next.js API on :3000 and the ${answers.frontend} app together`
      : "npm run dev",
  ].join("\n");
  const where = full
    ? `\nOpen ${answers.appBaseUrl}. It is one Next.js app: the pages are in \`src/app/\` and \`src/screens/\`, the API in \`src/app/auth/\` and \`src/app/api/\`. The browser and the API share one origin, so cookies stay \`SameSite=Lax\` and no CORS is needed.\n`
    : ws
      ? `\nOpen ${answers.appBaseUrl}. The API is a Next.js app in \`server/\` (no pages) and the ${answers.frontend} frontend is in \`client/\`; they are two packages in one npm workspace, so one \`npm install\` at the root installs both and \`npm run dev\` starts both (the frontend proxies /auth and /api to the API).\n\nThe backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\` (\`${env}\`). If you serve the frontend elsewhere, set that variable or add the origin to \`http.trustedOrigins\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.\n`
      : "";
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

\`\`\`bash
${run}
\`\`\`
${where}
Email (verification, password reset) is printed to the console in
development. Before production, implement \`createMailer()\` in
\`${base}src/email/mailer.ts\`; the server refuses to start in production until you do.
${pg ? "" : "\nThis project uses the **in-memory store** (data is lost on restart). Regenerate with `--database postgresql` for persistence.\n"}
## Project layout

\`\`\`text
${renderNextLayout(answers)}
\`\`\`

Authentication behaviour is configuration (\`${base}src/config/selfauth.config.ts\`), not code you
edit: \`${base}src/auth/\` is the tested security core.

## Routes

Authentication lives under \`/auth\` (register, login, logout, me, email
verification, password reset/change, sessions, admin). Add your own API routes as
\`${base}src/app/api/<name>/route.ts\` files and build each handler with \`withAuth\`:

\`\`\`ts
export const GET = withAuth((auth) =>
  auth.protect(auth.requirePermission("orders.view"), (_req, call) =>
    Response.json({ hello: call.auth.user.email }),
  ),
);
\`\`\`

\`auth.protect(...)\` needs a signed-in user and refuses a route no guard allowed;
\`auth.route(...)\` is a public route that still gets the session, the CSRF check and the error
envelope. See \`${base}src/app/api/hello/route.ts\`.

Browsers must send \`X-SelfAuth-CSRF: 1\` on state-changing requests (or use
the SelfAuth frontend client).

Next.js route handlers cannot see the connection, so the client address comes from
\`X-Forwarded-For\`. \`http.trustProxy\` in \`${base}src/config/selfauth.config.ts\` is the number of
proxies in front of the app (1 behind a platform or a reverse proxy). Set it to match your
deployment, or the per-address rate limits cannot tell visitors apart.
${pg ? `\nCreate the first administrator after registering: \`npm run db:create-admin you@example.com\`.\n` : ""}
## Checks

\`npm test\` runs smoke tests of the authentication wiring${ws ? " in `server/test/`" : " in `test/`"} (no database needed).
They are yours to extend. The SelfAuth CLI is a development tool and optional; the app never
needs it to run.

\`npm start\` runs the production server, which refuses to start until a real mailer, an https
\`SELFAUTH_APP_BASE_URL\` and a database are configured.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings${ws ? " (checks server/ and client/)" : ""}
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}
