---
title: "4. Add endpoints"
description: Add a public endpoint and a signed-in endpoint to a Flask SelfAuth project with require_auth, and read the current user in your handler.
keywords: [flask route, require_auth, auth.context, public endpoint, protected endpoint, jsonify, 401]
---

# 4. Add endpoints

Open `app/routes.py`. The `register` function receives the Flask `app`, SelfAuth's `auth` and `db`, your database. It already has one route, `/api/hello`.

## A public endpoint

Anyone can call a route with no guard. Add inside `register`:

```python
    @app.get("/api/ping")
    def ping():
        return jsonify({"pong": True})
```

## A signed-in endpoint

Put `@auth.require_auth` **below** the route decorator. It answers `401 UNAUTHENTICATED` when there is no valid session. Inside, `auth.context()` is the signed-in user:

```python
    @app.get("/api/me/summary")
    @auth.require_auth
    def summary():
        who = auth.context()
        return jsonify({"email": who.user.email, "roles": list(who.subject.roles)})
```

Restart the server (`Ctrl-C`, then `python -m app.cmd.server`) and try it:

```bash
curl -s localhost:3000/api/ping
curl -s localhost:3000/api/me/summary
curl -s -b jar localhost:3000/api/me/summary
```

```text
{"pong":true}
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"…"}}
{"email":"maya@example.com","roles":["user"]}
```

## A safer default: a protected group

Forgetting a guard on a new route is the classic mistake. `auth.protected(app, "/api/orders")` gives you a group where **every route is denied unless a permission guard allows it**. A route without a guard can't be reached by accident:

```python
    orders = auth.protected(app, "/api/orders")

    @orders.get("")                       # no guard: always answers 403
    def list_orders():
        return jsonify({"orders": []})
```

The next chapter adds the permission that opens it.

## If something went wrong

- **`404 NOT_FOUND`.** A typo in the path, or the server wasn't restarted.
- **`TypeError: 'NoneType' object has no attribute 'user'`.** You used `auth.context()` in a route with no guard: it is `None` when nobody is signed in. Add `@auth.require_auth`.
- **The route works without signing in.** The decorator order matters: `@app.get(...)` first (above), `@auth.require_auth` second.

Next: [Add permissions](./permissions)
