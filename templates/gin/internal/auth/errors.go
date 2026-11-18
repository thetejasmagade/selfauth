package auth

import "fmt"

// Code is a spec error code (specs/ERRORS.md).
type Code string

const (
	ValidationFailed        Code = "VALIDATION_FAILED"
	PasswordPolicyViolation Code = "PASSWORD_POLICY_VIOLATION"
	InvalidCredentials      Code = "INVALID_CREDENTIALS"
	Unauthenticated         Code = "UNAUTHENTICATED"
	EmailNotVerified        Code = "EMAIL_NOT_VERIFIED"
	AccountUnavailable      Code = "ACCOUNT_UNAVAILABLE"
	Forbidden               Code = "FORBIDDEN"
	ReauthenticationNeeded  Code = "REAUTHENTICATION_REQUIRED"
	CSRFFailed              Code = "CSRF_FAILED"
	NotFound                Code = "NOT_FOUND"
	TokenInvalid            Code = "TOKEN_INVALID"
	EmailTaken              Code = "EMAIL_TAKEN"
	Conflict                Code = "CONFLICT"
	RateLimited             Code = "RATE_LIMITED"
	PayloadTooLarge         Code = "PAYLOAD_TOO_LARGE"
	InternalError           Code = "INTERNAL_ERROR"
)

// HTTPStatus is the non-normative status binding in specs/ERRORS.md.
var HTTPStatus = map[Code]int{
	ValidationFailed:        400,
	PasswordPolicyViolation: 400,
	InvalidCredentials:      401,
	Unauthenticated:         401,
	EmailNotVerified:        403,
	AccountUnavailable:      403,
	Forbidden:               403,
	ReauthenticationNeeded:  403,
	CSRFFailed:              403,
	NotFound:                404,
	TokenInvalid:            400,
	EmailTaken:              409,
	Conflict:                409,
	RateLimited:             429,
	PayloadTooLarge:         413,
	InternalError:           500,
}

// Detail points at the field a validation error is about.
type Detail struct {
	Field string `json:"field"`
	Issue string `json:"issue"`
}

// Error is a spec-defined failure. Transport adapters map Code to a status.
type Error struct {
	Code    Code
	Message string
	Details []Detail
	// RetryAfterSeconds is set for RATE_LIMITED.
	RetryAfterSeconds int
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// User-facing messages. Deliberately generic (ERR-FORMAT-004).
var messages = map[Code]string{
	InvalidCredentials:     "Email or password is incorrect.",
	Unauthenticated:        "Authentication required.",
	EmailNotVerified:       "Please verify your email address before signing in.",
	AccountUnavailable:     "This account is not available.",
	Forbidden:              "You do not have permission to perform this action.",
	ReauthenticationNeeded: "Please enter your password again to continue.",
	TokenInvalid:           "This link is invalid or has expired.",
	RateLimited:            "Too many attempts. Please try again later.",
	EmailTaken:             "An account with this email already exists.",
	NotFound:               "Not found.",
	Conflict:               "This change is not allowed.",
}

// Fail returns the generic error for code.
func Fail(code Code) *Error { return &Error{Code: code, Message: messages[code]} }

func validation(message, field, issue string) *Error {
	return &Error{Code: ValidationFailed, Message: message, Details: []Detail{{field, issue}}}
}
