import { defineConfig } from "vitest/config";

// The Go harness is built and started once per run (test/conformance/harness.ts).
export default defineConfig({
  test: { include: ["test/conformance/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 120_000 },
});
