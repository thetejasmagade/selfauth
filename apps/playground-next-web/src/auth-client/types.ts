/**
 * Error codes from the SelfAuth specification (ERRORS.md), kept locally so the
 * application has no dependency on SelfAuth packages. The SelfAuth test suite
 * checks they match `@selfauth/spec`.
 */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "PASSWORD_POLICY_VIOLATION"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_UNAVAILABLE"
  | "FORBIDDEN"
  | "REAUTHENTICATION_REQUIRED"
  | "CSRF_FAILED"
  | "NOT_FOUND"
  | "TOKEN_INVALID"
  | "EMAIL_TAKEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";
