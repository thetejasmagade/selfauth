---
title: "3. Find your way around"
description: A tour of the files in a generated Flask project, which ones are yours to change and which belong to SelfAuth.
keywords: [project structure, app/routes.py, selfauth.config.json, app/auth, flask_auth, mailer, requirements]
---

# 3. Find your way around

```text
app/
  cmd/                      server, migrate, seed, create_admin
  auth/                     SelfAuth's core: the rules, no HTTP (the tested security code)
  flask_auth.py             the Flask binding: cookies, CORS, CSRF, the /auth routes, guards
  store/                    data stores (memory and SQL)
  mailer.py                 plug in your email provider here
  routes.py                 your routes
  config.py, factory.py, wsgi.py, httpx.py   configuration, wiring, errors
db/migrations/              the database schema, as plain SQL
tests/                      pytest tests (no database needed)
selfauth.config.json        your authentication settings: roles, permissions, limits
requirements.txt            what the server installs
.env.example                copy to .env
selfauth.manifest.json      which files SelfAuth generated (doctor, diff, upgrade)
```

## What you'll edit

- **`app/routes.py`**: your endpoints. This is where most of your work happens.
- **`selfauth.config.json`**: roles, permissions and limits. Changing behaviour here is safer than changing code.
- **`app/mailer.py`**: the email provider, before production.
- **`db/migrations/`**: you add folders here for your own tables.
- **`tests/`**: yours to extend.

## What you'll mostly leave alone

`app/auth/` is the security core: hashing, sessions, tokens, rate limits, the rules. It's tested against the same 90 behaviour checks every SelfAuth backend passes, so edit it only if you must. `app/flask_auth.py` connects it to Flask. Both are readable on purpose. `npx selfauth doctor` and `npx selfauth diff` tell you if you changed generated files and what a newer SelfAuth would change.

## How a request flows

1. Flask receives it. Before your function runs, SelfAuth's hooks check CORS, read the session cookie and check CSRF.
2. Your function runs, wrapped by the guards you chose (`@auth.require_auth`, `@auth.require_permission("x.y")`).
3. Errors become the same JSON shape everywhere: `{"error": {"code": "...", "message": "..."}}`.

Next: [Add endpoints](./endpoints)
