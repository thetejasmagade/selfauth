---
"@selfauth/spec": minor
"@selfauth/cli": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
"selfauth": minor
---

The default minimum password length is now 8 (was 12). 8 is the floor the specification allows
(SEC-PWPOLICY-001), and common-password rejection stays on by default. Projects set it in
`selfauth.config.ts` (`authentication.password.minLength`, up to 1024); existing projects keep the value
in their own config. The generated frontends' hint and `minlength` attribute follow the default,
conformance case CT-REG-005 now checks the boundary at 8 (7 rejected, 8 accepted), and `selfauth doctor` no
longer warns about every project for having a minimum below 12.
