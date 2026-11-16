/** Stable error codes defined in specs/ERRORS.md. */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "PASSWORD_POLICY_VIOLATION",
  "INVALID_CREDENTIALS",
  "UNAUTHENTICATED",
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_UNAVAILABLE",
  "FORBIDDEN",
  "REAUTHENTICATION_REQUIRED",
  "CSRF_FAILED",
  "NOT_FOUND",
  "TOKEN_INVALID",
  "EMAIL_TAKEN",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Recommended HTTP status per code (non-normative HTTP binding). */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  PASSWORD_POLICY_VIOLATION: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_UNAVAILABLE: 403,
  FORBIDDEN: 403,
  REAUTHENTICATION_REQUIRED: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  TOKEN_INVALID: 400,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

export interface ErrorDetail {
  field: string;
  issue: string;
}

/** Error envelope body (ERR-FORMAT-001). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: ErrorDetail[];
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
