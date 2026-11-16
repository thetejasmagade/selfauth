import { AuthApiError, type ClientErrorCode } from "./client.ts";

/** User-facing text per error code. Generic on purpose (ERR-FORMAT-004). */
const MESSAGES: Partial<Record<ClientErrorCode, string>> = {
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_NOT_VERIFIED: "Please verify your email address first. Check your inbox for the link.",
  ACCOUNT_UNAVAILABLE:
    "This account is not available. Contact support if you think this is a mistake.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  TOKEN_INVALID: "This link is invalid or has expired. Request a new one.",
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You do not have permission to do that.",
  REAUTHENTICATION_REQUIRED: "Please sign in again to continue.",
  CSRF_FAILED: "Your request could not be verified. Reload the page and try again.",
  EMAIL_TAKEN: "An account with this email already exists.",
  NETWORK_ERROR: "The server could not be reached. Check your connection.",
};

const POLICY: Record<string, string> = {
  too_common: "This password is too common. Choose a less predictable one.",
  equals_email: "Your password must not be your email address.",
  required: "Enter a password.",
};

export function describeError(error: unknown): string {
  if (!(error instanceof AuthApiError)) return "Something went wrong. Please try again.";
  if (error.code === "PASSWORD_POLICY_VIOLATION") {
    const issue = error.details.find((d) => d.field === "password")?.issue ?? "";
    const min = /^min_length_(\d+)$/.exec(issue);
    const max = /^max_length_(\d+)$/.exec(issue);
    if (min) return `Use at least ${min[1]} characters.`;
    if (max) return `Use at most ${max[1]} characters.`;
    return POLICY[issue] ?? "This password does not meet the requirements.";
  }
  if (error.code === "VALIDATION_FAILED") {
    return error.details.some((d) => d.field === "email")
      ? "Enter a valid email address."
      : "Please check your input.";
  }
  return MESSAGES[error.code] ?? "Something went wrong. Please try again.";
}
