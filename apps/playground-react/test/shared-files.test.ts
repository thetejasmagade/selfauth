import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The framework-neutral client files are copied per app (application-owned,
 * ADR 0017). Until the generator renders them from one template (Phase 6),
 * this test keeps the React and Vue copies identical; the client's behaviour
 * is unit-tested in apps/playground-vue/test.
 */
const SHARED = ["client.ts", "redirect.ts", "url-token.ts", "messages.ts"];
// Plain paths: Vite rewrites `new URL("…", import.meta.url)` into served asset URLs.
const here = dirname(fileURLToPath(import.meta.url));

describe("shared client files", () => {
  it.each(SHARED)("%s matches the Vue reference copy", async (file) => {
    const react = await readFile(join(here, "../src/auth", file), "utf8");
    const vue = await readFile(join(here, "../../playground-vue/src/auth", file), "utf8");
    expect(react).toBe(vue);
  });
});
