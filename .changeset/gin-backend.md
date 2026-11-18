---
"@selfauth/cli": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

Add a Gin (Go) backend. `selfauth init --backend gin` generates an API-only Go project (PostgreSQL via pgx, or the in-memory store): a Go port of the authentication core behind a Gin adapter, held to the same 90 conformance cases as Express and Fastify on both stores. `doctor`, `validate`, `diff`, `upgrade` and `db` work on it; `add` does not apply to Go. The configuration schema accepts `adapter.backend: "gin"` (with `orm: "none"`) and the manifest records the backend and the Go module path.
