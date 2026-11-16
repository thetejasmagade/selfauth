# Optional capabilities — extension contracts

- **specVersion:** 0.1 (draft — informative)

These capabilities are **not** part of the MVP. Each gets its own normative
specification, adapter contract, tests, and migration plan before
implementation (roadmap Phase 11). This document fixes the boundaries now so
the core model does not have to change later.

General rules for every extension:

- It extends the core data model with new entities; it does not change the
  meaning of existing fields.
- It reuses core sessions: completing any login method creates a normal core
  session (AUTHN-SESS-*).
- It emits security events using the core event format.
- It keeps the core enumeration, rate-limiting, and token rules.
- It is off by default and enabled in configuration.

## OAuth 2.0 / OpenID Connect login

- Entities: `ExternalAccount (id, userId, provider, providerSubject, email?, linkedAt)`
  unique on `(provider, providerSubject)`.
- Authorization Code flow with PKCE and `state`; OIDC `nonce`; ID token
  validated by a maintained OIDC library.
- Identity is the provider's subject (`sub`), **never** the email claim alone.
- Provider secrets are environment variables; no SelfAuth-operated broker.

## Account linking

- Linking an external account to an existing user requires that user to be
  authenticated (or to complete a fresh login) — never automatic by matching
  email, even when the provider asserts `email_verified`.

## MFA — TOTP and recovery codes

- Entities: `Credential(type = "totp")` holding an encrypted secret;
  `RecoveryCode (id, userId, codeHash, usedAt)`.
- Login becomes two-step: password success yields a short-lived, single-use
  *MFA challenge*, not a session.
- TOTP per RFC 6238 via a maintained library, ±1 step skew, replay of a used
  step rejected. Recovery codes hashed, single-use.
- Enrolling/removing factors requires recent authentication.

## Passkeys / WebAuthn

- Entity: `Credential(type = "webauthn")` with credential ID, public key, sign
  count, transports.
- Implemented with a maintained WebAuthn server library; relying-party ID from
  configuration, never from request headers.

## API access tokens

- For non-browser clients only; browser sessions remain cookie-based
  (ADR 0008).
- Opaque tokens with a visible prefix (e.g. `sa_`), stored hashed, scoped to a
  subset of the user's permissions, with expiry and revocation.

## Email change

- Requires recent authentication; a verification token is sent to the **new**
  address and the change applies only after verification; the **old** address
  is notified; outstanding reset tokens are invalidated.
