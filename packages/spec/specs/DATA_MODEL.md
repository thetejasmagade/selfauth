# Logical data model

- **specVersion:** 0.1 (draft — open for review)

This is a **logical** model. Database adapters map it to native structures
(tables for PostgreSQL/Prisma, collections/embedded documents for
MongoDB/Mongoose). Physical names, types, and shapes may differ; behavior may
not.

Default physical names are prefixed `auth_` to avoid colliding with application
tables. The user entity name is configurable because applications often
already have a `users` table (integration with an existing user table is a
Phase 4 concern).

## Entities

Types: `id` = opaque identifier (UUIDv7 recommended); `timestamp` = UTC instant;
`hash` = hex/base64 digest string.

### User — default `auth_users`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK, immutable |
| email | string ≤ 254 | as entered (trimmed); nullable after deletion |
| emailNormalized | string ≤ 254 | **unique among non-deleted users**; nullable after deletion |
| emailVerifiedAt | timestamp? | |
| state | enum `pending, active, suspended, disabled, deleted` | |
| createdAt, updatedAt | timestamp | |
| deletedAt | timestamp? | set when state = deleted |

### Credential — `auth_credentials`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK |
| userId | id | FK → User, cascade on user hard-delete |
| type | enum `password` | (future: `totp`, `webauthn`) unique per (userId, type) for `password` |
| secretHash | string | PHC string; never exposed |
| createdAt, updatedAt | timestamp | |

### Session — `auth_sessions`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK (public handle used to list/revoke; **not** the token) |
| tokenHash | hash | unique, indexed |
| userId | id | FK → User, indexed |
| createdAt, lastSeenAt | timestamp | |
| idleExpiresAt, absoluteExpiresAt | timestamp | indexed for purging |
| revokedAt | timestamp? | |
| revokedReason | enum? `logout, logout_all, password_changed, password_reset, state_changed, admin, rotated` | |
| ipAddress, userAgent | string? | informational only |
| reauthenticatedAt | timestamp? | for recent-auth checks |

### Role — `auth_roles`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK |
| name | string | unique |
| description | string? | |
| isSystem | boolean | `admin`, `user` are system roles |

### Permission — `auth_permissions`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK |
| name | string | unique; format per AUTHZ-PERM-001 |
| description | string? | |

### UserRole — `auth_user_roles`

`(userId, roleId)` composite unique; `assignedAt`, `assignedBy?`.

### RolePermission — `auth_role_permissions`

`(roleId, permissionId)` composite unique.

### PasswordResetToken — `auth_password_reset_tokens`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK |
| userId | id | FK, indexed |
| tokenHash | hash | unique |
| expiresAt | timestamp | |
| usedAt | timestamp? | consume = conditional update `WHERE usedAt IS NULL AND expiresAt > now` |
| invalidatedAt | timestamp? | set when superseded or revoked |
| createdAt | timestamp | |

### EmailVerificationToken — `auth_email_verification_tokens`

As PasswordResetToken, plus `email` (normalized address the token was issued
for; must equal the user's current `emailNormalized` at use).

### SecurityEvent — `auth_security_events`

| Field | Type | Constraints |
| --- | --- | --- |
| id | id | PK |
| type | string | e.g. `auth.login.failed` |
| outcome | enum `success, failure` | |
| occurredAt | timestamp | indexed |
| userId, actorId | id? | not FKs (events outlive users) |
| ipAddress, userAgent, requestId | string? | |
| metadata | JSON object | redacted per SEC-AUDIT-003 |

### Not modeled here

- **Rate-limit counters** — an adapter concern (memory, Redis, or a table); see
  SEC-RATE-006.
- **MFA, OAuth accounts, passkeys, API tokens** — see
  [OPTIONAL_CAPABILITIES](OPTIONAL_CAPABILITIES.md).

## Mapping rules

- **[DATA-MODEL-001]** (MUST) Database adapters MUST enforce, in the database,
  the uniqueness constraints marked above (normalized email among non-deleted
  users, token hashes, session token hash, role and permission names, join
  pairs).
- **[DATA-MODEL-002]** (MUST) One-time token consumption and session revocation
  MUST be atomic at the database level (conditional update or transaction), so
  concurrent requests cannot both succeed.
- **[DATA-MODEL-003]** (MUST) Schema changes MUST be delivered as native
  migration files in the application repository; adapters MUST NOT change the
  schema at application startup.
- **[DATA-MODEL-004]** (MUST NOT) Adapters MUST NOT modify or drop tables,
  collections, columns, or indexes they do not own (per the SelfAuth manifest)
  without explicit developer approval.
- **[DATA-MODEL-005]** (SHOULD) Document databases MAY embed `UserRole` in the
  user document and `RolePermission` in the role document; they SHOULD keep
  credentials and sessions in separate collections.
