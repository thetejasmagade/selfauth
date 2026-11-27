import { configDefaults, defineConfig } from "vitest/config";

// scripts/dialect-conformance.mjs makes test copies in .dialect/ and runs them itself.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.dialect/**"],
    // The PostgreSQL migration tests start Prisma's CLI, and the conformance cases hash passwords
    // concurrently. Run side by side on a shared CI machine, the migration test can take 45 to 60+
    // seconds against its 60 second limit, so the files run one after another.
    fileParallelism: false,
  },
});
