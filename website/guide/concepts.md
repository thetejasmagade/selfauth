---
title: Concepts and terms
description: Plain-English definitions of the words used in the SelfAuth documentation, such as session, CSRF, RBAC, migration, store, adapter and conformance.
keywords: [glossary, terminology, session, csrf, rbac, argon2id, migration, adapter]
---

# Concepts and terms

You don't need to know any of this before you start. Come back when a word trips you up.

## Authentication and authorization

| Term | Meaning |
| --- | --- |
| Authentication | Proving who someone is. Signing in with an email and password is authentication. |
| Authorization | Deciding what someone may do once you know who they are. "Admins may suspend accounts" is authorization. |
| Account state | `pending` (email not verified), `active`, `suspended`, `disabled` or `deleted`. Only `active` accounts can sign in. |

## Sessions and cookies

| Term | Meaning |
| --- | --- |
| Session | The server's memory that "this browser is signed in as this user". |
| Session token | A long random string. The browser holds it, in a cookie. Your database holds only its hash, so a leaked database does not leak working sessions. |
| Cookie | A small value the browser sends with every request to your site. SelfAuth's session cookie is `HttpOnly`, which means page JavaScript cannot read it. |
| Idle timeout / absolute timeout | A session ends after 7 days without use, or 30 days after sign-in, whichever comes first. Both are configurable. |
| Session rotation | A new session is issued at every sign-in and password change, so an old stolen token stops working. |

## Attacks the defaults protect against

| Term | Meaning |
| --- | --- |
| CSRF (cross-site request forgery) | Another website tricking a signed-in browser into sending a request to your site. SelfAuth requires a special header, `X-SelfAuth-CSRF`, on every request that changes data. |
| Account enumeration | Learning which emails have accounts by comparing error messages. SelfAuth gives the same answer either way. |
| Brute force | Guessing passwords many times. Rate limits stop it: 5 failed sign-ins per account per 15 minutes by default. |
| Open redirect | A login link that sends people to a malicious site afterwards. The frontend only follows relative paths (`safeRedirect`). |

## Passwords

| Term | Meaning |
| --- | --- |
| Hash | A one-way scramble of a password. Nobody, including you, can turn it back into the password. |
| Argon2id | The hashing method used. It's slow and memory-hungry on purpose, which makes guessing expensive. |
| PHC string | The standard text format of the stored hash, for example `$argon2id$v=19$m=19456,t=2,p=1$…`. |

## Roles and permissions (RBAC)

| Term | Meaning |
| --- | --- |
| Permission | One thing someone may do, named `area.action`, such as `orders.view`. |
| Role | A named bundle of permissions, such as `user` or `support`. |
| RBAC | Role-based access control: users get roles, roles carry permissions. |
| Guard | A check in front of a route: `requireAuth`, `requirePermission("x.y")`, `authorizeResource`. |
| Policy | A rule for one kind of object, for example "an order may be read by its owner, or by anyone holding `orders.view_any`". |
| System permissions | Permissions starting with `auth.`, used by the built-in admin routes. You cannot declare your own with that prefix. |

## The project

| Term | Meaning |
| --- | --- |
| Backend / adapter | The web framework: `express`, `fastify` or `gin`. The adapter is the code that connects SelfAuth's core to it. |
| Store | The code that saves SelfAuth's data in a database. |
| Core | The framework-independent rules. Shared by every backend. |
| Template | A complete, tested project that `init` copies. |
| Manifest | `selfauth.manifest.json`: the list of files SelfAuth wrote, with a fingerprint of each, so `upgrade` can tell which ones you edited. |
| Migration | A reviewed SQL file that creates or changes database tables. |
| Seed | A script that writes the roles from your configuration into the database. |
| Conformance suite | The 90 language-neutral test cases every implementation must pass. |
| Specification (spec) | The written rules those tests come from. |
| ADR | Architecture decision record: a short note about why a choice was made. |

## Environments

| Term | Meaning |
| --- | --- |
| Development | Your computer. Emails are printed to the terminal and plain `http` cookies work. |
| Production | The real deployment. Strict checks apply: HTTPS only, a real database, a real email provider. |
| Same origin | The page and the API share one address (scheme, host and port). The simplest and recommended setup. |
