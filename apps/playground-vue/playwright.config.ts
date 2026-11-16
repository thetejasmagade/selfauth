import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests: the built Vue app (vite preview, :4173) proxies /auth and
 * /api to the Express e2e backend (:3100) — the same-origin topology from
 * docs/frontend-deployment.md.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @selfauth/playground e2e:server",
      url: "http://localhost:3100/health",
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm exec vite build && pnpm exec vite preview",
      env: { SELFAUTH_API_TARGET: "http://localhost:3100" },
      url: "http://localhost:4173",
      reuseExistingServer: false,
    },
  ],
});
