import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  applyReorganize,
  diagnose,
  planAdd,
  planInit,
  planMoves,
  planReorganize,
  planUpgrade,
  runValidation,
  type InitAnswers,
} from "../src/index.js";
import { FLAT_LAYOUT } from "../src/project.js";
import { addLayoutPath } from "../src/plan.js";

/**
 * Projects made with SelfAuth ≤ 0.3 keep their app files side by side in src/. `upgrade
 * --reorganize` moves them into the grouped layout. The strongest test: take a project in the
 * grouped layout, turn it into the old flat one with the same move-and-rewrite machinery, and
 * require `--reorganize` to give back exactly what we started with.
 */
const base = { name: "demo", permissions: ["orders.view"], appBaseUrl: "http://localhost:5173" };
const temp = () => mkdtemp(join(tmpdir(), "selfauth-reorg-"));

async function tree(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await tree(dir, path));
    else out[path] = await readFile(join(dir, path), "utf8");
  }
  return out;
}

/** Writes a project, then reverses the layout: the way a SelfAuth 0.3 project looked. */
async function flatProject(
  answers: InitAnswers,
  options: { add?: boolean; srcDir?: string } = {},
): Promise<{ dir: string; grouped: Record<string, string> }> {
  const dir = await temp();
  const srcDir = options.srcDir ?? "src";
  await applyPlan(
    dir,
    options.add ? await planAdd(answers, undefined, { srcDir }) : await planInit(answers),
  );
  const grouped = await tree(dir);
  const rebase = (t: string) => (options.add ? addLayoutPath(t, srcDir) : t);
  const mapping = Object.fromEntries(
    Object.entries(FLAT_LAYOUT).map(([grouped, flat]) => [rebase(grouped), rebase(flat)]),
  );
  const plan = await planMoves(dir, mapping, [options.add ? srcDir : "src", "test"]);
  const { rename, rmdir, mkdir, writeFile: write } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  for (const m of plan.moves) {
    await mkdir(dirname(join(dir, m.to)), { recursive: true });
    await rename(join(dir, m.from), join(dir, m.to));
    await rmdir(dirname(join(dir, m.from))).catch(() => undefined);
  }
  for (const [to, c] of plan.contents)
    if (c.before !== c.after) await write(join(dir, to), c.after);
  // The manifest as 0.3 wrote it: old paths, no `structure`.
  const manifest = JSON.parse(await readFile(join(dir, "selfauth.manifest.json"), "utf8"));
  delete manifest.options.structure;
  const moved = Object.fromEntries(plan.moves.map((m) => [m.from, m.to]));
  const { sha256 } = await import("../src/index.js");
  for (const f of manifest.files) {
    f.path = moved[f.path] ?? f.path;
    f.sha256 = sha256(await readFile(join(dir, f.path), "utf8")); // the flat project's own content
  }
  await write(join(dir, "selfauth.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, grouped };
}

describe("selfauth upgrade --reorganize", () => {
  it.each([
    ["memory, API only", { ...base, database: "memory", frontend: "none" }],
    ["postgresql, API only", { ...base, database: "postgresql", frontend: "none" }],
    ["memory, Vue (notes example)", { ...base, database: "memory", frontend: "vue" }],
  ] as const)("restores exactly the grouped layout (%s)", async (_name, answers) => {
    const { dir, grouped } = await flatProject(answers as InitAnswers);
    expect(existsSync(join(dir, "src/env.ts"))).toBe(true);
    expect(existsSync(join(dir, "src/config"))).toBe(false);

    await applyReorganize(dir, await planReorganize(dir));

    const after = await tree(dir);
    // Every file is where a fresh project has it, byte for byte, except the manifest (whose
    // hashes are recomputed) which must still describe exactly the same files.
    const strip = ({ ["selfauth.manifest.json"]: _m, ...rest }: Record<string, string>) => rest;
    expect(strip(after)).toEqual(strip(grouped));
    const manifest = JSON.parse(after["selfauth.manifest.json"]!);
    expect(manifest.options.structure).toBe(2);
    expect(manifest.files.map((f: { path: string }) => f.path).sort()).toEqual(
      JSON.parse(grouped["selfauth.manifest.json"]!)
        .files.map((f: { path: string }) => f.path)
        .sort(),
    );
    expect(existsSync(join(dir, "src/example"))).toBe(false);
  });

  it("leaves a project that validates, with nothing for upgrade to change", async () => {
    const { dir } = await flatProject({ ...base, database: "memory", frontend: "none" });
    await applyReorganize(dir, await planReorganize(dir));
    expect(await runValidation(dir)).toMatchObject({ ok: true, problems: [] });
    expect((await diagnose(dir)).errors).toEqual([]);
    expect((await planUpgrade(dir)).items.every((i) => i.status === "unchanged")).toBe(true);
  });

  it("works for `selfauth add` projects, in any source folder", async () => {
    for (const srcDir of ["src", "server", "apps/api/src"]) {
      const { dir, grouped } = await flatProject(
        { ...base, database: "memory", frontend: "none" },
        { add: true, srcDir },
      );
      await applyReorganize(dir, await planReorganize(dir));
      const after = await tree(dir);
      const strip = ({ ["selfauth.manifest.json"]: _m, ...rest }: Record<string, string>) => rest;
      expect(strip(after), srcDir).toEqual(strip(grouped));
      expect(existsSync(join(dir, posix.join(srcDir, "selfauth/config/env.ts")))).toBe(true);
    }
  });

  it("rewrites the application's own imports of moved files, and only the paths", async () => {
    const { dir } = await flatProject(
      { ...base, database: "memory", frontend: "none" },
      { add: true, srcDir: "server" },
    );
    await writeFile(
      join(dir, "server/app.ts"),
      'import { setupSelfAuth } from "./selfauth/setup.ts";\nimport { config } from "./selfauth/selfauth.config.ts";\nconsole.log(config, setupSelfAuth);\n',
    );
    await applyReorganize(dir, await planReorganize(dir));
    expect(await readFile(join(dir, "server/app.ts"), "utf8")).toBe(
      'import { setupSelfAuth } from "./selfauth/setup.ts";\nimport { config } from "./selfauth/config/selfauth.config.ts";\nconsole.log(config, setupSelfAuth);\n',
    );
  });

  it("keeps a file you edited as yours: still reported as changed, never as unedited", async () => {
    const { dir } = await flatProject({ ...base, database: "memory", frontend: "none" });
    await writeFile(
      join(dir, "src/mailer.ts"),
      '// my provider\nimport type { Mailer } from "./auth/index.ts";\nexport const x: Mailer | null = null;\n',
    );
    await applyReorganize(dir, await planReorganize(dir));
    const mailer = await readFile(join(dir, "src/email/mailer.ts"), "utf8");
    expect(mailer).toContain("// my provider");
    expect(mailer).toContain('"../auth/index.ts"');
    expect((await runValidation(dir)).notes.join(" ")).toContain("src/email/mailer.ts");
  });

  it("refuses without touching anything when a target already exists", async () => {
    const { dir } = await flatProject({ ...base, database: "memory", frontend: "none" });
    await writeFile(join(dir, "src/routes.ts"), "// keep\n");
    await mkdirp(join(dir, "src/routes"));
    await writeFile(join(dir, "src/routes/index.ts"), "// already here\n");
    const plan = await planReorganize(dir);
    expect(plan.problems.join(" ")).toContain("src/routes/index.ts already exists");
    await expect(applyReorganize(dir, plan)).rejects.toThrow(/already exists/);
    expect(existsSync(join(dir, "src/env.ts"))).toBe(true);
  });

  it("refuses a project that is already grouped", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit({ ...base, database: "memory", frontend: "none" }));
    await expect(planReorganize(dir)).rejects.toThrow(/already uses the grouped layout/);
  });

  it("is what `upgrade` tells you to run on an old project", async () => {
    const { dir } = await flatProject({ ...base, database: "memory", frontend: "none" });
    await expect(planUpgrade(dir)).rejects.toThrow(/upgrade --reorganize/);
    // doctor and validate keep working on the old layout
    expect((await diagnose(dir)).errors).toEqual([]);
    expect((await runValidation(dir)).ok).toBe(true);
  });
});

async function mkdirp(path: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
}
