---
title: "5. Add permissions"
description: Declare the notes permissions, give them to the user and admin roles, write them to the database with the seed, and make an account an administrator.
keywords: [permissions, roles, rbac, admin, selfauth.config.ts, db seed, create admin, view_any, next.js]
---

# 5. Add permissions

Signed in or not is only the first question. The second is: *may this person do this?* SelfAuth answers that with permissions and roles.

- A **permission** is a name for one action. You make up the names. The convention is `thing.action`.
- A **role** is a group of permissions. Users have roles, and roles have permissions.

The notes app needs three permissions:

| Permission | Means | Who gets it |
| --- | --- | --- |
| `notes.create` | Save a note | Every user |
| `notes.view` | Read your own notes | Every user |
| `notes.view_any` | Read everyone's notes | Admins only |

The `_any` ending is a SelfAuth convention for "the same action, on everyone's data, not just your own".

## Declare them

Open `src/config/selfauth.config.ts` and find the `authorization` section. Change `permissions` and `roles` to this:

```ts
"permissions": ["notes.view", "notes.create", "notes.view_any"],
"roles": {
  "user": ["notes.view", "notes.create"],
  "admin": ["notes.view_any"]
},
```

(If you generated the project with `--permissions notes.create,notes.view,notes.view_any`, the list is already there, and you only fill in `roles`.)

Every new account gets the `user` role (that's `defaultRoles`, just below). An administrator has the `user` role *and* the `admin` role, so admins can save and read their own notes too, plus read everyone's. You don't have to repeat `notes.view` and `notes.create` under `admin`.

The admin role also comes with SelfAuth's own permissions, like managing users and their roles. Those are built in, so they're not in your list.

Check you didn't misspell anything:

```bash
npx selfauth validate
```

If a role mentions a permission that isn't in the list, you'll see exactly which:

```text
  ✗ config authorization.roles.admin.0: role 'admin' references undefined permission 'notes.viewany'
```

## Write them to the database

The server reads roles from the database, not the file, so after every change to roles or permissions, run the seed, then **stop `npm run dev` and start it again**, because SelfAuth reads its configuration when the server starts:

```bash
npm run db:seed
```

```text
Synchronized roles: user, admin
```

## Check it worked

If you're still signed in as Maya, ask who you are:

```bash
curl "${H[@]}" localhost:3000/auth/me
```

```json
{"user":{"id":"cd6b5786-…","email":"maya@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":["notes.create","notes.view"]},"session":{…}}
```

Maya now has `notes.create` and `notes.view`. Changes to roles apply on the next request, so nobody has to sign in again.

## Make an administrator

Nobody can make themselves an admin through the API. The first administrator is made on the server, by someone with access to the database. Register a second account, Sam, and verify it the same way as in [chapter 2](./run-and-sign-in), using a second cookie file so you stay signed in as Maya:

```bash
A=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b admin-jar -c admin-jar)
curl "${A[@]}" localhost:3000/auth/register \
  -d '{"email":"sam@example.com","password":"another long password"}'
curl "${A[@]}" localhost:3000/auth/email/verify -d '{"token":"PASTE_SAMS_TOKEN"}'
```

Then make Sam an admin:

```bash
npm run db:create-admin -- sam@example.com
```

```text
sam@example.com is now an administrator.
```

The `--` passes the email through npm to the script. After that, other admins can be made through the [admin API](/reference/http), with no command line needed.

Sign Sam in:

```bash
curl "${A[@]}" localhost:3000/auth/login \
  -d '{"email":"sam@example.com","password":"another long password"}'
```

```json
{"user":{"id":"4c413aa8-…","email":"sam@example.com","emailVerified":true,"state":"active","roles":["admin","user"],"permissions":["auth.audit.read","auth.roles.assign","auth.roles.manage","auth.sessions.manage","auth.users.manage","auth.users.read","notes.create","notes.view","notes.view_any"]}}
```

Sam has both roles, and with them `notes.view_any`. You'll use Maya (`H`) and Sam (`A`) for the rest of the guide.

## If something went wrong

- **The permissions list is still empty.** You didn't run `npm run db:seed`, or you ran it in another folder.
- **`No active account with that email.`** Sam has to be registered *and* verified before `db:create-admin` works.
- **`Role 'user' is missing in the database`** when the server starts. Run the seed.
- **`Unknown permission 'notes.create'`** in the terminal when you call a notes route. The permission isn't in `selfauth.config.ts`, or the server wasn't restarted after you added it.

Next: [Add a table and the notes routes](./notes)
