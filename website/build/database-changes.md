---
title: Change the database
description: Add your own tables and columns to a SelfAuth project with Prisma migrations or plain SQL for Gin, query them from your routes, and switch from the in-memory store to a real database.
keywords: [prisma schema, migration, add table, add column, db generate, db plan, db migrate, DATABASE_URL, switch to postgresql]
---

# Change the database

There are two jobs on this page:

1. [Add your own tables](#add-your-own-table) next to SelfAuth's.
2. [Move from the in-memory store to a real database](#move-from-memory-to-a-real-database).

I ran the Prisma steps against a generated SQLite project, and the output below is real. PostgreSQL and MySQL work the same way, apart from the column types.

## Rules to remember

- Migrations are SQL files you review. Nothing touches your database when the server starts.
- Never edit a migration that's already been applied. Write a new one.
- There are no down migrations. To undo something, restore a backup or write a new forward migration.
- Tables starting with `auth_` belong to SelfAuth, so give yours other names (`orders`, `invoices`).

## Add your own table

### With Prisma (PostgreSQL, MySQL, SQLite)

Step 1. Edit `prisma/schema.prisma` (`server/prisma/schema.prisma` in a full-stack project). Add the model at the end, and a back-reference inside `AuthUser`:

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

On PostgreSQL the ids in `auth_users` are UUIDs, so write `userId String @map("user_id") @db.Uuid` and `id String @id @default(uuid()) @db.Uuid`. The relation makes the database enforce that every order belongs to a real user, and `onDelete: Cascade` removes a user's orders when the account row goes.

Step 2. Create the migration. This writes the SQL but doesn't apply it:

```bash
npx selfauth db generate add_orders
```

Output:

```text
  ✓ Created prisma/migrations/20261118114551_add_orders/migration.sql; review it, then run `selfauth db plan`.
```

Step 3. Read it. Open the new `migration.sql`. On SQLite it looks like this:

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

Step 4. Check it, then apply it:

```bash
npx selfauth db plan
npx selfauth db migrate
```

Output:

```text
Pending migrations (1):
  • 20261118114551_add_orders  (prisma/migrations/20261118114551_add_orders/migration.sql)
  ✓ No destructive or non-owned changes.
  ✓ Migrations applied.
```

`db plan` flags statements that drop data and changes to tables SelfAuth owns. `db migrate` refuses those unless you add `--approve-destructive`.

Step 5. Regenerate the Prisma client so TypeScript knows about the new model:

```bash
npx prisma generate
```

Step 6. Confirm SelfAuth is still happy:

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

Make one Prisma client for your own queries:

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

If the same ownership rule applies to several routes, use an [ownership policy](./resource-ownership) and have `load` call `db.order.findUnique(...)`.

`src/db/client.ts` needs `DATABASE_URL`, and a project created with `--database memory` has no Prisma at all. Move to a real database first, as described at the end of this page.

### With Gin (plain SQL)

A Gin project has no ORM. Add a folder under `db/migrations/` named like the existing one (a timestamp, an underscore, a name) with a `migration.sql` inside:

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

Read it before you apply it, and take a backup in production:

```bash
go run ./cmd/migrate status     # lists applied and pending migrations
go run ./cmd/migrate up         # applies pending ones, each in its own transaction
```

The runner records a checksum for every applied file and stops if an applied file was edited. It also takes a database lock so two deployments can't run at once. For queries, use your own `pgx` pool in your routes.

### With MongoDB

There are no migrations. Define your own Mongoose models in your own files and reuse the same connection settings. SelfAuth's collections all start with `auth_`, and `npm run db:migrate` only creates SelfAuth's indexes.

## Add a column to a SelfAuth table

Take `display_name` on `auth_users` as an example. Add the field to the Prisma model, run `npx selfauth db generate add_display_name`, then review, plan and migrate as above. Upgrades never rewrite your migrations. Just remember that SelfAuth's stores won't read or write your new column, so query it yourself.

## Move from memory to a real database

Say you generated with `--database memory` and now want PostgreSQL. Generate a new project with `--database postgresql` and move your own files into it: `src/routes/`, `src/email/`, your tests and your changes to `selfauth.config.ts`. That's the supported way, because the schema files, the store and the scripts all differ between databases. [What each database changes](/structure/databases) lists the differences.

## Switch on the real database

1. Create an empty database and a user for it.
2. Put the connection string in `.env` as `DATABASE_URL` (in Gin, export it).
3. Run `npx selfauth db plan`, then `npx selfauth db migrate`.
4. Run `npm run db:seed`.
5. Start the server. The log should now say `Using PostgreSQL (Prisma) store.`

If something goes wrong, see [Troubleshooting](/troubleshooting#database-url-is-not-set).
