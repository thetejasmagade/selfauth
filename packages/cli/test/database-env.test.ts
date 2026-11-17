import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { databaseUrlProblems, readDatabaseEnv } from "../src/database-env.js";
import { applyPlan, planInit } from "../src/index.js";

/**
 * `selfauth db` must never end in Prisma's bare "Connection url is empty". It reads `.env`
 * itself, hands the value to Prisma, and says what it found when there is none.
 */
const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const URL_ =
  "postgresql://postgres.abc:Pass.word%40123@pooler.example.invalid:6543/postgres?pgbouncer=true";
const temp = () => mkdtemp(join(tmpdir(), "selfauth-dbenv-"));

describe("readDatabaseEnv", () => {
  it("reports what it found when there is nothing to use", async () => {
    const dir = await temp();
    expect(await readDatabaseEnv(dir, {})).toMatchObject({
      url: undefined,
      source: null,
      environment: "not set",
      envFile: "missing",
    });
    await writeFile(join(dir, ".env"), "PORT=3000\n");
    expect((await readDatabaseEnv(dir, {})).envFile).toBe("has no DATABASE_URL");
    await writeFile(join(dir, ".env"), "DATABASE_URL=\n");
    expect((await readDatabaseEnv(dir, {})).envFile).toBe("DATABASE_URL is empty");
  });

  it.each([
    ["LF", `# c\nDATABASE_URL=${URL_}\n`],
    ["CRLF (Windows editors)", `# c\r\nPORT=3000\r\nDATABASE_URL=${URL_}\r\n`],
    ["a byte-order mark", `\uFEFF# c\nDATABASE_URL=${URL_}\n`],
    ["double quotes", `DATABASE_URL="${URL_}"\n`],
    ["single quotes", `DATABASE_URL='${URL_}'\n`],
  ])("reads a Supabase-style URL from .env with %s", async (_name, content) => {
    const dir = await temp();
    await writeFile(join(dir, ".env"), content);
    expect(await readDatabaseEnv(dir, {})).toMatchObject({
      url: URL_,
      source: ".env",
      envFile: "ok",
    });
  });

  it("prefers a real environment variable, and ignores an empty one", async () => {
    const dir = await temp();
    await writeFile(join(dir, ".env"), `DATABASE_URL=${URL_}\n`);
    expect(await readDatabaseEnv(dir, { DATABASE_URL: "postgresql://other/db" })).toMatchObject({
      url: "postgresql://other/db",
      source: "environment",
    });
    // An empty variable in the shell must not hide the value in .env.
    expect(await readDatabaseEnv(dir, { DATABASE_URL: "" })).toMatchObject({
      url: URL_,
      source: ".env",
      environment: "set but empty",
    });
  });
});

describe("databaseUrlProblems", () => {
  it("accepts real connection strings", () => {
    expect(databaseUrlProblems(URL_)).toEqual([]);
    expect(databaseUrlProblems("postgres://u:p@localhost:5432/app")).toEqual([]);
  });

  it.each([
    [
      "the .env.example placeholder",
      "postgresql://user:password@localhost:5432/app",
      /placeholder/,
    ],
    ["a URL for another database", "mysql://u:p@host/db", /must start with "postgresql:\/\//],
    ["no scheme", "db.example.com:5432/postgres", /must start with/],
    ["quotes inside the value", '"postgresql://u:p@h/db"', /quotes/],
  ])("explains %s", (_name, url, message) => {
    expect(databaseUrlProblems(url).join(" ")).toMatch(message);
  });
});

describe("selfauth db without a connection string", () => {
  const run = (cwd: string, args: string[]) =>
    new Promise<{ code: number; out: string }>((done) =>
      execFile(
        process.execPath,
        [BIN, ...args],
        { cwd, env: { PATH: process.env["PATH"] ?? "" } },
        (error, stdout, stderr) =>
          done({ code: error ? Number(error.code ?? 1) : 0, out: stdout + stderr }),
      ),
    );

  it("says DATABASE_URL is missing and where it looked, instead of Prisma's bare error", async () => {
    const dir = await temp();
    await applyPlan(
      dir,
      await planInit({
        name: "demo",
        database: "postgresql",
        frontend: "none",
        permissions: [],
        appBaseUrl: "http://localhost:5173",
      }),
    );
    const r = await run(dir, ["db", "plan"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("DATABASE_URL is not set");
    expect(r.out).toContain("environment variable:  not set");
    expect(r.out).toMatch(/\.env:\s+missing/);
    expect(r.out).not.toContain("Connection url is empty");

    await writeFile(
      join(dir, ".env"),
      "DATABASE_URL=postgresql://user:password@localhost:5432/app\n",
    );
    const placeholder = await run(dir, ["db", "plan"]);
    expect(placeholder.code).toBe(1);
    expect(placeholder.out).toMatch(/placeholder/);
  });
});
