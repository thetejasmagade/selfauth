import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as authModule from "../src/auth/index.ts";
import { buildTestApp } from "./helpers.ts";

/** The API reference (docs/api) must describe exactly what this code does. */
const doc = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../docs/api/${name}`, import.meta.url)), "utf8");

describe("docs/api/http.md", () => {
  it("lists exactly the routes the auth handler serves", async () => {
    const { auth, config } = await buildTestApp();
    const documented = [
      ...doc("http.md").matchAll(/^\| `((?:GET|POST|PUT|PATCH|DELETE) \/[^`]+)` \|/gm),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(auth.routes.length).toBeGreaterThan(10);
    expect([...auth.routes].sort()).toEqual(documented);
    expect(config.http.basePath).toBe("/auth");
  });
});

describe("docs/api/server.md", () => {
  it("documents every export of auth/index.ts and every Auth member", async () => {
    const text = doc("server.md");
    const { auth } = await buildTestApp();
    // `middleware`, `router` and `errorHandler` are the Express adapter's, `install` and
    // `handleError` the Fastify one's; Next.js has `handler`, `route` and `protect` instead.
    const names = [...Object.keys(authModule), ...Object.keys(auth)];
    for (const name of names) expect(text, name).toMatch(new RegExp(`\`${name}[(\`]`));
  });
});
