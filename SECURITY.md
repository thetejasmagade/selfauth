# Security policy

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report vulnerabilities through GitHub's private vulnerability reporting:
repository → **Security** → **Report a vulnerability**.

Please include the affected component (spec, generator, template, adapter),
version or commit, a description, and reproduction steps or a proof of concept.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| Initial assessment | within 10 business days |
| Fix or mitigation plan | depends on severity; critical issues are prioritized |

We coordinate disclosure with the reporter and publish a GitHub Security
Advisory with a manually applicable patch.

## Why patches matter more here

SelfAuth **generates code that applications own** (ADR 0004). A fix in SelfAuth
does not automatically reach applications that generated code earlier.
Advisories therefore always include:

- which template versions / spec versions are affected,
- how to detect affected generated code (`selfauth.manifest.json` records
  template versions),
- a patch or manual fix that does not require running `selfauth upgrade`.

## Scope

In scope: the specification, CLI, templates, adapters, packages, skills, and
the conformance suite — including specification flaws that would make a
conforming implementation insecure.

Out of scope: vulnerabilities in applications caused by modifications made
after generation, and third-party dependencies (report those upstream; tell us
if our defaults expose them).

## Supported versions

Pre-1.0: only the latest `0.x` release receives fixes.
