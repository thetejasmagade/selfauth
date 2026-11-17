import { builtinModules } from "node:module";
import { describe, expect, it } from "vitest";
import { planAdd, planInit, type PlannedFile } from "../src/index.js";
import { stackDependencies } from "../src/templates.js";

/**
 * Plan §8: "Ensure no mandatory SelfAuth runtime service exists." Every project the CLI
 * (and therefore templates/) produces must run on ordinary npm packages alone: no
 * @selfauth/* dependency, no import of anything undeclared, no network endpoint but the
 * developer's own.
 */
const base = { name: "demo", permissions: ["orders.view"], appBaseUrl: "http://localhost:5173" };
const variants: [string, () => Promise<PlannedFile[]>][] = [
  ...(["memory", "postgresql"] as const).flatMap((database) =>
    (["none", "vue", "react"] as const).map(
      (frontend) =>
        [`init ${database}/${frontend}`, () => planInit({ ...base, database, frontend })] as [
          string,
          () => Promise<PlannedFile[]>,
        ],
    ),
  ),
  ...(["memory", "postgresql"] as const).map(
    (database) =>
      [`add ${database}`, () => planAdd({ ...base, database, frontend: "none" })] as [
        string,
        () => Promise<PlannedFile[]>,
      ],
  ),
];

const SOURCE = /\.(ts|tsx|vue|mjs|js)$/;
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const packageName = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
const builtins = new Set(builtinModules);

describe.each(variants)("%s runs without SelfAuth", (_name, plan) => {
  it("depends on no @selfauth package and imports only declared dependencies", async () => {
    const files = await plan();
    const manifests = files.filter((f) => f.path.endsWith("package.json"));
    for (const m of manifests) {
      const pkg = JSON.parse(m.content) as Record<string, Record<string, string> | undefined>;
      const deps = Object.keys({ ...pkg["dependencies"], ...pkg["devDependencies"] });
      expect(
        deps.filter((d) => d.startsWith("@selfauth/") || d === "selfauth"),
        m.path,
      ).toEqual([]);
    }
    // add: the package.json is the developer's; imports must be what `add` installs.
    const addDeps = (database: "memory" | "postgresql") => {
      const d = stackDependencies(database);
      return new Set([...d.dependencies, ...d.devDependencies]);
    };
    const isAdd = !manifests.length;
    const usesPrisma = files.some((f) => f.path.startsWith("prisma/"));

    const declared = (path: string) => {
      if (isAdd) return addDeps(usesPrisma ? "postgresql" : "memory");
      const owner = path.startsWith("web/") ? "web/package.json" : "package.json";
      const pkg = JSON.parse(files.find((f) => f.path === owner)!.content) as Record<
        string,
        Record<string, string> | undefined
      >;
      return new Set(Object.keys({ ...pkg["dependencies"], ...pkg["devDependencies"] }));
    };
    let imports = 0;
    for (const f of files.filter((f) => SOURCE.test(f.path))) {
      for (const m of f.content.matchAll(IMPORT)) {
        const spec = (m[1] ?? m[2] ?? m[3])!;
        if (spec.startsWith(".") || spec.startsWith("node:") || builtins.has(spec)) continue;
        imports++;
        expect(declared(f.path).has(packageName(spec)), `${f.path} imports ${spec}`).toBe(true);
      }
    }
    expect(imports).toBeGreaterThan(3);
  });

  it("contacts no host except the developer's own", async () => {
    for (const f of (await plan()).filter((f) => SOURCE.test(f.path) || f.path.endsWith(".json"))) {
      for (const [url, host] of f.content.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        // localhost for development, reserved TLDs (.invalid/.test/.example) for placeholders.
        expect(
          /^(localhost|127\.0\.0\.1)$|\.(invalid|test|example)$/.test(host!),
          `${f.path}: ${url}`,
        ).toBe(true);
      }
    }
  });
});

describe.each(variants)(
  "%s keeps secrets out of the repository (SEC-SECRET-002)",
  (_name, plan) => {
    it("ships placeholders only in .env.example and git-ignores .env", async () => {
      const files = await plan();
      const example = files.find((f) => f.path === ".env.example");
      const gitignore = files.find((f) => f.path === ".gitignore");
      if (!example) return; // `add` writes under src/selfauth/ and leaves .env handling to the project
      for (const line of example.content.split("\n")) {
        if (!line.trim() || line.startsWith("#")) continue;
        const [key, ...rest] = line.split("=");
        const value = rest.join("=");
        if (/SECRET|KEY|TOKEN|PASSWORD/i.test(key!)) {
          expect(["", "change-me"], `${key} must be empty or a placeholder`).toContain(value);
        }
        // Connection strings may carry credentials only for a local development database.
        for (const [, host] of value.matchAll(/:\/\/[^@/]*@([^:/]+)/g)) {
          expect(["localhost", "127.0.0.1"], `${key} credentials for ${host}`).toContain(host);
        }
      }
      const ignored = gitignore!.content.split("\n");
      expect(ignored).toContain(".env");
      expect(ignored).toContain("!.env.example");
    });
  },
);
