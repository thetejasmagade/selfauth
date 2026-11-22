# SelfAuth Next.js reference implementation

The TypeScript core of SelfAuth behind Next.js App Router route handlers. This is the application
that `selfauth init --backend next` copies from (ADR 0029), and the one the conformance suite holds
to all 90 cases on the in-memory, PostgreSQL, SQLite and MySQL stores (MongoDB in CI).

| Path | What it is |
| --- | --- |
| `src/auth/core`, `src/auth/stores` | The core and the stores: byte for byte the Express and Fastify copies (a test pins it) |
| `src/auth/next/index.ts` | The binding: takes a `Request`, returns a `Response`; CORS, session and CSRF run in that order |
| `src/app/auth/[[...path]]/route.ts` | Every `/auth` route |
| `src/app/api/` | Application routes (the notes example), each built with `withAuth` |
| `src/lib/auth.ts` | Starts SelfAuth on the first request; `withAuth` |
| `src/instrumentation.ts`, `src/lib/start.ts` | Start SelfAuth when the server boots; a production server that cannot start exits |
| `test/conformance` | Runs the language-neutral cases against the real route handlers |
| `test/e2e-server.ts` | Serves the built app for the browser suite (`apps/e2e`), with a capturing mailer |

```bash
pnpm --filter @selfauth/playground-next test          # unit and conformance (set TEST_DATABASE_URL for PostgreSQL)
pnpm --filter @selfauth/playground-next build         # needs no environment variables
SELFAUTH_APP_BASE_URL=http://localhost:3000 pnpm --filter @selfauth/playground-next dev
```

Route handlers cannot see the connection, so the client address comes from `X-Forwarded-For` and
`http.trustProxy` (see `src/config/selfauth.config.ts`).
