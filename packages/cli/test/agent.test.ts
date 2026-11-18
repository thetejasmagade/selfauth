import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENT_SKILL_DIRS,
  applyPlan,
  findAuthSignals,
  inspect,
  INTEGRATIONS,
  planInit,
  planSkillInstall,
  runValidation,
  skillFiles,
} from "../src/index.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const temp = () => mkdtemp(join(tmpdir(), "selfauth-agent-"));
const cli = (args: string[], cwd?: string) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...(cwd ? { cwd } : {}) });

async function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}
const expressApp = (deps: Record<string, string> = {}, extra: Record<string, string> = {}) =>
  temp().then((d) =>
    write(d, {
      "package.json": JSON.stringify({
        type: "module",
        dependencies: { express: "^5.3.0", ...deps },
        devDependencies: { typescript: "~6.0.3" },
      }),
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" } }',
      ...extra,
    }),
  );
const generated = async (database: "memory" | "postgresql" = "memory") => {
  const dir = await temp();
  await applyPlan(
    dir,
    await planInit({
      name: "demo",
      database,
      frontend: "none",
      permissions: [],
      appBaseUrl: "http://localhost:5173",
    }),
  );
  return dir;
};

describe("selfauth detect", () => {
  it("init for an empty or missing directory", async () => {
    expect((await inspect(await temp())).recommendation).toBe("init");
    expect((await inspect(join(await temp(), "new-app"))).recommendation).toBe("init");
  });

  it("add for an Express project, with every option's blockers", async () => {
    const r = await inspect(await expressApp({ pg: "^8" }));
    expect(r.recommendation).toBe("add");
    expect(r.project.databaseClients).toEqual(["pg"]);
    expect(r.project.esm).toBe(true);
    expect(r.options.map((o) => [o.command, o.available])).toEqual([
      ["selfauth add --database memory", true],
      ["selfauth add --database postgresql", true],
      ["selfauth add --database mysql", true],
      ["selfauth add --database sqlite", true],
    ]);
    expect(r.options[0]!.tsconfigChanges).toEqual({
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
    });
  });

  it("never offers to silently bypass existing auth", async () => {
    const r = await inspect(await expressApp({ passport: "^0.7.0" }));
    expect(r.recommendation).toBe("add");
    for (const o of r.options) {
      expect(o.command).toContain("--allow-existing-auth");
      expect(o.warnings.join(" ")).toMatch(/developer's approval/);
    }
  });

  it("unsupported, with the reason, for other frameworks and languages", async () => {
    const koa = await write(await temp(), {
      "package.json": '{ "dependencies": { "koa": "^2", "mongoose": "^8" } }',
    });
    const r = await inspect(koa);
    expect(r.recommendation).toBe("unsupported");
    expect(r.reason).toContain("koa");
    expect(r.project.databaseClients).toEqual(["mongoose"]);
    expect(r.options).toEqual([]);

    const go = await write(await temp(), { "go.mod": "module x\n" });
    expect(await inspect(go)).toMatchObject({
      recommendation: "unsupported",
      project: { otherLanguages: ["go"] },
    });
  });

  it("unsupported when every add option is blocked (CommonJS, old TypeScript)", async () => {
    const dir = await write(await temp(), {
      "package.json": JSON.stringify({
        dependencies: { express: "^4" },
        devDependencies: { typescript: "~5.4.0" },
      }),
      "tsconfig.json": '{ "compilerOptions": { "module": "commonjs" } }',
    });
    const r = await inspect(dir);
    expect(r.recommendation).toBe("unsupported");
    const blockers = r.options[0]!.blockers.join("\n");
    expect(blockers).toMatch(/"type": "module"/);
    expect(blockers).toMatch(/TypeScript 5.4 is too old/);
    expect(blockers).toMatch(/not an ES module target/);
  });

  it("upgrade when SelfAuth is installed", async () => {
    expect((await inspect(await generated())).recommendation).toBe("upgrade");
  });

  it("prints JSON for agents", async () => {
    const r = cli(["detect", await expressApp(), "--json"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).recommendation).toBe("add");
  });
});

describe("auth signals in application source", () => {
  it("finds hand-written auth with file:line, skipping dependencies, builds and SelfAuth's own files", async () => {
    const dir = await write(await temp(), {
      "src/a.ts": [
        "import bcrypt from 'bcrypt';",
        "const ok = await bcrypt.compare(pw, hash);",
        "app.post('/auth/login', handler);",
        "if (req.session.user) next();",
        "const header = `Bearer ${token}`;",
        "passport.use(new LocalStrategy(verify));",
        "const plain = 1;",
      ].join("\n"),
      "node_modules/x/index.js": "jwt.sign(a, b)",
      "dist/server.js": "jwt.sign(a, b)",
      "src/selfauth/auth/core/crypto.ts": "argon2.hash(x)",
      "src/types.d.ts": "jwt.sign(a, b)",
    });
    const signals = await findAuthSignals(dir);
    expect(signals.map((s) => [s.file, s.line, s.kind])).toEqual([
      ["src/a.ts", 2, "password hashing"],
      ["src/a.ts", 3, "auth route"],
      ["src/a.ts", 4, "server session"],
      ["src/a.ts", 5, "bearer token"],
      ["src/a.ts", 6, "passport strategy"],
    ]);
  });

  it("finds nothing in a project made by `selfauth init`", async () => {
    expect(await findAuthSignals(await generated())).toEqual([]);
  });
});

describe("--json outputs", () => {
  it("list matches the integrations agents may offer", () => {
    const r = cli(["list", "--json"]);
    expect(JSON.parse(r.stdout).integrations).toEqual(INTEGRATIONS);
  });

  it("doctor and validate report machine-readable results and exit codes", async () => {
    const dir = await generated();
    const doctor = cli(["doctor", dir, "--json"]);
    expect(doctor.status).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ ok: true, errors: [] });
    const validate = cli(["validate", dir, "--json"]);
    expect(validate.status).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({ ok: true, problems: [] });

    const none = cli(["validate", await temp(), "--json"]);
    expect(none.status).toBe(1);
    expect(JSON.parse(none.stdout).problems[0]).toMatch(/not a SelfAuth project/);
  });

  it("validate does not pass a PostgreSQL schema it could not check", async () => {
    const r = await runValidation(await generated("postgresql"));
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/database schema was not validated/);
  });
});

describe("selfauth skill install", () => {
  it("writes the skill where each agent discovers it", async () => {
    const dir = await temp();
    const r = cli(["skill", "install", dir, "--agent", "all"]);
    expect(r.status, r.stdout).toBe(0);
    const files = await skillFiles();
    expect(files.has("SKILL.md")).toBe(true);
    for (const target of Object.values(AGENT_SKILL_DIRS))
      for (const [rel, content] of files)
        expect(await readFile(join(dir, target, rel), "utf8"), `${target}/${rel}`).toBe(content);
  });

  it("defaults to Claude Code, and dry runs write nothing", async () => {
    const dir = await temp();
    expect(cli(["skill", "install", dir, "--dry-run"]).stdout).toContain(
      ".claude/skills/selfauth/",
    );
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    cli(["skill", "install", dir]);
    expect(existsSync(join(dir, ".claude", "skills", "selfauth", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents"))).toBe(false);
  });

  it("keeps edited skill files unless --update is passed", async () => {
    const dir = await temp();
    cli(["skill", "install", dir, "--agent", "codex"]);
    const skill = join(dir, AGENT_SKILL_DIRS.codex, "SKILL.md");
    await writeFile(skill, "local notes\n");
    const kept = cli(["skill", "install", dir, "--agent", "codex"]);
    expect(kept.status).toBe(1);
    expect(kept.stdout).toContain("differs; kept");
    expect(await readFile(skill, "utf8")).toBe("local notes\n");

    expect(cli(["skill", "install", dir, "--agent", "codex", "--update"]).status).toBe(0);
    expect(await readFile(skill, "utf8")).toBe((await skillFiles()).get("SKILL.md"));
    const [plan] = await planSkillInstall(dir, ["codex"]);
    expect(plan!.create.length + plan!.update.length).toBe(0);
  });

  it("rejects unknown agents", async () => {
    const r = cli(["skill", "install", await temp(), "--agent", "copilot"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Unknown agent 'copilot'");
  });
});
