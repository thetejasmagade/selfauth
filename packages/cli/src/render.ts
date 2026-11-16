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

/** Resolved configuration written to src/selfauth.config.ts (validated by the spec schema). */
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

export function renderConfig(config: SelfAuthConfig): string {
  return `import type { SelfAuthConfig } from "./auth/types.ts";

/**
 * SelfAuth configuration: behavior only, never secrets (CONF-FILE-002).
 * Every default is a secure starting point and can be changed within the
 * bounds in CONFIGURATION_SPEC.md. Check changes with \`npx selfauth validate\`.
 */
export const config: SelfAuthConfig = ${JSON.stringify(config, null, 2)};
`;
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
  };
  if (answers.frontend !== "none") {
    Object.assign(scripts, {
      "dev:web": "npm --prefix web run dev",
      "build:web": "npm --prefix web run build",
    });
  }
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
      name: answers.name,
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
    include: ["src"],
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
      name: `${answers.name}-web`,
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

export function renderGitignore(): string {
  return [
    "node_modules/",
    "dist/",
    ".env",
    ".env.*",
    "!.env.example",
    "src/generated/",
    "*.log",
    "",
  ].join("\n");
}

export function renderReadme(answers: InitAnswers): string {
  const pg = answers.database === "postgresql";
  const web = answers.frontend !== "none";
  return `# ${answers.name}

Generated by SelfAuth. **All of this code is yours**: read it, change it,
deploy it. Nothing here calls a SelfAuth service.

## Run

\`\`\`bash
npm install
cp .env.example .env${pg ? "            # then set DATABASE_URL" : ""}
${pg ? "npx selfauth db plan          # optional: review the migration for destructive changes\nnpm run db:migrate\nnpm run db:seed               # roles from src/selfauth.config.ts\n" : ""}npm run dev${web ? "                   # API on :3000\nnpm --prefix web install && npm run dev:web   # " + answers.frontend + " app, proxies /auth and /api" : ""}
\`\`\`
${web ? `\nOpen ${answers.appBaseUrl}. The frontend lives in \`web/\` (${answers.frontend}); its \`src/auth/\` holds the API client, session state, route guards and \`<Can>\`. The \`notes\` example (backend \`src/example/notes.ts\`, frontend notes page) shows permissions and ownership: replace it with your own features.\n\nThe backend only trusts the frontend origin in \`SELFAUTH_APP_BASE_URL\`. If you serve the frontend elsewhere (for example \`vite preview\` on another port, or a deployed domain), set that variable or add the origin to \`http.trustedOrigins\`, or state-changing requests fail with CSRF_FAILED. See https://github.com/thetejasmagade/selfauth/blob/main/docs/frontend-deployment.md.\n` : ""}
Email (verification, password reset) is printed to the console in
development. Before production, implement \`createMailer()\` in
\`src/mailer.ts\`; the server refuses to start in production until you do.
${pg ? "" : "\nThis project uses the **in-memory store** (data is lost on restart). Regenerate with `--database postgresql` for persistence.\n"}
## Routes

Authentication lives under \`/auth\` (register, login, logout, me, email
verification, password reset/change, sessions, admin). Add your own routes in
\`src/routes.ts\`; guard them with \`auth.requireAuth\`,
\`auth.requirePermission("x.y")\` or \`auth.protectedRoutes()\`.

Browsers must send \`X-SelfAuth-CSRF: 1\` on state-changing requests (or use
the SelfAuth frontend client).
${pg ? "\nCreate the first administrator after registering: `npm run db:create-admin you@example.com`.\n" : ""}
## Checks (optional)

The SelfAuth CLI is a development tool; the app never needs it to run.

\`\`\`bash
npx selfauth doctor     # configuration and production-readiness warnings
npx selfauth validate   # configuration schema + which generated files you changed
npx selfauth diff       # what a newer SelfAuth release would change
\`\`\`
`;
}
