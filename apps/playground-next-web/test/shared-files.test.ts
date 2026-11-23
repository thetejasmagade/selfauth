import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The framework-neutral client files are copied per app (application-owned, ADR 0017). This test
 * keeps the Next.js copies identical to the React and Vue ones, and keeps the app free of a
 * `pages/` folder, which Next.js would treat as the Pages Router.
 */
const SHARED = ["client.ts", "redirect.ts", "url-token.ts", "messages.ts", "types.ts"];
// Plain paths: no `new URL(…, import.meta.url)`, which bundlers rewrite.
const here = dirname(fileURLToPath(import.meta.url));

describe("shared client files", () => {
  it.each(SHARED)("%s matches the React reference copy", async (file) => {
    const next = await readFile(join(here, "../src/auth-client", file), "utf8");
    const react = await readFile(join(here, "../../playground-react/src/auth", file), "utf8");
    expect(next).toBe(react);
  });
});

describe("folder layout", () => {
  it("has no src/pages folder (Next.js would serve it as the Pages Router)", async () => {
    expect(await readdir(join(here, "../src"))).not.toContain("pages");
  });
});
