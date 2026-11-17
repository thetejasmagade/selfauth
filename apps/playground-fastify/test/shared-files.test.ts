import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Fastify reference implementation shares its core with the Express one: the same
 * `auth/core`, stores, configuration loading, mailer, database wiring, scripts and Prisma schema.
 * The files are copies (each app is complete on its own, and the CLI templates point at one app
 * each), so this test keeps them byte for byte identical. Only the HTTP adapter differs.
 */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const EXPRESS = `${REPO}apps/playground/`;
const FASTIFY = `${REPO}apps/playground-fastify/`;

function files(root: string, dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(`${root}${dir}`)) {
    const path = `${dir}/${name}`;
    if (statSync(`${root}${path}`).isDirectory()) out.push(...files(root, path));
    else out.push(path);
  }
  return out.sort();
}

const SHARED_DIRECTORIES = ["src/auth/core", "src/auth/stores", "prisma"];
const SHARED_FILES = [
  "src/auth/types.ts",
  "src/config/env.ts",
  "src/config/dev-config.ts",
  "src/email/mailer.ts",
  "src/http/errors.ts",
  "src/db/store.ts",
  "src/scripts/seed.ts",
  "src/scripts/create-admin.ts",
  "prisma.config.ts",
  "test/postgres.ts",
  "selfauth.manifest.json",
];

describe("files shared with the Express playground", () => {
  const shared = [...SHARED_DIRECTORIES.flatMap((d) => files(FASTIFY, d)), ...SHARED_FILES];

  it("cover every file in the shared folders", () => {
    for (const dir of SHARED_DIRECTORIES)
      expect(files(FASTIFY, dir), dir).toEqual(files(EXPRESS, dir));
  });

  it.each(shared)("%s is identical", (path) => {
    expect(existsSync(`${EXPRESS}${path}`), path).toBe(true);
    const ours = readFileSync(`${FASTIFY}${path}`, "utf8");
    const theirs = readFileSync(`${EXPRESS}${path}`, "utf8");
    expect(ours).toBe(theirs);
  });

  it("use the same versions of the dependencies they share", () => {
    const read = (root: string) => JSON.parse(readFileSync(`${root}package.json`, "utf8"));
    const express = { ...read(EXPRESS).dependencies, ...read(EXPRESS).devDependencies };
    const fastify = { ...read(FASTIFY).dependencies, ...read(FASTIFY).devDependencies };
    for (const [name, range] of Object.entries(fastify)) {
      if (name in express) expect(range, name).toBe(express[name]);
    }
  });
});
