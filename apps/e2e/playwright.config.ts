import { defineConfig, devices } from "@playwright/test";

export interface E2EOptions {
  /** The e2e backend serving this frontend (test-only mail endpoint). */
  backendUrl: string;
}

/**
 * One spec, every reference frontend against every reference backend. Each frontend is built once,
 * served by `vite preview` (or `next start`), and proxies /auth and /api to its own e2e backend (same-origin
 * topology, docs/frontend-deployment.md). Separate backends keep email links pointing at the
 * right origin. Web servers start in order, so a frontend's first entry builds it and later
 * entries only serve the finished build.
 */
const allFrontends = [
  { name: "vue", pkg: "@selfauth/playground-vue", serve: "vite preview" },
  { name: "react", pkg: "@selfauth/playground-react", serve: "vite preview" },
  // Next.js forwards /auth and /api at run time (src/proxy.ts), so one build serves every backend.
  { name: "next", pkg: "@selfauth/playground-next-web", serve: "next start" },
];
const allBackends = [
  { name: "express", pkg: "@selfauth/playground", build: false },
  { name: "fastify", pkg: "@selfauth/playground-fastify", build: false },
  { name: "gin", pkg: "@selfauth/playground-gin", build: false },
  { name: "flask", pkg: "@selfauth/playground-flask", build: false },
  // The Next.js backend serves its built app: `next build` runs before its first e2e server.
  { name: "next", pkg: "@selfauth/playground-next", build: true },
];
// E2E_BACKENDS=flask / E2E_FRONTENDS=next run a subset (handy when iterating on one).
const only = <T extends { name: string }>(all: T[], variable: string): T[] => {
  const wanted = process.env[variable]?.split(",").map((b) => b.trim());
  return wanted ? all.filter((b) => wanted.includes(b.name)) : all;
};
const frontends = only(allFrontends, "E2E_FRONTENDS");
const backends = only(allBackends, "E2E_BACKENDS");

let nextPort = 3100;
const apps = backends.flatMap((backend) =>
  frontends.map((frontend) => {
    const offset = nextPort++ - 3100;
    return {
      name: `${frontend.name}-${backend.name}`,
      frontend,
      backend,
      backendPort: 3100 + offset,
      appPort: 4173 + offset,
      first: backend === backends[0],
      firstForBackend: frontend === frontends[0],
    };
  }),
);

export default defineConfig<E2EOptions>({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  use: { trace: "off" },
  projects: apps.map((a) => ({
    name: a.name,
    use: {
      ...devices["Desktop Chrome"],
      baseURL: `http://localhost:${a.appPort}`,
      backendUrl: `http://localhost:${a.backendPort}`,
    },
  })),
  webServer: apps.flatMap((a) => [
    {
      command: `${
        a.backend.build && a.firstForBackend ? `pnpm --filter ${a.backend.pkg} build && ` : ""
      }pnpm --filter ${a.backend.pkg} e2e:server`,
      env: {
        PORT: String(a.backendPort),
        SELFAUTH_APP_BASE_URL: `http://localhost:${a.appPort}`,
      },
      url: `http://localhost:${a.backendPort}/health`,
      reuseExistingServer: false,
    },
    {
      command: a.first
        ? `pnpm --filter ${a.frontend.pkg} build && pnpm --filter ${a.frontend.pkg} exec ${a.frontend.serve} --port ${a.appPort}`
        : `pnpm --filter ${a.frontend.pkg} exec ${a.frontend.serve} --port ${a.appPort}`,
      env: { SELFAUTH_API_TARGET: `http://localhost:${a.backendPort}` },
      url: `http://localhost:${a.appPort}`,
      reuseExistingServer: false,
    },
  ]),
});
