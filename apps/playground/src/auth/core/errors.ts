import type { ErrorCode, ErrorDetail } from "@selfauth/spec";

/** A spec-defined failure (specs/ERRORS.md). Transport adapters map `code` to a status. */
export class AuthError extends Error {
  override name = "AuthError";
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;
  /** Seconds until a rate-limited request may be retried. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ErrorDetail[]; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** User-facing messages. Deliberately generic (ERR-FORMAT-004). */
export const MESSAGES = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  UNAUTHENTICATED: "Authentication required.",
  EMAIL_NOT_VERIFIED: "Please verify your email address before signing in.",
  ACCOUNT_UNAVAILABLE: "This account is not available.",
  FORBIDDEN: "You do not have permission to perform this action.",
  REAUTHENTICATION_REQUIRED: "Please enter your password again to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  RATE_LIMITED: "Too many attempts. Please try again later.",
  EMAIL_TAKEN: "An account with this email already exists.",
  NOT_FOUND: "Not found.",
  CONFLICT: "This change is not allowed.",
} as const;

export function fail(code: keyof typeof MESSAGES): never {
  throw new AuthError(code, MESSAGES[code]);
}
