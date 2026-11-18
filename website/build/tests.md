---
title: Write tests
description: Run and extend the smoke tests shipped inside a generated SelfAuth project, add tests for your own protected routes with an in-memory store and a capturing mailer, for Node and for Go.
keywords: [tests, node:test, go test, smoke test, MemoryAuthStore, MemoryMailer, integration test, protected route test]
---

# Write tests

Every generated project comes with tests for its own authentication wiring. They run your real configuration, routes and app against an in-memory store and a mailer that just records messages, so they need no database and send no email. Extend them as you like.

## Run them

::: code-group

```bash [TypeScript]
npm test
```

```bash [Gin]
go vet ./... && go test ./...
```

:::

TypeScript projects use Node's built-in test runner (`node --test "test/**/*.test.ts"`), so there's no test framework to install.

Output (the end of the TypeScript report):

```text
# tests 6
# suites 1
# pass 6
# fail 0
```

## What the shipped tests check

In a TypeScript project, `test/auth.smoke.test.ts` checks that:

1. the health check answers;
2. an anonymous request for the current user is refused;
3. a state-changing request without the CSRF header is refused;
4. unknown routes are denied;
5. a weak password is rejected;
6. registering, verifying, signing in, reading the session and signing out all work end to end.

A Gin project has the equivalent in `internal/app/app_test.go` (register, sign in and out, CSRF modes, body limit, deny-by-default routes, production safety checks) and `internal/routes/routes_test.go` (`/api/hello` needs sign-in). The core has its own unit tests under `internal/auth/` and `internal/store/`.

## Test your own route (TypeScript)

The shipped test file builds the app like this, and it's the pattern to copy:

```ts
const config = localDevelopmentConfig(baseConfig);
const env = loadEnv({ NODE_ENV: "test", SELFAUTH_APP_BASE_URL: "http://localhost:5173" });
const mailer = new MemoryMailer();

before(async () => {
  const store = new MemoryAuthStore();
  await syncRoles(store, config);
  const auth = createAuth({
    config, store, mailer,
    appBaseUrl: env.appBaseUrl,
    nodeEnv: "test",
    requestId: getRequestId,
  });
  const server = createApp({ env, config, auth, mount: mountRoutes }).listen(0, "127.0.0.1");
  // ...
});
```

The pieces that matter:

| Piece | Why |
| --- | --- |
| `MemoryAuthStore` + `syncRoles` | A database-free store with your roles loaded |
| `MemoryMailer` | Keeps sent emails in an array, so a test can read the verification token (`mailer.lastTo(address)`) |
| `localDevelopmentConfig` | Allows plain `http` cookies |
| `listen(0, ...)` | Picks a free port so tests never clash |
| `Origin` and `X-SelfAuth-CSRF` headers | What a real same-origin browser sends; leave them out to test refusals |

Look at the `call()` helper and the full sign-in test in the file, copy what you need, and add a test next to them:

```ts
it("refuses anonymous access to /api/orders", async () => {
  const response = await call("GET", "/api/orders");
  assert.equal(response.status, 401);
  assert.equal(response.body?.error?.code, "UNAUTHENTICATED");
});
```

A permission test follows the same pattern. Register and verify a user (the token comes from `mailer.lastTo(EMAIL)`), sign in, call your route and expect `200`. Then expect `403` for a user without the permission.

## Test your own route (Go)

Read `internal/routes/routes_test.go` first. It builds the router for your routes and sends requests to it. Copy its setup and add your own cases in the same style:

```go
func TestOrdersRequireSignIn(t *testing.T) {
	// build the router exactly as TestHelloRequiresAuthentication does, then:
	req := httptest.NewRequest(http.MethodGet, "/api/orders", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
```

## What is already tested for you

The security rules inside `auth/core` (hashing, tokens, rate limits, session rotation) are tested by the 90 case conformance suite in the SelfAuth repository, against every backend and database. Your tests should focus on your own routes and rules. See [Conformance and support](/advanced/conformance).
