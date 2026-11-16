# Conformance

- **specVersion:** 0.1 (draft — open for review)

The conformance suite proves that an adapter implements this specification. It
is language-neutral: cases are JSON documents in `conformance/cases/` that
describe **operations and expected outcomes**, not HTTP routes or framework
calls. Each adapter provides a small *driver* that maps operations to its
implementation (for the MVP adapters, via the HTTP binding in
[AUTHENTICATION_SPEC §11](AUTHENTICATION_SPEC.md#11-http-binding-non-normative-used-by-mvp-adapters)).

## Coverage rule

Every `MUST` / `MUST NOT` requirement is covered by at least one conformance
case **or** by an entry in `conformance/verification.json` naming another
verification method (ADR 0007). `pnpm test` fails otherwise. Coverage is
reported per requirement by `@selfauth/conformance`.

Verification methods other than conformance cases:

| Method | Meaning |
| --- | --- |
| `schema-test` | Enforced by `selfAuthConfigSchema`; covered by `@selfauth/spec` tests |
| `adapter-test` | Requires adapter-internal inspection (e.g. library choice, async hashing); each adapter must include a named test |
| `code-review` | Checked in review against a checklist item in the adapter's `CONFORMANCE.md` |
| `documentation` | The adapter must document the item; checked in review |
| `static-analysis` | Checked by linting/scanning rules in the adapter's CI |
| `migration-test` | Checked by the migration test suite (Phase 4) |

## Case format

```jsonc
{
  "id": "CT-LOGIN-002",                 // unique, never reused
  "title": "Wrong password and unknown user are indistinguishable",
  "category": "login",
  "level": "core",                      // core | authorization | production
  "requirements": ["AUTHN-LOGIN-002", "SEC-ENUM-001"],
  "config": {},                         // optional partial config overrides
  "given": [                            // fixtures the driver creates directly
    { "user": "alice", "email": "alice@example.test", "password": "correct horse battery", "state": "active" }
  ],
  "steps": [
    { "op": "login", "input": { "email": "alice@example.test", "password": "wrong password!!" },
      "expect": { "outcome": "error", "code": "INVALID_CREDENTIALS" }, "save": "wrong" },
    { "op": "login", "input": { "email": "nobody@example.test", "password": "wrong password!!" },
      "expect": { "outcome": "error", "code": "INVALID_CREDENTIALS", "indistinguishableFrom": "wrong" } }
  ]
}
```

- `as` on a step names the client (cookie jar) performing it; default
  `"default"`. Clients are created on first use.
- `save` stores the step result under a name; later steps reference saved
  values with `"$name.path"` strings (e.g. `"$resetMail.token"`).
- `indistinguishableFrom` compares status, body (ignoring request IDs), and
  headers (ignoring `Date`, request IDs) with a saved result.
- Timing assertions are not part of the core suite; the timing requirement
  AUTHN-LOGIN-003 is verified by `adapter-test`.

### Operations

| Group | Operations |
| --- | --- |
| Authentication | `register`, `login`, `logout`, `logoutAll`, `getCurrentUser`, `listSessions`, `revokeSession`, `requestEmailVerification`, `verifyEmail`, `changePassword`, `requestPasswordReset`, `resetPassword`, `deleteAccount` |
| Authorization | `callProtected` (`{permission?, resource?}` against a driver-provided test route), `listOwned` |
| Administration | `assignRole`, `removeRole`, `setAccountState` |
| Harness | `advanceClock` (`{minutes}`), `readLastEmail` (`{to}` → `{token?, kind, link}`), `concurrent` (`{steps}` run in parallel), `inspectStorage` (`{entity, where?}` → records), `mutateStorage` (`{entity, where, set}` — bypasses services, for defense-in-depth cases), `inspectEvents` (`{type}`, `*` for all), `inspectLogs`, `rawRequest` (transport-level request for CSRF/header cases) |

Case-level fields besides those shown above: `environment`
(`development` | `production`, default `development`) selects the runtime mode
the driver simulates. Values starting with `$config.` refer to the effective
configuration (e.g. `$config.appBaseUrl`), and fixture names (`$alice.id`)
refer to `given` users and resources.

### Expectations

| Key | Meaning |
| --- | --- |
| `outcome` | `"success"` or `"error"` (required) |
| `code` | error code from [ERRORS](ERRORS.md) (required when outcome is error) |
| `codeOneOf` | alternative to `code` where the spec permits several codes (e.g. `NOT_FOUND` or `FORBIDDEN`, AUTHZ-RES-004) |
| `indistinguishableFrom` | saved result name |
| `sessionCreated` | whether a session cookie was issued |
| `successCount` | for `concurrent`: exact number of successful sub-steps |
| `assert` | operation-specific assertions (e.g. cookie attributes, storage fields) |

> **Draft status.** The `assert` vocabulary is intentionally open in specVersion
> 0.1. It is frozen into a typed schema when the first executable driver (the
> Express reference implementation, Phase 3) is written, so that the
> vocabulary is shaped by a real runner rather than guessed.

## Running the suite

`@selfauth/conformance` exports `runCase(case, driverFactory)`, a TypeScript
interpreter for the cases. An adapter provides a `Driver`
(`conformance/src/runner/driver.ts`): an HTTP request function plus harness
hooks for time, captured email, storage, events and logs. Adapters in other
languages can either implement the same driver contract behind an HTTP test
API, or port the interpreter.

Drivers mount these harness routes in the application under test:

| Route | Guard |
| --- | --- |
| `POST /__conformance/permission/:permission` | `requirePermission(permission)` |
| `POST /__conformance/resource/:permission/:type/:id` | resource policy for `type` (`order` uses the ownership helper) |
| `POST /__conformance/unconfigured` | none — must be denied by default |
| `GET /__conformance/list/order` | owner-filtered list, `{ ids }` |
| `GET /__conformance/fault` | throws an unexpected error |

The runner's default request models a same-origin browser:
`Sec-Fetch-Site: same-origin`, the CSRF header, and the client's cookie jar.

## Compliance levels

| Level | Requirement |
| --- | --- |
| **Core compliant** | All `level: core` cases pass; all core `adapter-test` items pass |
| **Authorization compliant** | Core + all `level: authorization` cases |
| **Production-profile compliant** | All cases + every `code-review`, `documentation`, and `static-analysis` item signed off for the adapter release |

An adapter is never labelled production-ready because its generator runs.
Every released adapter publishes its support matrix, conformance results,
known limitations, and the `specVersion` it targets.
