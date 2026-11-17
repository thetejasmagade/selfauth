import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // template-variants/ holds files copied into generated projects (they run there, under
    // node:test), and dist/ holds a bundled copy of them.
    exclude: [...configDefaults.exclude, "template-variants/**", "dist/**"],
  },
});
