---
title: "10. Test your endpoints"
description: Run the tests that come with a Fastify SelfAuth project, then add tests for the notes endpoints against a separate test database, covering sign-in, ownership, validation and the admin permission.
keywords: [node test runner, npm test, integration test, test database, fastify tests, MemoryMailer]
---

# 10. Test your endpoints

You've checked everything by hand with curl. Tests do the same checks for you, every time you change something, in about a second.

## The tests you already have

```bash
npm test
```

```text
# tests 6
# suites 1
# pass 6
# fail 0
```

They live in `test/auth.smoke.test.ts` and check that your project's wiring is right: the health check answers, anonymous requests are refused, the CSRF check works, and a user can register, verify, sign in and sign out. They use an in-memory store, so they need no database.

They use Node's built-in test runner, so there's nothing to install.

## Test the notes

The notes need a real database, so these tests use their own: a SQLite file called `test.db`, rebuilt from your migrations on every run. Your development data in `app.db` is never touched.

Create `test/notes.test.ts`:

```ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { createAuth, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { createPrismaClient, PrismaAuthStore } from "../src/auth/stores/prisma.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { loadEnv } from "../src/config/env.ts";
import { config as baseConfig } from "../src/config/selfauth.config.ts";
import { getRequestId } from "../src/http/request-id.ts";
import { mountRoutes } from "../src/routes/index.ts";

/**
 * Tests for the notes endpoints, against a real database: a separate SQLite file, test.db,
 * rebuilt from your migrations on every run. Set TEST_DATABASE_URL to use another database
 * (never your development or production one).
 */
const url = process.env["TEST_DATABASE_URL"] ?? "file:./test.db";
const config = localDevelopmentConfig(baseConfig);
const env = loadEnv({ NODE_ENV: "test", SELFAUTH_APP_BASE_URL: "http://localhost:5173" });
const mailer = new MemoryMailer();
const PASSWORD = "correct horse battery staple";

let baseUrl = "";
let close: () => Promise<void>;

before(async () => {
  if (url === "file:./test.db") rmSync("test.db", { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  const db = createPrismaClient({ connectionString: url });
  const store = new PrismaAuthStore(db);
  await syncRoles(store, config);
  const auth = createAuth({
    config,
    store,
    mailer,
    appBaseUrl: env.appBaseUrl,
    nodeEnv: "test",
    requestId: getRequestId,
  });
  const app = createApp({ env, config, auth, mount: (app, a) => mountRoutes(app, a, db) });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  close = async () => {
    await app.close();
    await db.$disconnect();
  };
});
after(() => close());

interface Reply {
  status: number;
  body: { notes?: { text: string }[]; error?: { code: string } } | null;
  cookies: string[];
}

async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: env.appBaseUrl.origin,
      "X-SelfAuth-CSRF": "1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json().catch(() => null)) as Reply["body"];
  const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]!);
  return { status: response.status, body: json, cookies };
}

/** Registers, verifies and signs in a new user; returns their session cookie. */
async function signUp(email: string): Promise<string> {
  await call("POST", "/auth/register", { email, password: PASSWORD });
  await call("POST", "/auth/email/verify", { token: mailer.lastTo(email)!.token });
  const login = await call("POST", "/auth/login", { email, password: PASSWORD });
  return login.cookies.join("; ");
}

describe("notes", () => {
  it("refuses anyone who isn't signed in", async () => {
    const reply = await call("GET", "/api/notes");
    assert.equal(reply.status, 401);
  });

  it("saves a note and lists only the owner's notes", async () => {
    const maya = await signUp(`maya-${Date.now()}@example.test`);
    const other = await signUp(`other-${Date.now()}@example.test`);

    const saved = await call("POST", "/api/notes", { text: "Buy milk" }, maya);
    assert.equal(saved.status, 201);
    await call("POST", "/api/notes", { text: "Not Maya's" }, other);

    const list = await call("GET", "/api/notes", undefined, maya);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body?.notes?.map((n) => n.text),
      ["Buy milk"],
    );
  });

  it("hides other people's notes", async () => {
    const maya = await signUp(`owner-${Date.now()}@example.test`);
    const other = await signUp(`snoop-${Date.now()}@example.test`);
    const saved = await call("POST", "/api/notes", { text: "Private" }, maya);
    const id = (saved.body as { note: { id: string } }).note.id;

    assert.equal((await call("GET", `/api/notes/${id}`, undefined, maya)).status, 200);
    assert.equal((await call("GET", `/api/notes/${id}`, undefined, other)).status, 404);
  });

  it("rejects an empty note", async () => {
    const maya = await signUp(`empty-${Date.now()}@example.test`);
    const reply = await call("POST", "/api/notes", { text: "  " }, maya);
    assert.equal(reply.status, 400);
    assert.equal(reply.body?.error?.code, "VALIDATION_FAILED");
  });

  it("keeps the admin list for admins", async () => {
    const maya = await signUp(`notadmin-${Date.now()}@example.test`);
    const reply = await call("GET", "/api/admin/notes", undefined, maya);
    assert.equal(reply.status, 403);
  });
});
```

What's going on:

- **`before`** builds the app once, exactly as `src/server.ts` does, but on the test database, with `MemoryMailer` instead of real email. `MemoryMailer` keeps every email in memory, so `mailer.lastTo(email)` hands you the verification token without anyone reading a terminal.
- **`signUp`** does what you did with curl in chapter 2: register, verify, sign in. It returns the session cookie.
- **Each test** uses fresh email addresses, so tests never trip over each other's data.
- **The second and third tests are the important ones.** They prove that one user can't see another's notes, in the list or by id. If someone later "simplifies" the query and drops the `where`, the second test fails.

## Run them

```bash
npm test
```

```text
# tests 11
# suites 2
# pass 11
# fail 0
```

`test.db` is in `.gitignore`, along with your other SQLite files.

::: details PostgreSQL, MySQL or MongoDB
Create a separate, empty database for tests and point `TEST_DATABASE_URL` at it:

```bash
TEST_DATABASE_URL=postgresql://postgres:secret@localhost:5432/notes_test npm test
```

Never point it at your development or production database: the tests write to it. With MongoDB, replace the Prisma lines in `before` with `createMongooseConnection(url).asPromise()` and `MongooseAuthStore`, from `src/auth/stores/mongoose.ts`, and run `npm run db:migrate` against the test database once to create the indexes.
:::

## Check it worked

Break something on purpose. In `src/routes/notes.ts`, remove the `where: { ownerId: … }` line from the list query and run `npm test` again. The ownership test fails:

```text
    not ok 2 - saves a note and lists only the owner's notes
```

Put it back. That's what the test is for.

## What you don't need to test

The security rules inside `src/auth/` (password hashing, session expiry, rate limits, CSRF) are covered by SelfAuth's own suite of 90 security checks, run against every backend and database. Spend your tests on your own rules: who may do what, and what each endpoint accepts.

## If something went wrong

- **`before` fails with an error from `prisma migrate deploy`.** Run `npx prisma migrate deploy` with `DATABASE_URL=file:./test.db` yourself to see the message. Usually a migration has a mistake in it.
- **`Cannot read properties of undefined (reading 'token')`.** The email address in `signUp` doesn't match. `mailer.lastTo` looks up the exact address.
- **The tests pass but take a long time.** Password hashing is deliberately slow. That's fine for a handful of users. Don't create hundreds in a test.

Next: [Get ready for production](./production)
