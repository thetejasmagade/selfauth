import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/src/generated/**",
      "**/.next/**", // Next.js build output
      "**/next-env.d.ts",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.dialect/**", // test copies made by scripts/dialect-conformance.mjs
      "**/node_modules/**",
      "templates/**", // generated copies of linted reference files (scripts/sync-templates.mjs)
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "warn",
    },
  },
);
