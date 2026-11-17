import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These tests run the skill's scripts and the built CLI as child processes, several times
    // each. On a busy CI runner, with every package's tests running at once, that can pass
    // the 5 s default.
    testTimeout: 30_000,
  },
});
