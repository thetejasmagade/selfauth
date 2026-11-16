# Migration rules (PostgreSQL + Prisma)

SelfAuth never migrates on startup (DATA-MODEL-003). Migrations are ordinary
Prisma Migrate files in `prisma/migrations/`. The developer commits and
reviews them. `selfauth db …` adds safety analysis on top.

| Command | What it does | Agent rule |
| --- | --- | --- |
| `selfauth db status` | Applied, pending and failed migrations | Safe to run |
| `selfauth db plan` | Pending SQL with findings: **destructive** (drops, type changes, data loss), **not owned** (touches tables SelfAuth doesn't own), **already exists** (conflicts with objects in the database) | Safe. Show the findings verbatim |
| `selfauth db migrate` | Applies pending migrations. Refuses destructive or not-owned plans, and blocks on already-exists | Run only after showing `db plan` |
| `selfauth db migrate --approve-destructive` | Applies despite findings | **Only** with explicit approval of those findings in this conversation |
| `selfauth db generate <name>` | Creates a migration from schema changes, without applying it | Show the SQL afterwards |
| `selfauth db validate` | Schema against the ownership manifest | Safe |
| `selfauth db rollback` | Prints the rollback procedure. There are no automatic down migrations | Follow it with the developer |

## Never

- `prisma migrate reset`, `prisma db push --accept-data-loss`, or
  `prisma migrate dev` against a database you did not create. They can drop
  data.
- Editing a migration that has already been applied. Generate a new one.
- Changing or dropping tables that SelfAuth doesn't own. The
  `ownedResources` list in `selfauth.manifest.json` names the tables and
  types SelfAuth owns.
- Putting `DATABASE_URL` in committed files or printing it.

## Existing databases

- **A non-empty database that has never used Prisma Migrate (P3005).** Prisma
  refuses to apply. `db migrate` explains how to baseline:
  `prisma migrate resolve --applied <migration>`, but only for migrations
  whose objects already exist. Do it with the developer; never baseline a
  migration that wasn't actually applied.
- **The project already has a Prisma schema.** `selfauth add --database
  postgresql` is blocked because schema merging isn't automated. Offer
  `--database memory`, or a manual merge with a reviewed migration.
- **Already-exists findings** (for example, a `users` table already exists).
  Stop. The developer decides whether to rename or drop their table, or keep
  SelfAuth out of this database. Never drop it yourself.

## Production

- Check that a recent backup exists before running `db migrate` against
  production.
- Run `npm run db:seed` (or `src/selfauth/scripts/seed.ts`) after migrating,
  so the roles in `selfauth.config.ts` exist. The server refuses to start if
  they don't.
