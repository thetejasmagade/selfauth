# 0028: A Python port of the core behind a Flask adapter, held to the same conformance suite

- Status: accepted
- Date: 2026-11-21

## Context

SelfAuth generates code into a project, with no runtime dependency on SelfAuth (ADR 0002, 0021).
Express and Fastify share one TypeScript core, and ADR 0027 added a Go port for Gin. Flask is a
Python framework: the core cannot be shared, so supporting it means a third implementation of every
rule, held to the same language-neutral specification and conformance suite (ADR 0007).

## Decision

- **A full port, not a stub.** `apps/playground-flask` contains the Python core (`app/auth`), the
  Flask binding (`app/flask_auth.py`) and the same set of stores as the other backends: memory,
  PostgreSQL (psycopg 3), MySQL (PyMySQL), SQLite (`sqlite3`) and MongoDB (PyMongo). It implements
  the same behavior as the TypeScript and Go cores, including the properties that are easy to lose
  in a port: per-account rate limits counted before hashing and atomically, single-use tokens by
  conditional consume, password hashing on every registration path, session rotation, and
  anti-enumeration behavior.
- **The suite is the acceptance test.** The conformance runner stays in TypeScript. A Python
  harness (`test/harness`) hosts one isolated application instance per case behind the control API
  the Go harness uses, and a small TypeScript driver adapts it to the `Driver` contract. All 90
  cases run on every store.
- **Layout.** An `app` package: `app/auth` imports nothing from Flask, `app/flask_auth.py` is the
  only HTTP-aware module, and the application owns `routes.py`, `mailer.py` and `store`. The
  configuration is a fully resolved `selfauth.config.json`, decoded strictly (unknown fields are
  errors) and validated for the bounds the code relies on. The server reads `.env` itself in
  development (the real environment always wins) and runs on Waitress.
- **One SQL store, three dialects.** PostgreSQL, MySQL and SQLite share `sqlstore.py`; what differs
  (how a time is stored, how a duplicate is ignored, how a unique violation is recognised, row
  locks, how a transaction begins) lives in `dialect.py`. The schema is the PostgreSQL migration
  with the MySQL and SQLite derivations of ADR 0025, applied by a small runner (`migrations.py`)
  with checksums and a lock, never at startup.
- **Composed, not templated.** `selfauth init --backend flask` copies the reference application and
  composes it per database (only that database's store, its driver in `requirements.txt` and its
  schema), and per frontend (`server/` + `client/` in an npm workspace, like Gin). There are no
  per-combination templates.
- **Environment.** Python projects use `APP_ENV` like Go projects.
- **Claimed level.** Authorization on every store, self-assessed, until the production profile is
  independently reviewed.

## Consequences

- A test written for the port found a real defect that the cases did not: Werkzeug folds `//` and
  redirects (`308`), which violates SEC-REDIRECT-001. Slash merging is now off and a test pins it.
- The store contract tests (`tests/test_store.py`) run against every reachable store and found that
  the in-memory store dropped roles that left the configuration while the database stores kept
  them; memory now behaves like the others.
- Three implementations must now stay in step. The conformance suite catches drift in what it
  covers; behaviour outside the cases is covered by each language's unit tests and review.
