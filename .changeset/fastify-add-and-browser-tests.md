---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

`selfauth add` now works on existing Fastify projects, and the browser tests run against Fastify.

- `add` and `detect` recognise Fastify (`--backend fastify` overrides when both frameworks are
  dependencies), write the same `<src>/selfauth/` folder and a Fastify `setup.ts`, and print the
  Fastify wiring: `Fastify({ ...selfAuthServerOptions() })`, `await setupSelfAuth(app)`,
  `app.setErrorHandler(selfauth.errorHandler)`. `selfAuthServerOptions()` carries the body limit,
  trusted-proxy setting and request-id rule, which Fastify only accepts when the app is created.
- The Playwright suite runs the Vue and React frontends against both the Express and the Fastify
  backends (24 tests).
