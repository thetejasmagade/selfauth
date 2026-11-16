import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  applyUpgrade,
  fileDrift,
  loadManifest,
  planInit,
  planUpgrade,
  PROPOSAL_SUFFIX,
  sha256,
  templateSource,
  type InitAnswers,
} from "../src/index.js";
import type { TemplateSource } from "../src/templates.js";

const answers: InitAnswers = {
  name: "demo",
  database: "memory",
  frontend: "none",
  permissions: [],
  appBaseUrl: "http://localhost:5173",
};

/** A "newer release" of the templates: selected sources get new content. */
function newerTemplates(changes: Record<string, (old: string) => string>): TemplateSource {
  const base = templateSource();
  return {
    ...base,
    async read(source) {
      const content = await base.read(source);
      return changes[source] ? changes[source](content) : content;
    },
  };
}

const EMAIL = "apps/playground/src/auth/core/email.ts";
const CRYPTO = "apps/playground/src/auth/core/crypto.ts";
const CLOCK = "apps/playground/src/auth/core/clock.ts";

async function project() {
  const dir = await mkdtemp(join(tmpdir(), "selfauth-upgrade-"));
  await applyPlan(dir, await planInit(answers));
  return dir;
}

describe("planUpgrade / applyUpgrade (ADR 0004)", () => {
  it("reports nothing to do when templates are unchanged", async () => {
    const plan = await planUpgrade(await project());
    expect(plan.items.every((i) => i.status === "unchanged")).toBe(true);
  });

  it("updates untouched files, keeps your edits, and proposes merges for conflicts", async () => {
    const dir = await project();
    // You edit two files.
    await writeFile(
      join(dir, "src/auth/core/crypto.ts"),
      `${await readFile(join(dir, "src/auth/core/crypto.ts"), "utf8")}// mine\n`,
    );
    await writeFile(
      join(dir, "src/auth/core/clock.ts"),
      `// my clock tweak\n${await readFile(join(dir, "src/auth/core/clock.ts"), "utf8")}`,
    );
    // A new release changes email.ts (untouched by you) and crypto.ts (edited by you).
    const source = newerTemplates({
      [EMAIL]: (old) => `${old}// upstream fix\n`,
      [CRYPTO]: (old) => `// upstream security fix\n${old}`,
    });

    const plan = await planUpgrade(dir, source);
    const status = Object.fromEntries(
      plan.items.filter((i) => i.status !== "unchanged").map((i) => [i.path, i.status]),
    );
    expect(status).toEqual({
      "src/auth/core/email.ts": "update",
      "src/auth/core/crypto.ts": "conflict",
      "src/auth/core/clock.ts": "kept",
    });
    expect(plan.items.find((i) => i.path === "src/auth/core/crypto.ts")!.diff).toContain(
      "+// upstream security fix",
    );

    const result = await applyUpgrade(dir, plan);
    expect(result.written).toEqual(["src/auth/core/email.ts"]);
    expect(result.proposals).toEqual([`src/auth/core/crypto.ts${PROPOSAL_SUFFIX}`]);

    // The safe update landed; your edits are untouched; the proposal holds the new template.
    expect(await readFile(join(dir, "src/auth/core/email.ts"), "utf8")).toMatch(
      /\/\/ upstream fix\n$/,
    );
    expect(await readFile(join(dir, "src/auth/core/crypto.ts"), "utf8")).toMatch(/\/\/ mine\n$/);
    expect(await readFile(join(dir, "src/auth/core/clock.ts"), "utf8")).toMatch(
      /^\/\/ my clock tweak/,
    );
    expect(await readFile(join(dir, `src/auth/core/crypto.ts${PROPOSAL_SUFFIX}`), "utf8")).toMatch(
      /^\/\/ upstream security fix/,
    );

    // The manifest now treats the updated file as pristine and your files as yours.
    const drift = await fileDrift(dir, (await loadManifest(dir))!);
    expect(drift.modified.sort()).toEqual(["src/auth/core/clock.ts", "src/auth/core/crypto.ts"]);

    // Running again changes nothing and does not clobber the proposal.
    const again = await applyUpgrade(dir, await planUpgrade(dir, source));
    expect(again.written).toEqual([]);
    expect(again.skipped).toEqual([`src/auth/core/crypto.ts${PROPOSAL_SUFFIX}`]);
  });

  it("adds new template files, respects deletions, and refuses to take over foreign files", async () => {
    const dir = await project();
    const manifestPath = join(dir, "selfauth.manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    // Simulate a template file that is new in this release: not on disk, not in the manifest.
    manifest.files = manifest.files.filter(
      (f: { path: string }) =>
        f.path !== "src/auth/core/email.ts" && f.path !== "src/dev-config.ts",
    );
    await writeFile(manifestPath, JSON.stringify(manifest));
    await rm(join(dir, "src/auth/core/email.ts"));
    // dev-config.ts exists but the manifest does not claim it: ownership is ambiguous.
    await writeFile(join(dir, "src/dev-config.ts"), "// someone else's file\n");
    // You deleted a generated file on purpose.
    await rm(join(dir, "src/routes.ts"));

    const plan = await planUpgrade(dir);
    const status = Object.fromEntries(
      plan.items.filter((i) => i.status !== "unchanged").map((i) => [i.path, i.status]),
    );
    expect(status).toEqual({
      "src/auth/core/email.ts": "add",
      "src/dev-config.ts": "conflict",
      "src/routes.ts": "deleted",
    });
    await applyUpgrade(dir, plan);
    expect(existsSync(join(dir, "src/auth/core/email.ts"))).toBe(true);
    expect(existsSync(join(dir, "src/routes.ts"))).toBe(false);
    expect(await readFile(join(dir, "src/dev-config.ts"), "utf8")).toBe("// someone else's file\n");
  });

  it("never overwrites a file edited after the plan was made", async () => {
    const dir = await project();
    const plan = await planUpgrade(dir, newerTemplates({ [EMAIL]: (old) => `${old}// v2\n` }));
    await writeFile(join(dir, "src/auth/core/email.ts"), "// edited just now\n");
    const result = await applyUpgrade(dir, plan);
    expect(result.skipped).toEqual(["src/auth/core/email.ts"]);
    expect(await readFile(join(dir, "src/auth/core/email.ts"), "utf8")).toBe(
      "// edited just now\n",
    );
  });

  it("records the new template version and hashes", async () => {
    const dir = await project();
    const source = newerTemplates({ [CLOCK]: (old) => `${old}// v2\n` });
    await applyUpgrade(dir, await planUpgrade(dir, source));
    const manifest = (await loadManifest(dir))!;
    const entry = manifest.files!.find((f) => f.path === "src/auth/core/clock.ts")!;
    expect(entry.sha256).toBe(sha256(await readFile(join(dir, "src/auth/core/clock.ts"), "utf8")));
  });
});
