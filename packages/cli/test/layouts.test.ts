import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addLayoutPath,
  applyPlan,
  applyUpgrade,
  checkTsconfigCoverage,
  detectSourceLayout,
  diagnose,
  findWorkspacePackages,
  inspect,
  normalizeSrcDir,
  planAdd,
  planAddFrontend,
  planUpgrade,
  preflightAdd,
  preflightAddFrontend,
  runValidation,
  selfauthRoot,
  suggestSourceDir,
  type InitAnswers,
} from "../src/index.js";

/**
 * Existing projects come in many shapes: code outside src/, monorepos, a frontend in another
 * folder. These tests pin what `add`, `add-frontend` and `detect` do for each.
 */
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const answers = (database: InitAnswers["database"] = "memory"): InitAnswers => ({
  name: "legacy",
  database,
  frontend: "none",
  permissions: ["reports.view"],
  appBaseUrl: "http://localhost:5173",
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-layout-"));

async function write(dir: string, files: Record<string, string>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const EXPRESS_PKG = JSON.stringify({
  type: "module",
  dependencies: { express: "^5.3.0" },
  devDependencies: { typescript: "~6.0.3" },
});
const APP = 'import express from "express";\nconst app = express();\napp.listen(3000);\n';

describe("source folder", () => {
  it.each([
    ["src", "src"],
    ["./server/", "server"],
    ["backend\\src", "backend/src"],
    [".", "."],
    ["", "."],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeSrcDir(input)).toBe(expected);
  });

  it.each(["../outside", "/etc", "C:\\x", "a/../../b", "node_modules/x", "src/.git"])(
    "rejects %j (it could leave the project)",
    (input) => {
      expect(() => normalizeSrcDir(input)).toThrow(/relative path|node_modules/);
    },
  );

  it("handles a pathological run of slashes quickly", () => {
    const started = performance.now();
    expect(normalizeSrcDir(`server${"/".repeat(200_000)}`)).toBe("server");
    expect(
      checkTsconfigCoverage({ include: [`server${"/".repeat(200_000)}`] }, "server").covered,
    ).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("puts SelfAuth's files in <src>/selfauth", () => {
    expect(selfauthRoot("src")).toBe("src/selfauth");
    expect(selfauthRoot("server")).toBe("server/selfauth");
    expect(selfauthRoot("apps/api/src")).toBe("apps/api/src/selfauth");
    expect(selfauthRoot(".")).toBe("selfauth");
    expect(addLayoutPath("src/auth/index.ts", "server")).toBe("server/selfauth/auth/index.ts");
    expect(addLayoutPath("prisma/schema.prisma", "server")).toBe("prisma/schema.prisma");
  });

  it.each([
    ["src/server.ts", "src"],
    ["src/api/app.ts", "src"],
    ["server/index.ts", "server"],
    ["backend/src/app.ts", "backend/src"],
    ["apps/api/src/main.ts", "apps/api/src"],
    ["app.ts", "."],
    ["lib/http/server.ts", "lib"],
  ])("suggests a source folder from %s", (entry, expected) => {
    expect(suggestSourceDir(entry)).toBe(expected);
  });

  it("finds the Express entry file and prefers the shallowest, conventionally named one", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "server/routes/users.ts": "export const x = 1;\n",
      "server/index.ts": APP,
      "server/test/helper.ts": APP,
      "node_modules/express/index.js": APP,
      "dist/index.js": APP,
    });
    const layout = await detectSourceLayout(dir);
    expect(layout.entryFile).toBe("server/index.ts");
    expect(layout.sourceDir).toBe("server");
    expect(layout.otherEntryFiles).toEqual(["server/test/helper.ts"]);
  });

  it("falls back to src and says so when no entry file is found", async () => {
    const dir = await write(await temp(), { "package.json": EXPRESS_PKG });
    const layout = await detectSourceLayout(dir);
    expect(layout).toMatchObject({ entryFile: null, sourceDir: "src" });
    expect(layout.basis).toMatch(/--src/);
  });
});

describe("tsconfig coverage", () => {
  it.each([
    ["include covers it", { include: ["server"] }, "server", true],
    ["glob include", { include: ["server/**/*.ts"] }, "server", true],
    ["include a parent", { include: ["apps"] }, "apps/api/src", true],
    ["include misses it", { include: ["src"] }, "server", false],
    ["no include at all", {}, "server", true],
    ["files only", { files: ["src/index.ts"] }, "src", false],
    ["excluded", { include: ["**/*"], exclude: ["server"] }, "server", false],
    ["unrelated exclude", { include: ["**/*"], exclude: ["dist", "**/*.test.ts"] }, "server", true],
    ["rootDir too narrow", { compilerOptions: { rootDir: "src" } }, "server", false],
    ["rootDir wide enough", { compilerOptions: { rootDir: "." } }, "server", true],
    ["extends hides it", { extends: "./base.json" }, "server", null],
    ["extends with own include", { extends: "./base.json", include: ["server"] }, "server", true],
  ])("%s", (_name, config, srcDir, covered) => {
    expect(checkTsconfigCoverage(config, srcDir).covered).toBe(covered);
  });

  it("makes `add` stop before writing when the new folder would not be compiled", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" }, "include": ["src"] }',
      "server/app.ts": APP,
    });
    const report = await preflightAdd(dir, { database: "memory", srcDir: "server" });
    expect(report.errors.join(" ")).toMatch(/does not cover server\/selfauth\//);
    expect((await preflightAdd(dir, { database: "memory", srcDir: "src" })).errors).toEqual([]);
  });

  it("rejects a source folder that escapes the project", async () => {
    const dir = await write(await temp(), { "package.json": EXPRESS_PKG, "tsconfig.json": "{}" });
    const report = await preflightAdd(dir, { database: "memory", srcDir: "../elsewhere" });
    expect(report.errors.join(" ")).toMatch(/relative path inside the project/);
  });
});

describe("selfauth add in another layout", () => {
  const layouts = ["server", "backend/src", "apps/api/src", "."] as const;

  it.each(layouts)("writes everything under %s/selfauth and nowhere else", async (srcDir) => {
    const files = await planAdd(answers(), undefined, { srcDir });
    const root = selfauthRoot(srcDir);
    for (const f of files) {
      expect(
        f.path.startsWith(`${root}/`) || f.path === "selfauth.manifest.json",
        `${f.path} is outside ${root}/`,
      ).toBe(true);
    }
    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.options).toMatchObject({ layout: "add", srcDir: srcDir });
  });

  it.each(layouts)("every relative import in %s/selfauth resolves inside it", async (srcDir) => {
    const files = await planAdd(answers("postgresql"), undefined, { srcDir });
    const planned = new Set(files.map((f) => f.path));
    const root = selfauthRoot(srcDir);
    let checked = 0;
    for (const f of files.filter((f) => f.path.startsWith(`${root}/`) && /\.ts$/.test(f.path))) {
      for (const m of f.content.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        const target = posix.normalize(posix.join(posix.dirname(f.path), m[1]!));
        checked++;
        // Generated Prisma client is produced by `prisma generate`, not by the plan.
        if (target.includes("/generated/")) continue;
        expect(planned.has(target), `${f.path} imports ${m[1]} → ${target}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("points Prisma's client output at the moved folder", async () => {
    const schema = (srcDir: string) =>
      planAdd(answers("postgresql"), undefined, { srcDir }).then(
        (files) => files.find((f) => f.path === "prisma/schema.prisma")!.content,
      );
    expect(await schema("server")).toContain(
      'output              = "../server/selfauth/generated/prisma"',
    );
    expect(await schema("backend/src")).toContain("../backend/src/selfauth/generated/prisma");
    expect(await schema(".")).toContain('"../selfauth/generated/prisma"');
  });

  it("round-trips: doctor, validate, upgrade and drift all follow the folder", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" } }',
      ".gitignore": "node_modules\n.env\n",
      "server/app.ts": APP,
    });
    await applyPlan(dir, await planAdd(answers(), undefined, { srcDir: "server" }));
    expect(existsSync(join(dir, "server/selfauth/auth/index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src"))).toBe(false);

    expect((await runValidation(dir)).ok).toBe(true);
    const report = await diagnose(dir);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(" ")).toMatch(/server\/selfauth\/email\/mailer\.ts/);

    const plan = await planUpgrade(dir);
    expect(plan.items.every((i) => i.status === "unchanged")).toBe(true);
    await applyUpgrade(dir, plan);

    await writeFile(join(dir, "server/selfauth/email/mailer.ts"), "// mine\n");
    expect((await runValidation(dir)).notes.join(" ")).toContain("server/selfauth/email/mailer.ts");
  });

  it("is detected from the Express entry file and offered with --src", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" }, "include": ["server"] }',
      "server/index.ts": APP,
    });
    const report = await inspect(dir);
    expect(report.recommendation).toBe("add");
    expect(report.layout).toMatchObject({ entryFile: "server/index.ts", sourceDir: "server" });
    expect(report.options[0]!.command).toContain("--src server");
    expect(report.reason).toContain("server/selfauth/");
  });
});

describe("monorepos", () => {
  async function monorepo(kind: "pnpm" | "npm"): Promise<string> {
    return write(await temp(), {
      "package.json": JSON.stringify(
        kind === "npm"
          ? { private: true, workspaces: ["apps/*", "packages/**"] }
          : { private: true },
      ),
      ...(kind === "pnpm"
        ? { "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - packages/**\n' }
        : {}),
      "apps/api/package.json": EXPRESS_PKG,
      "apps/api/src/server.ts": APP,
      "apps/web/package.json": JSON.stringify({ name: "web", dependencies: { vue: "^3.5.0" } }),
      "packages/ui/lib/package.json": JSON.stringify({ name: "ui", dependencies: {} }),
    });
  }

  it.each(["pnpm", "npm"] as const)(
    "lists backend and frontend packages (%s workspaces)",
    async (kind) => {
      const packages = await findWorkspacePackages(await monorepo(kind));
      expect(packages).toEqual([
        { dir: "apps/api", name: null, role: "backend", framework: "express" },
        { dir: "apps/web", name: "web", role: "frontend", framework: "vue" },
        { dir: "packages/ui/lib", name: "ui", role: "other", framework: null },
      ]);
    },
  );

  it("tells the developer which command to run in which package", async () => {
    const report = await inspect(await monorepo("pnpm"));
    expect(report.recommendation).toBe("workspace");
    expect(report.options.map((o) => o.command)).toEqual([
      "selfauth add apps/api",
      "selfauth add-frontend apps/web",
    ]);
  });

  it("adds to one package without touching the others", async () => {
    const root = await monorepo("pnpm");
    const api = join(root, "apps/api");
    await writeFile(join(api, "tsconfig.json"), '{ "compilerOptions": { "module": "NodeNext" } }');
    const layout = await detectSourceLayout(api);
    expect(layout.sourceDir).toBe("src");
    await applyPlan(api, await planAdd(answers(), undefined, { srcDir: layout.sourceDir }));
    expect(existsSync(join(api, "src/selfauth/setup.ts"))).toBe(true);
    expect(existsSync(join(root, "apps/web/src"))).toBe(false);
    expect(existsSync(join(root, "selfauth.manifest.json"))).toBe(false);
  });
});

describe("selfauth add-frontend", () => {
  const WEB_VUE = JSON.stringify({
    dependencies: { vue: "^3.5.0", "vue-router": "^4.5.0" },
    devDependencies: { vite: "^7.0.0", typescript: "~6.0.3" },
  });
  const WEB_REACT = JSON.stringify({
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", "react-router": "^7.0.0" },
  });

  async function frontendProject(pkg: string, tsconfig = "{}"): Promise<string> {
    return write(await temp(), {
      "package.json": pkg,
      "tsconfig.json": tsconfig,
      "src/main.ts": "",
    });
  }

  it.each([
    ["vue", WEB_VUE],
    ["react", WEB_REACT],
  ] as const)(
    "detects %s and plans only the auth module and a manifest",
    async (framework, pkg) => {
      const dir = await frontendProject(pkg);
      const check = await preflightAddFrontend(dir);
      expect(check).toMatchObject({ frontend: framework, errors: [] });
      const files = await planAddFrontend({ frontend: framework });
      expect(files.length).toBeGreaterThan(6);
      for (const f of files)
        expect(
          f.path.startsWith("src/selfauth/") || f.path === "selfauth.manifest.json",
          f.path,
        ).toBe(true);
      const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
      expect(manifest.options).toMatchObject({ layout: "frontend", frontend: framework });
    },
  );

  it.each(["vue", "react"] as const)(
    "the %s module imports only its own files and the framework packages",
    async (framework) => {
      const files = await planAddFrontend({ frontend: framework, srcDir: "app/web" });
      const planned = new Set(files.map((f) => f.path));
      const allowed = framework === "vue" ? ["vue", "vue-router"] : ["react", "react-router"];
      const builtins = new Set(builtinModules);
      let imports = 0;
      for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f.path))) {
        for (const m of f.content.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
          const spec = m[1]!;
          imports++;
          if (spec.startsWith(".")) {
            const target = posix.normalize(posix.join(dirname(f.path), spec));
            expect(planned.has(target), `${f.path} → ${spec}`).toBe(true);
          } else if (!spec.startsWith("node:") && !builtins.has(spec)) {
            expect(allowed, `${f.path} imports ${spec}`).toContain(spec);
          }
        }
      }
      expect(imports).toBeGreaterThan(10);
    },
  );

  it("lists packages the module needs and the tsconfig change for type checking", async () => {
    const dir = await frontendProject(JSON.stringify({ dependencies: { vue: "^3.5.0" } }));
    const check = await preflightAddFrontend(dir);
    expect(check.missingPackages).toEqual(["vue-router"]);
    expect(check.tsconfigChanges).toEqual({ allowImportingTsExtensions: true });
  });

  it.each([
    [
      "no framework",
      JSON.stringify({ dependencies: { svelte: "^5" } }),
      undefined,
      /no Vue or React/,
    ],
    [
      "both frameworks",
      JSON.stringify({ dependencies: { vue: "^3", react: "^19" } }),
      undefined,
      /pass --frontend/,
    ],
    ["wrong --frontend", WEB_VUE, "react", /"react" is not a dependency/],
    ["unsupported --frontend", WEB_VUE, "svelte", /only vue and react/],
  ])("refuses: %s", async (_name, pkg, flag, message) => {
    const check = await preflightAddFrontend(await frontendProject(pkg), { frontend: flag });
    expect(check.errors.join(" ")).toMatch(message);
  });

  it("refuses a folder with no package.json and one that already has SelfAuth", async () => {
    expect((await preflightAddFrontend(await temp())).errors.join(" ")).toMatch(/no package.json/);
    const dir = await frontendProject(WEB_VUE);
    await applyPlan(dir, await planAddFrontend({ frontend: "vue" }));
    expect((await preflightAddFrontend(dir)).errors.join(" ")).toMatch(/already installed/);
  });

  it("is checked, diffed and upgraded like a backend: only its own files", async () => {
    const dir = await frontendProject(WEB_VUE);
    await applyPlan(dir, await planAddFrontend({ frontend: "vue" }));
    expect(await runValidation(dir)).toMatchObject({ ok: true, problems: [] });
    expect((await diagnose(dir)).errors).toEqual([]);
    expect((await planUpgrade(dir)).items.every((i) => i.status === "unchanged")).toBe(true);

    await writeFile(join(dir, "src/selfauth/redirect.ts"), "// mine\n");
    const validation = await runValidation(dir);
    expect(validation.ok).toBe(true);
    expect(validation.notes.join(" ")).toContain("src/selfauth/redirect.ts");
  });

  it("never touches the application's own files", async () => {
    const dir = await frontendProject(WEB_VUE);
    await write(dir, { "src/App.vue": "<template>mine</template>" });
    await applyPlan(dir, await planAddFrontend({ frontend: "vue" }));
    expect(await readFile(join(dir, "src/App.vue"), "utf8")).toBe("<template>mine</template>");
    expect(await readFile(join(dir, "src/main.ts"), "utf8")).toBe("");
  });

  it("is recognised by detect, and a frontend and backend are told apart", async () => {
    const web = await inspect(await frontendProject(WEB_VUE));
    expect(web.recommendation).toBe("add-frontend");
    expect(web.frontend).toMatchObject({ framework: "vue" });
    expect(web.frontend!.options[0]!.command).toBe("selfauth add-frontend --frontend vue");

    const unsupported = await inspect(
      await frontendProject(JSON.stringify({ dependencies: { svelte: "^5" } })),
    );
    expect(unsupported.recommendation).toBe("unsupported");
  });
});

describe("command line", () => {
  const run = async (args: string[], cwd: string) => {
    const { execFile } = await import("node:child_process");
    return new Promise<{ code: number; out: string }>((done) =>
      execFile(process.execPath, [BIN, ...args], { cwd }, (error, stdout, stderr) =>
        done({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
      ),
    );
  };

  it("add --src writes under the chosen folder and prints matching steps", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" } }',
      "api/server.ts": APP,
    });
    const r = await run(["add", "--src", "api", "--yes"], dir);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Source folder: api (from --src)");
    expect(r.out).toContain("Created ");
    expect(r.out).toContain('from "./selfauth/setup.ts"');
    expect(existsSync(join(dir, "api/selfauth/setup.ts"))).toBe(true);
    expect(existsSync(join(dir, "src"))).toBe(false);
  });

  it("add finds the folder by itself and refuses when it is not compiled", async () => {
    const dir = await write(await temp(), {
      "package.json": EXPRESS_PKG,
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" }, "include": ["src"] }',
      "server/index.ts": APP,
    });
    const r = await run(["add", "--yes"], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Source folder: server (Express app created in server/index.ts)");
    expect(r.out).toContain('add "server"');
    expect(r.out).toContain("Nothing was written.");
    expect(existsSync(join(dir, "server/selfauth"))).toBe(false);
  });

  it("add-frontend --dry-run writes nothing; --yes writes the module", async () => {
    const dir = await write(await temp(), {
      "package.json": JSON.stringify({
        dependencies: { react: "^19", "react-router": "^7" },
      }),
      "src/main.tsx": "",
    });
    const dry = await run(["add-frontend", "--dry-run"], dir);
    expect(dry.code, dry.out).toBe(0);
    expect(existsSync(join(dir, "src/selfauth"))).toBe(false);
    const real = await run(["add-frontend", "--yes"], dir);
    expect(real.code, real.out).toBe(0);
    expect(real.out).toContain("<AuthProvider store={store}>");
    expect(existsSync(join(dir, "src/selfauth/react.tsx"))).toBe(true);
    const again = await run(["add-frontend", "--yes"], dir);
    expect(again.code).toBe(1);
    expect(again.out).toMatch(/already installed/);
  });
});
