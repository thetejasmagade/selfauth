import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several tests start the built CLI as a child process (a few times each). On a busy CI
    // runner, with every package's tests running at once, that can pass the 5 s default.
    testTimeout: 30_000,
    // template-variants/ holds files copied into generated projects (they run there, under
    // node:test), and dist/ holds a bundled copy of them.
    exclude: [...configDefaults.exclude, "template-variants/**", "dist/**"],
  },
});
