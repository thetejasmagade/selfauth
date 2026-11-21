---
title: Server API (Python and Flask)
description: The Python API of the generated Flask code - Auth, route guards, protected groups, resource policies, owner_filter, the request context, the mailer, the store and the configuration.
keywords: [flask, python, flask_auth, require_auth, require_permission, authorize_resource, protected, ownership_policy, httpx.body]
---

# Server API (Python and Flask)

This is the API of the code `selfauth init --backend flask` puts in your project: `app/flask_auth.py` (the Flask adapter) and `app/auth/` (the core). It's your code, so you call it directly.

## Setup

`app/wsgi.py` already does this for you:

```python
auth = build_auth(config, env, stores.store, mailer, stores.rate_limit_store, logger)
app = create_app(config, auth, mount=lambda a, au: routes.register(a, au, stores.db))
```

`build_auth` refuses unsafe production settings, meaning an insecure cookie or an app base URL that isn't `https`. `create_app` builds the Flask app: request ids and logging, the JSON body limit, SelfAuth's CORS, session and CSRF hooks (in that order), `GET /health`, the `/auth` routes, and then your routes (`mount`). Errors, including `404` and `405`, use the standard envelope.

## `Auth` (`app/flask_auth.py`)

| Name | What it does |
| --- | --- |
| `auth.context()` | The signed-in context, or `None`. Has `user_id`, `roles`, `subject` (with `permissions` and `has(permission)`), `user` and `session` |
| `@auth.require_auth` | Guard: `401 UNAUTHENTICATED` without a valid session. Put it below the route decorator |
| `@auth.require_permission("x.y")` | Guard: `401` without a session, `403 FORBIDDEN` without the permission. Raises when the route is defined if the permission is not declared in the configuration |
| `@auth.authorize_resource(permission, resource_type, resource_id="id")` | Guard that runs the policy registered for the resource type. `resource_type` is a name or a function of the route's arguments; `resource_id` is the name of the URL parameter (or a function). A denied resource answers `404 NOT_FOUND`; a type with no policy answers `403` |
| `auth.protected(app_or_blueprint, "/prefix")` | A group where each route is denied unless a permission guard allowed it. Methods: `route`, `get`, `post`, `put`, `patch`, `delete`, each taking the rule and the guards |
| `auth.policies.register(type, policy)` | Registers a resource policy |
| `auth.service` | The framework-independent core behind the routes, for custom flows |

Only `require_permission` and `authorize_resource` count as authorization inside a protected group. `require_auth` on its own doesn't. See [Protect routes](/express/endpoints).

## Helpers in `app/auth`

| Name | Purpose |
| --- | --- |
| `ownership_policy(load)` | Policy: allows an action if the subject holds it and owns the resource, or holds the `<action>_any` permission. `load(resource_id)` must read from storage and return `None` when the resource does not exist |
| `owner_filter(subject, action)` | For list queries. Returns `(owner_id, all, ok)`: filter by `owner_id` unless `all`; `ok` is false when the subject holds neither permission |
| `Resource(type, id, owner_id)` | What `load` returns |
| `AuthError(code, message, details=None)` | Raise it for a SelfAuth error in the standard envelope. Codes are in `app/auth/errors.py`: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, … |
| `MemoryMailer`, `DevConsoleMailer` | Mailers for tests and development |
| `role_definitions(config)` | The role map the seed writes to the database |

## `app/httpx.py`

| Name | Purpose |
| --- | --- |
| `httpx.body()` | The JSON object already parsed by SelfAuth (an empty dict if none). Use it instead of `request.get_json()` |
| `httpx.error_response(code, message, details)` | Builds the standard error response |

## Configuration and environment (`app/config.py`)

| Name | Purpose |
| --- | --- |
| `Config.load(path)` / `Config.parse(text)` | Reads, strictly decodes and validates `selfauth.config.json` |
| `load_env(lookup=os.environ.get)` | Reads and validates the environment (`APP_ENV`, `PORT`, `SELFAUTH_APP_BASE_URL`, …). Reports every problem at once |
| `Env.production` | True when `APP_ENV=production` |

`app/env_file.py` loads `.env` in development; variables already set in the environment win.

## Stores (`app/store`)

`store.new(config, env)` opens the database from `adapter.database` when `DATABASE_URL` is set, and the in-memory store in development otherwise. In production without `DATABASE_URL` it raises. The stores implement `app.auth.store.Store` (and the rate-limit store), and the project's `tests/test_store.py` holds the shared tests every store passes.

`Stores.db` is your routes' handle on the same database, passed to `routes.register` as `db`: `db.sql` is a `Database` on PostgreSQL, MySQL and SQLite, `db.mongo` a PyMongo database on MongoDB. Both are `None` on the in-memory store. `db.sql` has `execute(sql, params)`, `query(sql, params)`, `query_one(sql, params)` and `transaction()`; write the SQL with `?` placeholders and it runs on all three databases, and use `db.sql.dialect.t(dt)` / `.read_time(value)` to convert times.

## Example: a guarded route

```python
def register(app, auth, db):
    @app.get("/api/me")
    @auth.require_auth
    def me():
        who = auth.context()
        return jsonify({"email": who.user.email, "roles": list(who.roles)})
```

The [Flask guide](/flask/) builds a complete example with its own table.
