import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPlan, diagnose, planInit, runValidation, type InitAnswers } from "../src/index.js";

/**
 * A full-stack project has one file to edit for settings both sides need: selfauth.config.json
 * in the project root. `npm run sync` copies it into server/ and client/, and `doctor` says
 * when a copy is stale.
 */
const answers: InitAnswers = {
  name: "demo",
  database: "memory",
  frontend: "vue",
  permissions: [],
  appBaseUrl: "http://localhost:5173",
};

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "selfauth-shared-"));
  await applyPlan(dir, await planInit(answers));
  return dir;
}
const sync = (dir: string) => execFileSync("node", ["scripts/sync-config.mjs"], { cwd: dir });
const read = (dir: string, path: string) => readFile(join(dir, path), "utf8");
const COPIES = ["server/src/config/selfauth.config.json", "client/src/selfauth.config.json"];

describe("shared selfauth.config.json", () => {
  it("copies the root file into both packages", async () => {
    const dir = await project();
    const edited = (await read(dir, "selfauth.config.json")).replace(
      '"minLength": 8',
      '"minLength": 10',
    );
    await writeFile(join(dir, "selfauth.config.json"), edited);
    sync(dir);
    for (const copy of COPIES) expect(await read(dir, copy)).toBe(edited);
  });

  it("refuses limits that are not whole numbers", async () => {
    const dir = await project();
    await writeFile(
      join(dir, "selfauth.config.json"),
      JSON.stringify({ password: { minLength: "ten", maxLength: 128 } }),
    );
    expect(() =>
      execFileSync("node", ["scripts/sync-config.mjs"], { cwd: dir, stdio: "pipe" }),
    ).toThrow(/minLength must be a whole number/);
  });

  it("does nothing when there is no root file (projects made before it existed)", async () => {
    const dir = await project();
    const before = await read(dir, COPIES[1]!);
    await import("node:fs/promises").then((fs) => fs.rm(join(dir, "selfauth.config.json")));
    sync(dir);
    expect(await read(dir, COPIES[1]!)).toBe(before);
  });

  it("is warned about by doctor while a copy is stale, and not after sync", async () => {
    const dir = await project();
    const clean = await diagnose(join(dir, "server"));
    expect(clean.warnings.join("\n")).not.toContain("npm run sync");

    const edited = (await read(dir, "selfauth.config.json")).replace(
      '"minLength": 8',
      '"minLength": 9',
    );
    await writeFile(join(dir, "selfauth.config.json"), edited);
    for (const pkg of ["server", "client"]) {
      expect((await diagnose(join(dir, pkg))).warnings.join("\n")).toContain("npm run sync");
    }
    sync(dir);
    for (const pkg of ["server", "client"]) {
      expect((await diagnose(join(dir, pkg))).warnings.join("\n")).not.toContain("npm run sync");
    }
  });

  it("does not count a refreshed copy as a generated file you changed", async () => {
    const dir = await project();
    const edited = (await read(dir, "selfauth.config.json")).replace(
      '"minLength": 8',
      '"minLength": 11',
    );
    await writeFile(join(dir, "selfauth.config.json"), edited);
    sync(dir);
    const report = await runValidation(join(dir, "server"));
    expect(report.notes.join("\n")).not.toContain("selfauth.config.json");
  });

  it("is checked against the specification: a minimum below 8 fails validate", async () => {
    const dir = await project();
    const edited = (await read(dir, "selfauth.config.json")).replace(
      '"minLength": 8',
      '"minLength": 4',
    );
    await writeFile(join(dir, "selfauth.config.json"), edited);
    sync(dir);
    const report = await runValidation(join(dir, "server"));
    expect(report.problems.join("\n")).toMatch(/minLength/);
  });
});
