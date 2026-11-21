---
"@selfauth/cli": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
---

Flask (Python) is a supported backend: `selfauth init --backend flask`. It is a Python port of the core behind a Flask adapter, held to the same 90 conformance cases as the other backends on every store (PostgreSQL via psycopg, MySQL via PyMySQL, SQLite via `sqlite3`, MongoDB via PyMongo, and in-memory), published at the authorization level. Any database, with or without a Vue or React frontend (`server/` + `client/`); the CLI composes the project from the parts you choose. `selfauth db`, `doctor`, `validate`, `diff` and `upgrade` work on Flask projects. `selfauth add` does not apply to Python. The configuration's `adapter.backend` and the manifest's `options.backend` accept `flask`.

A Flask project has a virtual environment and `requirements.txt`, runs with `python -m app.cmd.server`, migrates with `python -m app.cmd.migrate up` and reads `.env` itself in development. The docs have a Flask guide, a Python server reference and a Python Resend mailer.
