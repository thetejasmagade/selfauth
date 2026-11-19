import { defineConfig, devices } from "@playwright/test";

export interface E2EOptions {
  /** The e2e backend serving this frontend (test-only mail endpoint). */
  backendUrl: string;
}

/**
 * One spec, every reference frontend against every reference backend. Each frontend is built once,
 * served by `vite preview`, and proxies /auth and /api to its own e2e backend (same-origin
 * topology, docs/frontend-deployment.md). Separate backends keep email links pointing at the
 * right origin. Web servers start in order, so a frontend's first entry builds it and later
 * entries only serve the finished build.
 */
const frontends = [
  { name: "vue", pkg: "@selfauth/playground-vue" },
  { name: "react", pkg: "@selfauth/playground-react" },
];
const allBackends = [
  { name: "express", pkg: "@selfauth/playground" },
  { name: "fastify", pkg: "@selfauth/playground-fastify" },
  { name: "gin", pkg: "@selfauth/playground-gin" },
];
// E2E_BACKENDS=gin runs one backend only (handy when iterating on it).
const wanted = process.env["E2E_BACKENDS"]?.split(",").map((b) => b.trim());
const backends = wanted ? allBackends.filter((b) => wanted.includes(b.name)) : allBackends;

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
      command: `pnpm --filter ${a.backend.pkg} e2e:server`,
      env: {
        PORT: String(a.backendPort),
        SELFAUTH_APP_BASE_URL: `http://localhost:${a.appPort}`,
      },
      url: `http://localhost:${a.backendPort}/health`,
      reuseExistingServer: false,
    },
    {
      command: a.first
        ? `pnpm --filter ${a.frontend.pkg} build && pnpm --filter ${a.frontend.pkg} exec vite preview --port ${a.appPort}`
        : `pnpm --filter ${a.frontend.pkg} exec vite preview --port ${a.appPort}`,
      env: { SELFAUTH_API_TARGET: `http://localhost:${a.backendPort}` },
      url: `http://localhost:${a.appPort}`,
      reuseExistingServer: false,
    },
  ]),
});
