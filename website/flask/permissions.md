---
title: "5. Add permissions"
description: Declare the notes permissions in selfauth.config.json, give them to the user and admin roles, seed them into the database, guard a route with require_permission and make an account an administrator.
keywords: [permissions, roles, rbac, admin, selfauth.config.json, require_permission, seed, create_admin, view_any]
---

# 5. Add permissions

Signed in or not is only the first question. The second is: *may this person do this?* SelfAuth answers that with permissions and roles.

- A **permission** is a name for one action, like `notes.create`.
- A **role** is a group of permissions. Users have roles, and roles have permissions.

| Permission | Means | Who gets it |
| --- | --- | --- |
| `notes.create` | Save a note | Every user |
| `notes.view` | Read your own notes | Every user |
| `notes.view_any` | Read everyone's notes | Admins only |

The `_any` ending is a SelfAuth convention for "the same action, on everyone's data, not just your own".

## Declare them

In `selfauth.config.json`, change the `authorization` section's `permissions` and `roles`:

```json
"permissions": ["notes.view", "notes.create", "notes.view_any"],
"roles": {
  "user": ["notes.view", "notes.create"],
  "admin": ["notes.view_any"]
},
```

Every new account gets the `user` role, and an administrator has `user` *and* `admin`. Check for typos, then write the roles to the database:

```bash
npx selfauth validate
python -m app.cmd.seed
```

Restart the server so it reads the new configuration.

## Guard a route with a permission

```python
    @app.get("/api/admin/ping")
    @auth.require_permission("notes.view_any")
    def admin_ping():
        return jsonify({"admin": True})
```

A permission that isn't in the configuration raises an error when the route is *defined*, so a typo can't become a silently open route.

## Make yourself an administrator

The first administrator can only be created by a command on the server, never through the API:

```bash
python -m app.cmd.create_admin maya@example.com
```

```text
maya@example.com is now an administrator.
```

The role is read on every request, so Maya's next call to `/api/admin/ping` works without signing in again; a regular user still gets `403 FORBIDDEN`.

## If something went wrong

- **`unknown permission 'notes.view_any'`.** It's not in `permissions`. Add it and restart.
- **`403` for an admin.** Run the seed again so the database matches the file.
- **`no active account with that email`.** Register and verify the account first.

Next: [Add a table and build the notes endpoints](./notes)
