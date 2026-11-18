---
title: Data retention
description: What account deletion removes and keeps in a SelfAuth project, how long security events live, and the SQL you can run to purge old data. Applies to the TypeScript and Go projects.
keywords: [data retention, delete account, gdpr, privacy, tombstone, security events, purge, backups]
---

# Data retention

SelfAuth is code in your project, so retention is **your decision**. This page describes what your copy does until you change it. Nothing here is legal advice.

## What deleting an account does

An account is deleted by the user (`POST /auth/account/delete`) or by an administrator setting the state to `deleted`. Both run the same code (`deleteUser` in `service.ts`).

| Data | After deletion |
| --- | --- |
| Email address (`email`, `email_normalized`) | **Cleared.** The address can be registered again |
| Password hash (`auth_credentials`) | **Deleted** |
| Sessions | **Revoked.** The rows stay, holding only a token hash and a revocation reason |
| Verification and reset tokens | **Invalidated.** The rows stay, holding only token hashes |
| User row (`auth_users`) | **Kept as a tombstone**: id, `state = deleted`, `created_at`, `updated_at`, `deleted_at`, `email_verified_at` |
| Role assignments (`auth_user_roles`) | **Kept** with the tombstone |
| Security events (`auth_security_events`) | **Kept**, including `user_id`, IP address, user agent and request id |

The tombstone and the events keep the audit trail meaningful: who did what, and when an account was removed. After deletion they contain **no email address**.

## For how long

**Until you delete them.** SelfAuth never purges anything on its own, and there is no retention setting. Choose a period that fits your obligations and run the deletion yourself, for example from a scheduled job:

```sql
-- security events older than 12 months
DELETE FROM auth_security_events WHERE occurred_at < now() - interval '12 months';
-- tombstones of accounts deleted more than 12 months ago
DELETE FROM auth_users WHERE state = 'deleted' AND deleted_at < now() - interval '12 months';
```

(PostgreSQL syntax; adapt the interval for other databases.) Deleting a tombstone cascades to its role assignments, sessions and tokens. Security-event rows are not linked by a foreign key, so they stay unless you purge them as above. Run these statements in a job you own: they touch tables SelfAuth owns, and `selfauth db plan` does not generate them.

## Backups

Deleted data survives in your database backups until they expire. The generated code cannot change that.

## Your own data

Your own tables are your responsibility. If they reference `auth_users(id)` with `ON DELETE CASCADE` (as in [Change the database](/build/database-changes)), they are removed when a tombstone is purged, **not** when the account is deleted. If you must erase personal data in your own tables at deletion time, do it in your own code before or after calling the deletion.

## Next

- [Coding agents](./agents)
