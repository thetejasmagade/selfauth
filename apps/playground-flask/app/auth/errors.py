"""Spec error codes (specs/ERRORS.md) and the error the core raises."""

from __future__ import annotations

VALIDATION_FAILED = "VALIDATION_FAILED"
PASSWORD_POLICY_VIOLATION = "PASSWORD_POLICY_VIOLATION"
INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
UNAUTHENTICATED = "UNAUTHENTICATED"
EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"
ACCOUNT_UNAVAILABLE = "ACCOUNT_UNAVAILABLE"
FORBIDDEN = "FORBIDDEN"
REAUTHENTICATION_REQUIRED = "REAUTHENTICATION_REQUIRED"
CSRF_FAILED = "CSRF_FAILED"
NOT_FOUND = "NOT_FOUND"
TOKEN_INVALID = "TOKEN_INVALID"
EMAIL_TAKEN = "EMAIL_TAKEN"
CONFLICT = "CONFLICT"
RATE_LIMITED = "RATE_LIMITED"
PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
INTERNAL_ERROR = "INTERNAL_ERROR"

# The non-normative status binding in specs/ERRORS.md.
HTTP_STATUS = {
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
}

# User-facing messages. Deliberately generic (ERR-FORMAT-004).
MESSAGES = {
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
}


class AuthError(Exception):
    """A spec-defined failure. Transport adapters map `code` to a status."""

    def __init__(
        self,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
        retry_after_seconds: int = 0,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details or []
        self.retry_after_seconds = retry_after_seconds


def fail(code: str) -> AuthError:
    """The generic error for `code`."""
    return AuthError(code, MESSAGES.get(code, ""))


def validation(message: str, field: str, issue: str) -> AuthError:
    return AuthError(VALIDATION_FAILED, message, [{"field": field, "issue": issue}])
