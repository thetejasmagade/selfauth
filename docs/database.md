# Database schema and migrations

The logical model is [`DATA_MODEL.md`](../packages/spec/specs/DATA_MODEL.md).
The PostgreSQL implementation is the Prisma schema and the plain-SQL
migration in every PostgreSQL template:

- [`templates/express/prisma/schema.prisma`](../templates/express/prisma/schema.prisma)
- [`templates/express/prisma/migrations/20261116085533_selfauth_init/migration.sql`](../templates/express/prisma/migrations/20261116085533_selfauth_init/migration.sql):
  reviewable SQL. If you don't use Prisma, you can also apply it with
  `psql` or your own migration tool.

## Tables SelfAuth owns

Every name has the `auth_` prefix, so it won't collide with your tables.
`selfauth.manifest.json` → `ownedResources` lists them, and
`selfauth db plan` flags any migration that touches a table *not* on that
list.

| Table | Holds |
| --- | --- |
| `auth_users` | Account: id (UUID), email as entered plus its normalized form (unique), state (`pending`/`active`/`suspended`/`disabled`/`deleted`), verification time, timestamps |
| `auth_credentials` | Password hash (Argon2id PHC string), kept separate from the user row |
| `auth_sessions` | **SHA-256 hashes** of session tokens (never the token), with idle and absolute expiry, last seen, revocation reason, IP and user agent |
| `auth_roles`, `auth_permissions`, `auth_role_permissions` | RBAC definitions, written from `selfauth.config.ts` by the seed |
| `auth_user_roles` | Role assignments, including who assigned them |
| `auth_email_verification_tokens`, `auth_password_reset_tokens` | Hashed one-time tokens with expiry and used-at time (single use) |
| `auth_security_events` | Audit log: login success and failure, password and role changes, admin actions |
| `auth_rate_limits` | Rate-limit counters, shared across app instances (row-locked updates) |

Enum types: `auth_account_state`, `auth_credential_type`,
`auth_session_revoked_reason`, `auth_event_outcome`.

## Rules

- **Never on startup.** The app never migrates or seeds itself
  (DATA-MODEL-003). Run `npm run db:migrate` (= `prisma migrate deploy`) and
  `npm run db:seed` as deploy steps.
- **Review before applying.** The SQL is committed. `npx selfauth db plan`
  (optional) lists destructive statements and changes to tables SelfAuth
  doesn't own. `selfauth db migrate` refuses those unless you pass
  `--approve-destructive`.
- **No down migrations.** Roll back by restoring a backup, or by writing a
  new forward migration. `selfauth db rollback` prints the procedure.
- **Existing databases** without Prisma history fail with P3005. Baseline
  them (`prisma migrate resolve --applied <migration>`), and only for
  migrations whose objects really exist.

## Extending the schema

You may add columns to SelfAuth tables (for example, `display_name` on
`auth_users`) or add your own tables that reference `auth_users(id)`:

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --create-only --name add_display_name`, or
   `npx selfauth db generate add_display_name`, against a development
   database.
3. Review the SQL, commit it, and apply it with `db:migrate` everywhere else.

Keep your own data in your own tables where you can. Columns you add to
`auth_*` tables survive SelfAuth upgrades, because upgrades ship new forward
migrations and never rewrite yours. But the store code (`stores/prisma.ts`)
only reads the columns it knows about.

## Troubleshooting `selfauth db`

**"DATABASE_URL is not set".** `selfauth db status|plan|migrate|generate` read
`DATABASE_URL` from the environment, or from the `.env` in the project (in a
full-stack project: `server/.env`). It tells you which of the two it found. Add
`DATABASE_URL=postgresql://user:password@host:5432/dbname` to `.env` and **save the
file**. A variable that is set but empty in your shell does not hide the value in
`.env`. The value must start with `postgresql://` or `postgres://`, and the
placeholder from `.env.example` is refused.

**Special characters in the password.** URL-encode them (`@` is `%40`, `#` is `%23`,
`/` is `%2F`). Don't put quotes around the value in a shell command. In Windows
`cmd`, `set DATABASE_URL=postgresql://...` takes the value as it is.

**Supabase (and other pooled databases).** Prisma Migrate needs a direct
connection or a session-mode pooler: it relies on session features (advisory locks,
prepared statements) that a transaction-mode pooler, such as Supabase's port 6543
URL, does not provide. Use Supabase's *direct connection* string, or the pooler's
*session mode* (port 5432), for `selfauth db plan` and `selfauth db migrate`
(`npm run db:migrate`). Your running app can use the connection string you prefer.

**`selfauth db` on Windows.** It starts Prisma with Node, so it behaves the same as
on macOS and Linux. Run `npm install` first: if Prisma is not installed it says so.

