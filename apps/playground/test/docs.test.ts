import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as authModule from "../src/auth/index.ts";
import { buildTestApp } from "./helpers.ts";

/** The API reference (docs/api) must describe exactly what this code does. */
const doc = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../docs/api/${name}`, import.meta.url)), "utf8");

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe("docs/api/http.md", () => {
  it("lists exactly the routes the auth router registers", async () => {
    const { auth, config } = await buildTestApp();
    const stack = (auth.router as unknown as { stack: Layer[] }).stack;
    const registered = stack
      .filter((l) => l.route)
      .flatMap((l) =>
        Object.keys(l.route!.methods).map(
          (m) => `${m.toUpperCase()} ${config.http.basePath}${l.route!.path}`,
        ),
      )
      .sort();
    const documented = [
      ...doc("http.md").matchAll(/^\| `((?:GET|POST|PUT|PATCH|DELETE) \/[^`]+)` \|/gm),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(registered.length).toBeGreaterThan(10);
    expect(documented).toEqual(registered);
  });
});

describe("docs/api/server.md", () => {
  it("documents every export of auth/index.ts and every Auth member", async () => {
    const text = doc("server.md");
    const { auth } = await buildTestApp();
    const names = [...Object.keys(authModule), ...Object.keys(auth)];
    for (const name of names) expect(text, name).toMatch(new RegExp(`\`${name}[(\`]`));
  });
});
