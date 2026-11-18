---
title: Change the database
description: Add your own tables and columns to a SelfAuth project with Prisma migrations or plain SQL for Gin, query them from your routes, and switch from the in-memory store to a real database.
keywords: [prisma schema, migration, add table, add column, db generate, db plan, db migrate, DATABASE_URL, switch to postgresql]
---

# Change the database

Two jobs live on this page:

1. [Add your own tables](#add-your-own-table) next to SelfAuth's.
2. [Move from the in-memory store to a real database](#move-from-memory-to-a-real-database).

The steps for Prisma were run against a generated SQLite project, and the output below is real. PostgreSQL and MySQL work the same way; only the column types differ.

## Rules to remember

- **Migrations are reviewed SQL files.** Nothing changes your database when the server starts.
- **Never edit a migration that has already been applied.** Write a new one.
- **There are no down migrations.** To undo a change, restore a backup or write a new forward migration.
- **Keep your data in your own tables** where you can. You may add columns to `auth_*` tables, but the SelfAuth stores only read the columns they know.
- Table names that start with `auth_` belong to SelfAuth. Name yours differently (`orders`, `invoices`).

## Add your own table

### With Prisma (PostgreSQL, MySQL, SQLite)

**Step 1. Edit `prisma/schema.prisma`** (full stack: `server/prisma/schema.prisma`). Add the model at the end, and the back-reference inside `AuthUser`:

```prisma
// inside `model AuthUser { ... }` add one line:
  orders       Order[]

// at the end of the file:
/// Your own table: SelfAuth never touches it.
model Order {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  item      String
  createdAt DateTime @default(now()) @map("created_at")

  user AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("orders")
}
```

On PostgreSQL, the ids in `auth_users` are UUIDs, so write `userId String @map("user_id") @db.Uuid`, and `id String @id @default(uuid()) @db.Uuid`. The relation is what makes the database enforce that an order belongs to a real user, and `onDelete: Cascade` removes a user's orders when the account row is removed.

**Step 2. Create the migration** (this writes SQL but does not apply it):

```bash
npx selfauth db generate add_orders
```

**Output:**

```text
  ✓ Created prisma/migrations/20261118114551_add_orders/migration.sql; review it, then run `selfauth db plan`.
```

**Step 3. Read it.** Open the new `migration.sql`. For SQLite it is:

```sql
-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");
```

**Step 4. Check and apply:**

```bash
npx selfauth db plan
npx selfauth db migrate
```

**Output:**

```text
Pending migrations (1):
  • 20261118114551_add_orders  (prisma/migrations/20261118114551_add_orders/migration.sql)
  ✓ No destructive or non-owned changes.
  ✓ Migrations applied.
```

`db plan` flags statements that drop data and changes to tables SelfAuth owns. `db migrate` refuses those unless you add `--approve-destructive`.

**Step 5. Regenerate the Prisma client** so that TypeScript knows the new model:

```bash
npx prisma generate
```

**Step 6. Check that SelfAuth still agrees:**

```bash
npx selfauth validate
```

```text
  ✓ selfauth configuration is valid
  ✓ 39 generated file(s) unchanged
  ✓ Prisma schema and ownership manifest are consistent
  • changed by you (kept, never overwritten): prisma/schema.prisma

All checks passed.
```

### Use the new table in a route

Create one Prisma client for your own queries:

```ts
// src/db/client.ts
import { createPrismaClient } from "../auth/stores/prisma.ts";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required for your own tables");

/** One Prisma client for your own queries (the SelfAuth stores have their own). */
export const db = createPrismaClient({ connectionString: url });
```

Then query it, always scoped to the signed-in user:

```ts
// src/routes/orders.ts
import express from "express";
import type { Auth } from "../auth/index.ts";
import { db } from "../db/client.ts";

export function orderRoutes(auth: Auth): express.Router {
  const routes = auth.protectedRoutes();
  routes.get("/", auth.requirePermission("orders.view"), async (_req, res) => {
    const me = auth.context(res)!;
    res.json(await db.order.findMany({ where: { userId: me.userId } }));
  });
  return routes.router;
}
```

For per-owner rules that cover more than one route, use [ownership policies](./resource-ownership), where `load` is `db.order.findUnique(...)`.

::: warning In-memory has no database
`src/db/client.ts` needs `DATABASE_URL`. A project created with `--database memory` has no Prisma. Move to a real database first: see the end of this page.
:::

### With Gin (plain SQL)

A Gin project has no ORM. Add a new folder in `db/migrations/` named like the existing one (a timestamp, an underscore and a name), with a `migration.sql` inside:

```text
db/migrations/
├── 20261116085533_selfauth_init/migration.sql
└── 20261201090000_add_orders/migration.sql      # new
```

```sql
CREATE TABLE orders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  item       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_id_idx ON orders (user_id);
```

Apply it (read it first; take a backup in production):

```bash
go run ./cmd/migrate status     # lists applied and pending migrations
go run ./cmd/migrate up         # applies pending ones, each in its own transaction
```

The runner records a checksum for each applied file and **refuses to continue if an applied file was edited**. It takes a database lock so two deployments cannot run at once. For queries, use your own `pgx` pool in your routes.

### With MongoDB

There are no migrations. Define your own Mongoose models in your own files and use the same connection settings. The SelfAuth collections all start with `auth_`. `npm run db:migrate` only creates SelfAuth's indexes.

## Add a column to a SelfAuth table

For example `display_name` on `auth_users`: add the field to the Prisma model, run `npx selfauth db generate add_display_name`, review, plan and migrate as above. Upgrades never rewrite your migrations. Be aware that the SelfAuth stores will not read or write your new column, so use your own query for it.

## Move from memory to a real database

You generated with `--database memory` and now want PostgreSQL. Generate a new project with `--database postgresql`, then move your own files into it: `src/routes/`, `src/email/`, your tests and your changes to `selfauth.config.ts`. This is the supported route, because the schema files, the store and the scripts differ between databases. See [What each database changes](/structure/databases) for the list.

## Switch on the real database

1. Create an empty database and a user for it.
2. Put the connection string in `.env` as `DATABASE_URL` (Gin: export it).
3. `npx selfauth db plan`, then `npx selfauth db migrate`.
4. `npm run db:seed`.
5. Start the server: the log now says `Using PostgreSQL (Prisma) store.`

If something fails, see [Troubleshooting](/troubleshooting#database-url-is-not-set).

## Next

- [Send real email](./email)
