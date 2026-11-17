<!-- Generated from docs/data-retention.md by skills/scripts/sync-references.mjs. Do not edit; edit the guide. -->

# Data retention after account deletion

Required by IDENT-DELETE-005. This describes the Express reference
implementation (PostgreSQL and in-memory stores) and what your copy of it does
until you change it. SelfAuth is code in your project, so retention is your
decision. Nothing here is legal advice.

## What deleting an account does

Deleting an account (`POST /auth/account/delete`, or an administrator setting the state
to `deleted`) runs one code path, `deleteUser` in `src/auth/core/service.ts`:

| Data | After deletion |
| --- | --- |
| Email address (`email`, `email_normalized`) | **Cleared.** The address is free to register again (IDENT-EMAIL-003). |
| Password hash (`auth_credentials`) | **Deleted.** |
| Sessions | **Revoked.** The rows stay, holding only a token hash and revocation reason. |
| Verification and reset tokens | **Invalidated.** The rows stay, holding only token hashes. |
| User row (`auth_users`) | **Kept as a tombstone**: id, `state = deleted`, `created_at`, `updated_at`, `deleted_at`, `email_verified_at`. |
| Role assignments (`auth_user_roles`) | **Kept** with the tombstone. |
| Security events (`auth_security_events`) | **Kept**, including `user_id`, IP address, user agent and request ID. |

The tombstone and the events keep the audit trail meaningful: who did what,
and when an account was removed. After deletion they contain no email address.

## For how long

**Until you delete them.** SelfAuth never purges anything on its own, and
there is no retention setting. Pick a period that fits your obligations and
run the deletion yourself, for example from a scheduled job:

```sql
-- security events older than 12 months
DELETE FROM auth_security_events WHERE occurred_at < now() - interval '12 months';
-- tombstones of accounts deleted more than 12 months ago
DELETE FROM auth_users WHERE state = 'deleted' AND deleted_at < now() - interval '12 months';
```

Deleting a tombstone cascades to its role assignments, sessions and tokens.
Security-event rows are not linked by a foreign key, so they stay (keep their
`user_id` or purge them as above). Run the statements in a migration or job you
own: they touch tables SelfAuth owns, and `selfauth db plan` will not generate
them.

## Backups

Deleted data survives in your database backups until those expire. The
generated code can't change that.
