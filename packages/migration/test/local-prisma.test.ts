import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLocalPrisma, localPrisma } from "../src/index.js";

/**
 * The migration commands run the project's own Prisma. It is started with Node and its entry
 * script, not through `.bin/prisma` (a shell script, which Windows cannot execute), and it is
 * found in a parent folder too, because npm workspaces hoist dependencies to the root.
 */
async function fakePrisma(root: string): Promise<void> {
  const pkg = join(root, "node_modules", "prisma");
  await mkdir(join(pkg, "build"), { recursive: true });
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "prisma", bin: { prisma: "build/index.js" } }),
  );
  await writeFile(
    join(pkg, "build", "index.js"),
    "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n",
  );
}

describe("local Prisma", () => {
  it("runs the entry script with Node and passes the arguments", async () => {
    const root = await mkdtemp(join(tmpdir(), "selfauth-prisma-"));
    await fakePrisma(root);
    const result = await localPrisma(["migrate", "status"], { cwd: root, env: process.env });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).args).toEqual(["migrate", "status"]);
  });

  it("finds Prisma hoisted to a parent folder (npm workspace) and runs in the package", async () => {
    const root = await mkdtemp(join(tmpdir(), "selfauth-prisma-"));
    await fakePrisma(root);
    const server = join(root, "server");
    await mkdir(server);
    expect(findLocalPrisma(server)).toBe(join(root, "node_modules", "prisma", "build", "index.js"));
    const result = await localPrisma(["--version"], { cwd: server, env: process.env });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).cwd).toContain("server");
  });

  it("says what is wrong when Prisma is not installed, instead of failing silently", async () => {
    const empty = await mkdtemp(join(tmpdir(), "selfauth-prisma-"));
    const result = await localPrisma(["migrate", "status"], { cwd: empty, env: process.env });
    expect(result.code).toBe(127);
    expect(result.stderr).toMatch(/Prisma is not installed/);
    expect(result.stderr).toMatch(/npm install/);
  });

  it("shows the reason when the process cannot start (no empty error message)", async () => {
    const root = await mkdtemp(join(tmpdir(), "selfauth-prisma-"));
    const pkg = join(root, "node_modules", "prisma");
    await mkdir(join(pkg, "build"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ bin: { prisma: "build/index.js" } }),
    );
    await writeFile(join(pkg, "build", "index.js"), "process.exit(3);\n");
    const result = await localPrisma(["x"], { cwd: root, env: process.env });
    expect(result.code).toBe(3);
  });
});
