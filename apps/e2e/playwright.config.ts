import { defineConfig, devices } from "@playwright/test";

export interface E2EOptions {
  /** The Express e2e backend serving this frontend (test-only mail endpoint). */
  backendUrl: string;
}

/**
 * One spec, every reference frontend. Each frontend is built, served by
 * `vite preview`, and proxies /auth and /api to its own Express e2e backend
 * (same-origin topology, docs/frontend-deployment.md). Separate backends keep
 * email links pointing at the right origin.
 */
const apps = [
  { name: "vue", pkg: "@selfauth/playground-vue", app: 4173, backend: 3100 },
  { name: "react", pkg: "@selfauth/playground-react", app: 4174, backend: 3101 },
];

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
      baseURL: `http://localhost:${a.app}`,
      backendUrl: `http://localhost:${a.backend}`,
    },
  })),
  webServer: apps.flatMap((a) => [
    {
      command: "pnpm --filter @selfauth/playground e2e:server",
      env: { PORT: String(a.backend), SELFAUTH_APP_BASE_URL: `http://localhost:${a.app}` },
      url: `http://localhost:${a.backend}/health`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter ${a.pkg} build && pnpm --filter ${a.pkg} preview`,
      env: { SELFAUTH_API_TARGET: `http://localhost:${a.backend}` },
      url: `http://localhost:${a.app}`,
      reuseExistingServer: false,
    },
  ]),
});
