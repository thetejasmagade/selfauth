---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

Fastify is a second backend: `selfauth init --backend fastify` (API only, or full-stack with a Vue or React client) generates a Fastify 5 project with the same core, stores, tests and frontends as the Express one, behind a Fastify adapter in `src/auth/fastify/`. All 87 conformance cases pass on it with the in-memory store and with PostgreSQL; it is published at the authorization level (production-profile review is pending). The configuration schema accepts `adapter.backend: "fastify"`, the manifest records `options.backend`, `upgrade`/`doctor`/`validate` work on Fastify projects, and there are manual templates `fastify/`, `fastify-vue/` and `fastify-react/`. `selfauth add` (existing projects) still supports Express only; `detect` and `add` point Fastify apps to `init --backend fastify`. The generated Fastify server listens on `HOST` (default `0.0.0.0`).
