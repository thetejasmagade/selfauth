import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL("../..", import.meta.url));
const reference = join(here, "..", "playground", "prisma", "migrations");
const mine = join(here, "db", "migrations");

const migrations = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

/**
 * The Go application ships the same PostgreSQL schema as the TypeScript reference apps
 * (DATA_MODEL.md), so a database can be moved between them. The SQL is copied, never
 * re-derived: it must stay byte-identical.
 */
describe("PostgreSQL migrations match the reference implementation", () => {
  it("has the same migrations", () => {
    expect(migrations(mine)).toEqual(migrations(reference));
  });
  it.each(migrations(reference))("%s is byte-identical", (name) => {
    expect(readFileSync(join(mine, name, "migration.sql"), "utf8")).toBe(
      readFileSync(join(reference, name, "migration.sql"), "utf8"),
    );
  });
});
