# Authorization specification

- **specVersion:** 0.1 (draft — open for review)
- **Related:** [AUTHENTICATION_SPEC](AUTHENTICATION_SPEC.md) ·
  [DATA_MODEL](DATA_MODEL.md) · [ERRORS](ERRORS.md)

The MVP model is **role-based access control (RBAC)** with explicit,
project-defined permissions, plus a **resource-policy** hook for ownership and
resource-level decisions. Complex policy engines (ABAC, ReBAC, policy
languages) are deferred.

## 1. Core rules

- **[AUTHZ-CORE-001]** (MUST) Authorization MUST be **deny by default**: an
  operation is permitted only if an explicit rule grants it. A protected
  operation with no rule configured MUST be denied.
- **[AUTHZ-CORE-002]** (MUST) Every protected backend operation MUST perform an
  authorization check on the server, on every request.
- **[AUTHZ-CORE-003]** (MUST) Authorization decisions MUST be computed from
  server-side state (the session's user, their roles, role permissions, and the
  resource), never from client-supplied role, permission, or ownership claims.
- **[AUTHZ-CORE-004]** (MUST) Frontend permission state is a UX hint only.
  Bypassing every frontend check MUST NOT grant access to any protected backend
  operation.
- **[AUTHZ-CORE-005]** (MUST) A request without a valid session to a protected
  operation MUST fail with `UNAUTHENTICATED`; an authenticated request lacking
  permission MUST fail with `FORBIDDEN`, except where [AUTHZ-RES-004] applies.
- **[AUTHZ-CORE-006]** (MUST) Changes to a user's roles or to a role's
  permissions MUST take effect no later than the user's next request.
  Implementations MAY cache within a single request only.

## 2. Permissions

- **[AUTHZ-PERM-001]** (MUST) A permission is a string of two or more
  dot-separated segments, each matching `[a-z][a-z0-9_]*`
  (e.g. `orders.view`, `billing.invoices.refund`). Other strings MUST be
  rejected when configured.
- **[AUTHZ-PERM-002]** (MUST) Projects define their own permissions in
  configuration. The `auth.` prefix is reserved for system permissions (§5) and
  MUST NOT be used for project permissions.
- **[AUTHZ-PERM-003]** (MUST NOT) Wildcards, prefix matching, or negative
  ("deny") permissions MUST NOT be supported in this spec version. A check for
  `orders.view` is satisfied only by `orders.view`.
- **[AUTHZ-PERM-004]** (MUST) Checking a permission that is not defined in
  configuration MUST be treated as an error at startup or registration time
  (fail fast), not silently denied or allowed at request time.

## 3. Roles (RBAC)

- **[AUTHZ-RBAC-001]** (MUST) A role MUST have a unique name
  (`[a-z][a-z0-9_-]*`) and a set of permissions. A user has zero or more roles.
- **[AUTHZ-RBAC-002]** (MUST) A user's **effective permissions** MUST be exactly
  the union of the permissions of all roles assigned to them.
- **[AUTHZ-RBAC-003]** (MUST) Newly registered users MUST receive only the
  configured default role(s) (default: `user`, which has no permissions unless the project
  grants them).
- **[AUTHZ-RBAC-004]** (MUST) A system role `admin` MUST exist holding all `auth.*`
  system permissions. Projects MAY grant it project permissions too.
- **[AUTHZ-RBAC-005]** (MUST) Role definitions from configuration MUST be
  synchronized to storage by an explicit, reviewable step (seed or migration),
  never implicitly on application startup in production.

## 4. Resource-level authorization

The resource-policy contract:

```text
authorize(subject, action, resource) → allow | deny
  subject  : { userId, roles, permissions }   (from the session, server-side)
  action   : permission string, e.g. "orders.view"
  resource : { type, id, ownerId?, ...attributes loaded server-side }
```

- **[AUTHZ-RES-001]** (MUST) Implementations MUST provide an `authorize`
  function (or equivalent) implementing the contract above, where
  application code registers a policy per resource type.
- **[AUTHZ-RES-002]** (MUST) If no policy is registered for a resource type,
  `authorize` MUST deny.
- **[AUTHZ-RES-003]** (MUST) Resource attributes used for decisions (owner,
  tenant, status) MUST be loaded server-side from storage, not taken from the
  request body, query, or headers.
- **[AUTHZ-RES-004]** (SHOULD) When a subject may not even know a resource
  exists, the operation SHOULD fail with `NOT_FOUND` rather than `FORBIDDEN`,
  consistently for existing and non-existing IDs.
- **[AUTHZ-RES-005]** (MUST) The built-in ownership helper MUST allow an action
  only if the subject holds the permission **and** `resource.ownerId` equals
  `subject.userId`; holding the corresponding `*_any` permission
  (e.g. `orders.view_any`), when the project defines one, allows the action
  regardless of owner.
- **[AUTHZ-RES-006]** (MUST) List/query operations MUST apply authorization as a
  filter (e.g. "only rows owned by subject"), not by fetching all rows and
  hiding some in the presentation layer.

## 5. Administrative operations

System permissions:

| Permission | Allows |
| --- | --- |
| `auth.users.read` | View any user's account data (not credentials) |
| `auth.users.manage` | Suspend, disable, re-activate, or delete users |
| `auth.sessions.manage` | List and revoke other users' sessions |
| `auth.roles.assign` | Assign/remove roles to/from users |
| `auth.roles.manage` | Create/modify roles and their permissions |
| `auth.audit.read` | Read security events |

- **[AUTHZ-ADMIN-001]** (MUST) Every administrative operation MUST require its
  system permission and MUST record a security event identifying actor, target,
  and change.
- **[AUTHZ-ADMIN-002]** (MUST) Assigning a role MUST require `auth.roles.assign`.
  An actor MUST NOT be able to assign a role that grants a permission the actor
  does not hold (no privilege escalation by delegation).
- **[AUTHZ-ADMIN-003]** (MUST) The system MUST prevent removing the `admin` role
  from, or suspending/disabling/deleting, the last active user holding it.
- **[AUTHZ-ADMIN-004]** (SHOULD) Administrative operations SHOULD require recent
  authentication (password re-entry within the last 15 minutes), failing with
  `REAUTHENTICATION_REQUIRED` otherwise.
- **[AUTHZ-ADMIN-005]** (MUST NOT) Operations reachable by an unauthenticated
  client, including registration, MUST NOT grant roles or system
  permissions; the first administrator is created through an explicit,
  developer-run command or seed.
- **[AUTHZ-ADMIN-006]** (MUST) Suspending, disabling, or deleting a user through
  an admin operation MUST revoke the user's sessions ([IDENT-STATE-003]).

## 6. Security events for authorization

- **[AUTHZ-AUDIT-001]** (MUST) Role assignment, role removal, and role
  permission changes MUST be recorded as security events.
- **[AUTHZ-AUDIT-002]** (SHOULD) Denied authorization decisions SHOULD be
  recorded (`authz.denied`), with sampling or rate limiting to avoid log
  flooding.
