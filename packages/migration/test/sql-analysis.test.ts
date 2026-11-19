import { describe, expect, it } from "vitest";
import { analyzeSql, createdObjects, splitStatements } from "../src/index.js";

const kinds = (sql: string, owned?: { tables: string[]; types: string[] }) =>
  analyzeSql(sql, owned).map((f) => `${f.kind}:${f.object ?? ""}`);

describe("splitStatements", () => {
  it("ignores comments and semicolons inside quotes", () => {
    const parts = splitStatements(
      `-- note; here\nCREATE TABLE "a" (x text default ';');\n/* block; */ DROP TABLE b;`,
    );
    expect(parts.map((p) => p.statement)).toEqual([
      `CREATE TABLE "a" (x text default ';')`,
      "DROP TABLE b",
    ]);
    expect(parts.map((p) => p.line)).toEqual([2, 3]);
  });
});

describe("analyzeSql", () => {
  it("flags data-destroying statements", () => {
    expect(
      kinds(`
        DROP TABLE IF EXISTS "public"."auth_sessions";
        DROP TYPE "auth_event_outcome";
        TRUNCATE auth_users;
        DELETE FROM auth_roles WHERE true;
        ALTER TABLE "auth_users" DROP COLUMN "email";
        ALTER TABLE "auth_users" ALTER COLUMN "state" SET DATA TYPE text;
        ALTER TABLE "auth_users" RENAME COLUMN "email" TO "mail";
        DROP SCHEMA app CASCADE;
      `),
    ).toEqual([
      "drop_table:auth_sessions",
      "drop_type:auth_event_outcome",
      "truncate:auth_users",
      "delete:auth_roles",
      "drop_column:auth_users",
      "alter_column_type:auth_users",
      "rename:auth_users",
      "drop_schema:app",
    ]);
  });

  it("treats additive changes as safe", () => {
    expect(
      kinds(`
        CREATE TABLE "auth_x" ("id" UUID NOT NULL, CONSTRAINT "auth_x_pkey" PRIMARY KEY ("id"));
        ALTER TABLE "auth_users" ADD COLUMN "nickname" TEXT;
        ALTER TABLE "auth_sessions" ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        ALTER TABLE "auth_users" ALTER COLUMN "email" DROP NOT NULL;
        CREATE INDEX "i" ON "auth_users"("email");
      `),
    ).toEqual([]);
  });

  it("marks risky but non-destructive changes", () => {
    expect(
      kinds(
        `ALTER TABLE a ALTER COLUMN b SET NOT NULL; DROP INDEX "i"; ALTER TABLE a DROP CONSTRAINT c;`,
      ),
    ).toEqual(["set_not_null:a", "drop_index:i", "drop_constraint:a"]);
  });

  it("flags any change to objects SelfAuth does not own (DATA-MODEL-004)", () => {
    const owned = { tables: ["auth_users"], types: ["auth_account_state"] };
    expect(
      kinds(
        `ALTER TABLE "users" ADD COLUMN "x" TEXT;
         CREATE INDEX "i" ON "orders"("id");
         INSERT INTO "audit" VALUES (1);
         ALTER TABLE "auth_users" ADD COLUMN "y" TEXT;`,
        owned,
      ),
    ).toEqual(["not_owned:users", "not_owned:orders", "not_owned:audit"]);
  });
});

describe("analyzeSql for the application's own migrations", () => {
  const owned = { tables: ["auth_users"], types: ["auth_account_state"] };
  const mine = (sql: string) =>
    analyzeSql(sql, owned, "app").map((f) => `${f.kind}:${f.object ?? ""}`);

  it("lets the developer add to their own tables without approval", () => {
    expect(
      mine(
        `CREATE TABLE "notes" (id text);
         CREATE INDEX "notes_owner_idx" ON "notes"("owner_id");
         ALTER TABLE "notes" ADD COLUMN "title" TEXT;
         INSERT INTO "notes" VALUES ('a');`,
      ),
    ).toEqual([]);
  });

  it("still flags data loss in the developer's own tables", () => {
    expect(mine(`ALTER TABLE "notes" DROP COLUMN "title";`)).toEqual(["drop_column:notes"]);
    expect(mine(`DROP TABLE "notes";`)).toEqual(["drop_table:notes"]);
    expect(mine(`ALTER TABLE "notes" ALTER COLUMN "n" TYPE INTEGER;`)).toEqual([
      "alter_column_type:notes",
    ]);
  });

  it("flags the developer changing a SelfAuth table", () => {
    expect(
      mine(
        `ALTER TABLE "auth_users" ADD COLUMN "nickname" TEXT;
         CREATE INDEX "i" ON "auth_users"("email");`,
      ),
    ).toEqual(["selfauth_table:auth_users", "selfauth_table:auth_users"]);
    expect(mine(`DROP TABLE "auth_users";`)).toEqual([
      "drop_table:auth_users",
      "selfauth_table:auth_users",
    ]);
  });

  it("does not flag a table the same migration creates", () => {
    expect(
      mine(`CREATE TABLE "auth_users" (id text); CREATE INDEX "i" ON "auth_users"("id");`),
    ).toEqual([]);
  });
});

describe("createdObjects", () => {
  it("lists created tables and types", () => {
    expect(
      createdObjects(
        `CREATE TYPE "s" AS ENUM ('a'); CREATE TABLE IF NOT EXISTS "public"."t" (id int);`,
      ),
    ).toEqual({
      tables: ["t"],
      types: ["s"],
    });
  });
});

describe("MySQL SQL", () => {
  const owned = { tables: ["auth_users"], types: [] };

  it("reads backtick-quoted names and keeps semicolons inside backticks", () => {
    expect(
      splitStatements("CREATE TABLE `a;b` (x int); DROP TABLE `a;b`;").map((p) => p.statement),
    ).toEqual(["CREATE TABLE `a;b` (x int)", "DROP TABLE `a;b`"]);
    expect(createdObjects("CREATE TABLE `auth_users` (`id` CHAR(36) NOT NULL);")).toEqual({
      tables: ["auth_users"],
      types: [],
    });
  });

  it("flags destructive MySQL statements", () => {
    expect(kinds("DROP TABLE `auth_users`;", owned)).toEqual(["drop_table:auth_users"]);
    expect(kinds("DROP DATABASE `app`;")).toEqual(["drop_schema:app"]);
    expect(kinds("RENAME TABLE `auth_users` TO `users2`;")).toEqual(["rename:auth_users"]);
    expect(kinds("ALTER TABLE `auth_users` DROP COLUMN `email`;", owned)).toEqual([
      "drop_column:auth_users",
    ]);
    expect(kinds("ALTER TABLE `auth_users` MODIFY `email` TEXT NOT NULL;", owned)).toEqual([
      "alter_column_type:auth_users",
    ]);
    expect(kinds("ALTER TABLE `auth_users` CHANGE `email` `mail` TEXT;", owned)).toEqual([
      "alter_column_type:auth_users",
    ]);
  });

  it("does not call dropping a key or index a dropped column", () => {
    expect(kinds("ALTER TABLE `auth_users` DROP FOREIGN KEY `fk`;", owned)).toEqual([
      "drop_constraint:auth_users",
    ]);
    expect(kinds("ALTER TABLE `auth_users` DROP INDEX `i`;", owned)).toEqual([]);
    expect(kinds("ALTER TABLE `auth_users` DROP PRIMARY KEY;", owned)).toEqual([
      "drop_constraint:auth_users",
    ]);
  });

  it("flags a table the project owns nothing of", () => {
    expect(kinds("ALTER TABLE `orders` ADD COLUMN `x` INT;", owned)).toEqual(["not_owned:orders"]);
  });

  it("finds nothing to flag in the generated SelfAuth migration", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(
      new URL(
        "../../cli/template-variants/mysql/prisma/migrations/20261116085533_selfauth_init/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const created = createdObjects(sql);
    expect(created.tables).toContain("auth_users");
    expect(analyzeSql(sql, { tables: created.tables, types: [] })).toEqual([]);
  });
});
