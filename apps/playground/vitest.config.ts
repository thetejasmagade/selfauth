import { configDefaults, defineConfig } from "vitest/config";

// scripts/dialect-conformance.mjs makes test copies in .dialect/ and runs them itself.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/.dialect/**"] },
});
