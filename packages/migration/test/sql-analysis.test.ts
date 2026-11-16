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
