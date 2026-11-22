---
title: "9. Test your routes"
description: Run the tests that come with a Next.js SelfAuth project, then add tests for the notes routes against a separate test database, covering sign-in, ownership, validation and the admin permission, by calling your route handlers directly.
keywords: [node test runner, npm test, integration test, test database, next.js tests, route handler test, MemoryMailer]
---

# 9. Test your routes

You've checked everything by hand with curl. Tests do the same checks for you, every time you change something, in about a second.

## The tests you already have

```bash
npm test
```

```text
# tests 7
# suites 1
# pass 7
# fail 0
```

They live in `test/auth.smoke.test.ts` and check that your project's wiring is right: the health check answers, anonymous requests are refused, the CSRF check works, `/api/hello` is protected, and a user can register, verify, sign in and sign out. They use an in-memory store, so they need no database.

They use Node's built-in test runner, so there's nothing to install, and they don't start a server. A Next.js route handler is just a function that takes a `Request` and returns a `Response`, so the tests import your `route.ts` files and call them. That's the same code Next.js runs, without the network.

## How the tests reach SelfAuth

Your route handlers ask for SelfAuth through `withAuth`, which looks for an instance in one place: `globalThis[Symbol.for("selfauth.instance")]`. A test puts its own instance there (with a memory store or a test database, and a mailer that keeps emails in memory) *before* it imports the route files. That's all the smoke test does, and you can read it in a few lines.

## Test the notes

The notes need a real database, so these tests use their own: a SQLite file called `test.db`, rebuilt from your migrations on every run. Your development data in `app.db` is never touched.

Create `test/notes.test.ts`:

```ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { createAuth, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { createPrismaClient, PrismaAuthStore } from "../src/auth/stores/prisma.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { config as baseConfig } from "../src/config/selfauth.config.ts";

/**
 * Tests for the notes routes, against a real database: a separate SQLite file, test.db,
 * rebuilt from your migrations on every run. Set TEST_DATABASE_URL to use another database
 * (never your development or production one).
 */
const url = process.env["TEST_DATABASE_URL"] ?? "file:./test.db";
const config = localDevelopmentConfig(baseConfig);
const mailer = new MemoryMailer();
const base = new URL("http://localhost:3000");
const PASSWORD = "correct horse battery staple";

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;
// Each route file exports one handler per HTTP method.
let routes: Record<"auth" | "notes" | "note" | "admin", Record<string, Handler>>;
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
  const auth = createAuth({ config, store, mailer, appBaseUrl: base, nodeEnv: "test" });
  // Your route handlers use whatever SelfAuth instance is registered here.
  (globalThis as Record<symbol, unknown>)[Symbol.for("selfauth.instance")] = Promise.resolve({
    auth,
    db,
  });
  routes = {
    auth: await import("../src/app/auth/[[...path]]/route.ts"),
    notes: await import("../src/app/api/notes/route.ts"),
    note: await import("../src/app/api/notes/[id]/route.ts"),
    admin: await import("../src/app/api/admin/notes/route.ts"),
  } as never;
  close = () => db.$disconnect();
});
after(() => close());

interface Reply {
  status: number;
  body: { notes?: { text: string }[]; note?: { id: string }; error?: { code: string } } | null;
  cookie: string;
}

/** Calls one of your route handlers the way Next.js would. */
async function call(
  route: keyof typeof routes,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; params?: Record<string, string> } = {},
): Promise<Reply> {
  const response = await routes[route][method]!(
    new Request(`${base.origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
        "X-SelfAuth-CSRF": "1",
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Reply["body"]) : null,
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .join("; "),
  };
}

/** Registers, verifies and signs in a new user; returns their session cookie. */
async function signUp(email: string): Promise<string> {
  await call("auth", "POST", "/auth/register", { body: { email, password: PASSWORD } });
  await call("auth", "POST", "/auth/email/verify", { body: { token: mailer.lastTo(email)!.token } });
  const login = await call("auth", "POST", "/auth/login", { body: { email, password: PASSWORD } });
  return login.cookie;
}

describe("notes", () => {
  it("refuses anyone who isn't signed in", async () => {
    const reply = await call("notes", "GET", "/api/notes");
    assert.equal(reply.status, 401);
  });

  it("saves a note and lists only the owner's notes", async () => {
    const maya = await signUp(`maya-${Date.now()}@example.test`);
    const other = await signUp(`other-${Date.now()}@example.test`);

    const saved = await call("notes", "POST", "/api/notes", { cookie: maya, body: { text: "Buy milk" } });
    assert.equal(saved.status, 201);
    await call("notes", "POST", "/api/notes", { cookie: other, body: { text: "Not Maya's" } });

    const list = await call("notes", "GET", "/api/notes", { cookie: maya });
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body?.notes?.map((n) => n.text),
      ["Buy milk"],
    );
  });

  it("hides other people's notes", async () => {
    const maya = await signUp(`owner-${Date.now()}@example.test`);
    const other = await signUp(`snoop-${Date.now()}@example.test`);
    const saved = await call("notes", "POST", "/api/notes", { cookie: maya, body: { text: "Private" } });
    const id = saved.body!.note!.id;

    const path = `/api/notes/${id}`;
    assert.equal((await call("note", "GET", path, { cookie: maya, params: { id } })).status, 200);
    assert.equal((await call("note", "GET", path, { cookie: other, params: { id } })).status, 404);
  });

  it("rejects an empty note", async () => {
    const maya = await signUp(`empty-${Date.now()}@example.test`);
    const reply = await call("notes", "POST", "/api/notes", { cookie: maya, body: { text: "  " } });
    assert.equal(reply.status, 400);
    assert.equal(reply.body?.error?.code, "VALIDATION_FAILED");
  });

  it("keeps the admin list for admins", async () => {
    const maya = await signUp(`notadmin-${Date.now()}@example.test`);
    const reply = await call("admin", "GET", "/api/admin/notes", { cookie: maya });
    assert.equal(reply.status, 403);
  });
});
```

What's going on:

- **`before`** builds SelfAuth once, as `src/lib/auth.ts` does, but on the test database, with `MemoryMailer` instead of real email, and registers it for your route handlers. `MemoryMailer` keeps every email in memory, so `mailer.lastTo(email)` hands you the verification token without anyone reading a terminal.
- **`call`** builds a `Request` and hands it to one route handler, with the `params` Next.js would give a `[id]` folder.
- **`signUp`** does what you did with curl in chapter 2: register, verify, sign in. It returns the session cookie.
- **Each test** uses fresh email addresses, so tests never trip over each other's data.
- **The second and third tests are the important ones.** They prove that one user can't see another's notes, in the list or by id. If someone later "simplifies" the query and drops the `where`, the second test fails.

## Run them

```bash
npm test
```

```text
# tests 12
# suites 2
# pass 12
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

Break something on purpose. In `src/app/api/notes/route.ts`, remove the `where: { ownerId: … }` line from the list query and run `npm test` again. The ownership test fails:

```text
    not ok 2 - saves a note and lists only the owner's notes
```

Put it back. That's what the test is for.

## What you don't need to test

The security rules inside `src/auth/` (password hashing, session expiry, rate limits, CSRF) are covered by SelfAuth's own suite of 90 security checks, run against every backend and database. Spend your tests on your own rules: who may do what, and what each route accepts.

The pages aren't covered by these tests. To test them in a browser, use a tool such as [Playwright](https://playwright.dev) against `npm run dev`; SelfAuth's own repository does exactly that for its Next.js pages.

## If something went wrong

- **`before` fails with an error from `prisma migrate deploy`.** Run `npx prisma migrate deploy` with `DATABASE_URL=file:./test.db` yourself to see the message. Usually a migration has a mistake in it.
- **`Cannot read properties of undefined (reading 'token')`.** The email address in `signUp` doesn't match. `mailer.lastTo` looks up the exact address.
- **`SelfAuth could not start` in the test output.** The instance wasn't registered before the route files were imported. Keep the `globalThis` line above the `import(...)` calls.
- **The tests pass but take a long time.** Password hashing is deliberately slow. That's fine for a handful of users. Don't create hundreds in a test.

Next: [Get ready for production](./production)
