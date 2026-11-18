---
name: selfauth
description: Add, check, upgrade and explain email/password authentication, sessions, roles and permissions in Node.js Express or Fastify + TypeScript projects, with Vue or React frontends, using the SelfAuth CLI, which generates tested code the project owns. Use when asked to add login, sign-up, auth, RBAC or permissions, to protect routes, to wire SelfAuth into an existing app (any folder layout, monorepo, separate frontend), to diagnose or upgrade a SelfAuth install, or to answer questions about what SelfAuth supports, how it works, its security, database, configuration, deployment or limits. Use it instead of hand-writing authentication code or answering from memory.
license: MIT
compatibility: Node.js >= 22.18. Supports Express 5 and Fastify 5 (new and existing projects) + TypeScript >= 5.7 backends with PostgreSQL (Prisma) or an in-memory store, and Vue or React frontends for new projects. Needs the SelfAuth CLI (npx @selfauth/cli).
metadata:
  version: "0.11.0"
  spec: "0.1"
---

# SelfAuth

SelfAuth generates authentication code **into the project**: the developer owns
it and nothing calls SelfAuth at runtime. The generated code is the reference
implementation that passes the SelfAuth conformance suite. Your job is to
drive the CLI, wire the result into the application, and verify it. You do
not write authentication logic yourself.

`<skill>` below means the directory this file is in. `selfauth` means the CLI:
`npx @selfauth/cli`, or `node $SELFAUTH_CLI` when that variable points at a
local build. The scripts in `<skill>/scripts/` find it for you.

## Answering questions

People also ask about SelfAuth without wanting a change: what it supports, how
sessions or CSRF work, whether it is production ready, how to deploy it. Answer
from this skill's files, not from memory.

1. Start at [questions](references/questions.md). It maps common questions to a
   short answer and the file with the detail. Read only that file.
2. Use the specification for behaviour and security claims, and cite the
   requirement ID (for example `SEC-CSRF-004`). The user guides under
   [references/guides/](references/guides/api/README.md) cover usage, database,
   deployment, customization and limits. If a guide and a spec disagree, the
   spec wins: say so.
3. Separate **supported now**, **planned** and **not supported**
   ([framework-support](references/framework-support.md)). Never imply a planned
   or unsupported feature exists. For anything not documented, say it isn't
   documented.
4. Questions about the user's own project ("will this work with my app?") need
   evidence: run `detect-project.ts` first and answer from its report.
5. Be exact about trust. The PostgreSQL store is self-assessed at the
   production-profile level, and **no independent security audit has been
   done**. Don't call SelfAuth "secure", "audited" or "production-grade" without
   that qualification.
6. Don't turn a question into a change. Describe what would happen and offer the
   plan (step 6); change nothing until they ask.

## Rules — these are not negotiable

1. **Never hand-write security code.** That covers password hashing, session or
   token generation, cookies, CSRF, rate limiting, JWTs and permission checks.
   If the CLI can't generate it, say so and stop. Don't improvise.
2. **Never invent adapters.** Only what `selfauth list` reports is supported
   (see [framework-support](references/framework-support.md)). For NestJS,
   Next.js, Django, Mongo or anything else unsupported,
   stop and report it. Don't port the Express code.
3. **Never bypass the CLI.** Don't copy files out of the SelfAuth repository by
   hand when `init`, `add` or `upgrade` covers the case.
4. **Never replace or remove existing authentication without approval.** If
   detection finds any, show the developer the evidence. Ask before running
   anything, and pass `--allow-existing-auth` only after they say yes.
5. **Never run destructive migrations without explicit approval.** Show the
   `selfauth db plan` output. Pass `--approve-destructive` only after the
   developer approves those exact findings in this conversation. Never run
   `prisma migrate reset`, `prisma db push --accept-data-loss` or
   `prisma migrate dev` against a database you did not create.
6. **Never expose secrets.** Don't print, log or commit `.env`, `DATABASE_URL`,
   `SELFAUTH_CSRF_SECRET`, passwords or tokens, or paste them into files or
   chat. Use `.env.example` for names only.
7. **Never claim completion without passing validation.** "Done" requires
   `<skill>/scripts/validate-auth.ts` to print `RESULT: PASS`. Report every
   `SKIPPED` check as not verified.
8. **Report what is manual or unsupported.** That includes the email provider,
   the production database, deployment and anything the CLI printed as a step.
9. **Don't weaken generated security code.** Leave `src/auth/**` (or
   `src/selfauth/auth/**`) alone unless the developer asks. Configure behaviour
   through `selfauth.config.ts`, which is validated against the spec's bounds.

## Workflow

### 1. Inspect the project

```bash
node <skill>/scripts/detect-project.ts <project-dir>
```

The script runs `selfauth detect --json` and summarises it. Read the whole
summary: the stack, database clients, existing auth packages, file:line
**auth signals** in the application's own code, the `recommendation`, and the
blockers for each command.

### 2. Choose the path from the recommendation

| `recommendation` | Meaning | Do |
| --- | --- | --- |
| `init` | No `package.json`: a new project | `selfauth init <dir>` (step 6) |
| `add` | An existing Express or Fastify + TypeScript project | `selfauth add`, with the `--src` detect reports (step 6) |
| `add-frontend` | An existing Vue or React app | `selfauth add-frontend` ([layouts](references/project-layouts.md)) |
| `workspace` | A monorepo root | Run detect on each package, then `add` / `add-frontend` in each ([layouts](references/project-layouts.md)) |
| `upgrade` | SelfAuth is already installed | `selfauth doctor`, then `selfauth diff` / `upgrade` ([maintenance](#maintaining-an-existing-installation)) |
| `unsupported` | No generator applies | Stop. Report `reason` and the blockers. Suggest only what [framework-support](references/framework-support.md) lists. |

### 3. Handle existing authentication

If `existingAuth` or `authSignals` is not empty, list the packages and each
`file:line` for the developer. Explain that SelfAuth adds its own `/auth`
routes and sessions next to theirs and does not remove theirs. Then ask how to
proceed. Don't delete, rewrite or "migrate" their auth code unless they ask.
If they do ask, migrating users and passwords is a manual task: SelfAuth has
no importer.

### 4. Read the relevant specification

Read only what the task needs:

- Wiring, files and what you may edit: [architecture](references/architecture.md).
- Login, registration, sessions, verification and reset behaviour:
  [authentication-spec](references/authentication-spec.md).
- Roles, permissions and ownership checks:
  [authorization-spec](references/authorization-spec.md).
- Cookies, CSRF, rate limits, secrets and enumeration:
  [security-rules](references/security-rules.md).
- Changing `selfauth.config.ts`: [configuration](references/configuration.md).
- Anything with PostgreSQL or Prisma: [migration-rules](references/migration-rules.md).
- A folder other than `src/`, a monorepo, or a frontend elsewhere:
  [project layouts](references/project-layouts.md).
- Usage, database, customization, deployment, upgrading, limits: the guides in
  [references/guides/](references/guides/existing-projects.md) (see
  [questions](references/questions.md) for which one).

Requirement IDs such as `SEC-CSRF-004` are stable. Cite them when you explain
a behaviour or a refusal.

### 5. Check compatibility

For `add`, the `options` from detection list the blockers for each database.
Typical ones: no `"type": "module"`, TypeScript older than 5.7, a non-ES-module
`compilerOptions.module`, or an existing Prisma schema with
`--database postgresql` (merging isn't automated, so offer `--database memory`
or a manual merge). `tsconfigChanges` lists compiler options the developer
must add.

A tsconfig that would not compile the new folder is also a blocker. `add`
stops before writing and names the `include` entry to add.

Fixing a blocker means editing the developer's files, for example
`package.json` `type`. That is part of the plan they approve in step 6, and is
never done silently.

### 6. Present the plan, then run the CLI

Run the command with `--dry-run` first and show the developer:

- the files the CLI will create (it never overwrites existing files);
- the edits *you* will make to their files: server wiring, `tsconfig.json`,
  `.gitignore`, routes to protect;
- the permissions you will declare (`--permissions orders.view,orders.create`),
  derived from their domain;
- what stays manual.

Wait for approval. Then run it for real with `--yes`:

```bash
# new project
selfauth init my-app --backend express --database postgresql --frontend react --permissions orders.view,orders.create --yes
# existing Express or Fastify project (writes under <src>/selfauth/ only; --src if detect says so)
selfauth add --database memory --permissions orders.view --yes --install
# existing Vue or React app, in its own folder
selfauth add-frontend --yes
```

`add` prints the remaining steps under *Finish the integration*. Do each one
and keep the list for your report.

### 7. Integrate with the application

See [architecture](references/architecture.md#integrating-with-application-code)
for the API. In short:

- `const selfauth = await setupSelfAuth(app)` goes before the app's routes, and
  `app.use(selfauth.errorHandler)` goes after them (`add` layout).
- Protect routes with `auth.requireAuth`, `auth.requirePermission("x.y")` or
  `auth.authorizeResource(...)`. Use `auth.protectedRoutes()` for
  deny-by-default routers. Declare each permission in `selfauth.config.ts`
  under `authorization.permissions` and grant it to roles.
- Load resources server-side for ownership checks. Never trust a client-sent
  owner ID (AUTHZ-RES-003). Hiding a button in the frontend is a UX hint
  only, and the backend route must check too (AUTHZ-CORE-004).
- Browsers must send `X-SelfAuth-CSRF: 1` on every POST, PUT, PATCH and DELETE.
  That includes the application's existing fetch calls, because CSRF protection
  covers the whole app (SEC-CSRF-004).
- Email: `createMailer()` in `email/mailer.ts` needs a real provider before
  production. That is a manual item unless the developer names a provider and
  gives you its API usage. Never hard-code the API key.

### 8. Validate

```bash
node <skill>/scripts/validate-auth.ts <project-dir>
# with the server running, also probe the live routes:
node <skill>/scripts/validate-auth.ts <project-dir> --url http://localhost:3000 --protected /api/orders
```

The script runs `selfauth validate` and `selfauth doctor`, then the project's
own typecheck, tests and build. With `--url` it also checks that the auth
routes, CSRF protection and the protected routes you name refuse anonymous
requests. If anything fails, fix the cause and run it again. Don't edit
generated security code or relax config to make a check pass.

For PostgreSQL, also run `selfauth db plan` and `selfauth db migrate` (see
[migration-rules](references/migration-rules.md)). Run `npm run db:seed`, or
`node --env-file=.env src/selfauth/scripts/seed.ts` in the add layout, so the
roles exist.

### 9. Report

Use this shape. Be exact; never round "mostly works" up to "done".

```markdown
## SelfAuth integration — <project>
**Status:** complete | incomplete (<why>)
**Command run:** `selfauth add --database memory --yes --install`
**Your files I changed:** src/server.ts (wiring, 2 lines), tsconfig.json (2 options), …
**Verified:** validate-auth RESULT: PASS — validate ✓, doctor ✓ (2 warnings), typecheck ✓, tests ✓ (41), live probes ✓
**Not verified:** <every SKIPPED check, and why>
**Manual steps left:** email provider in src/selfauth/email/mailer.ts; DATABASE_URL in production; …
**Warnings from doctor:** …
**Not supported / not done:** …
```

## Database migrations

`selfauth db status|plan|migrate|validate|rollback|generate` wrap Prisma
Migrate, with safety analysis on top:

- `db plan` flags destructive SQL (drops, type changes) and changes to tables
  SelfAuth doesn't own. Show the findings verbatim.
- `db migrate` refuses those plans unless `--approve-destructive` is passed
  (rule 5).
- `db rollback` only explains the procedure. There are no automatic down
  migrations.

## Maintaining an existing installation

- `selfauth doctor` covers configuration and production readiness. Treat its
  errors as blocking and report its warnings.
- `selfauth validate` checks the config schema, which generated files the
  developer changed, and the Prisma schema against the manifest.
- If `upgrade` says the project uses the flat `src/` layout (SelfAuth 0.3 and
  earlier), the developer commits first, then runs `selfauth upgrade
  --reorganize --dry-run` and `--reorganize`. It moves files and rewrites
  imports. Run the project's typecheck and tests afterwards. A full-stack project
  made before the two-package layout (`src/` and `web/` side by side) can use the
  same command to move into `server/` and `client/` (then delete `node_modules`
  and run `npm install` once at the root).
- `selfauth diff`, then `selfauth upgrade`: files the developer never edited
  are updated. Edited files get a `<file>.selfauth-new` proposal next to them.
  Merge it with the developer and delete it afterwards. Deleted files stay
  deleted.

## Examples

- [New full-stack project](examples/new-project.md)
- [Existing Express app with existing auth](examples/existing-express-app.md)
- [Unsupported stack](examples/unsupported-stack.md)
