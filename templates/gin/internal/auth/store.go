package auth

import (
	"context"
	"errors"
	"time"
)

// Persistence contract for the authentication core (DATA_MODEL.md).
// Methods documented as atomic MUST be atomic in the database (DATA-MODEL-002).

type AccountState string

const (
	StatePending   AccountState = "pending"
	StateActive    AccountState = "active"
	StateSuspended AccountState = "suspended"
	StateDisabled  AccountState = "disabled"
	StateDeleted   AccountState = "deleted"
)

type UserRecord struct {
	ID              string
	Email           *string
	EmailNormalized *string
	EmailVerifiedAt *time.Time
	State           AccountState
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DeletedAt       *time.Time
}

// UserPatch changes only the fields that are set.
type UserPatch struct {
	State           *AccountState
	EmailVerifiedAt *time.Time
	UpdatedAt       *time.Time
	DeletedAt       *time.Time
	// ClearEmail removes the address (account deletion releases it).
	ClearEmail bool
}

type SessionRevokedReason string

const (
	RevokedLogout          SessionRevokedReason = "logout"
	RevokedLogoutAll       SessionRevokedReason = "logout_all"
	RevokedPasswordChanged SessionRevokedReason = "password_changed"
	RevokedPasswordReset   SessionRevokedReason = "password_reset"
	RevokedStateChanged    SessionRevokedReason = "state_changed"
	RevokedAdmin           SessionRevokedReason = "admin"
	RevokedRotated         SessionRevokedReason = "rotated"
)

type SessionRecord struct {
	ID                string
	TokenHash         string
	UserID            string
	CreatedAt         time.Time
	LastSeenAt        time.Time
	IdleExpiresAt     time.Time
	AbsoluteExpiresAt time.Time
	RevokedAt         *time.Time
	RevokedReason     *SessionRevokedReason
	IPAddress         *string
	UserAgent         *string
	ReauthenticatedAt *time.Time
}

type TokenKind string

const (
	TokenPasswordReset     TokenKind = "passwordReset"
	TokenEmailVerification TokenKind = "emailVerification"
	TokensAll              TokenKind = "all"
)

type TokenRecord struct {
	ID        string
	Kind      TokenKind
	UserID    string
	TokenHash string
	// Email verification only: the normalized address the token was issued for.
	Email         *string
	ExpiresAt     time.Time
	UsedAt        *time.Time
	InvalidatedAt *time.Time
	CreatedAt     time.Time
}

type EventRecord struct {
	ID         string
	Type       string
	Outcome    string // "success" or "failure"
	OccurredAt time.Time
	UserID     *string
	ActorID    *string
	IPAddress  *string
	UserAgent  *string
	RequestID  *string
	Metadata   map[string]any
}

// ErrEmailTaken is returned by CreateUser when the normalized email is already
// taken (DATA-MODEL-001).
var ErrEmailTaken = errors.New("email already taken")

// Store is the persistence contract of the core.
type Store interface {
	// CreateUser is atomic: it creates the user, password credential and role
	// links, or nothing (AUTHN-REG-003).
	CreateUser(ctx context.Context, user UserRecord, passwordHash string, roles []string) (UserRecord, error)
	FindUserByID(ctx context.Context, id string) (*UserRecord, error)
	// FindUserByEmail returns the non-deleted user with this normalized email.
	FindUserByEmail(ctx context.Context, emailNormalized string) (*UserRecord, error)
	UpdateUser(ctx context.Context, id string, patch UserPatch) error

	GetPasswordHash(ctx context.Context, userID string) (string, bool, error)
	SetPasswordHash(ctx context.Context, userID, hash string, at time.Time) error
	DeleteCredentials(ctx context.Context, userID string) error

	CreateSession(ctx context.Context, s SessionRecord) error
	FindSessionByTokenHash(ctx context.Context, tokenHash string) (*SessionRecord, error)
	FindSessionByID(ctx context.Context, id string) (*SessionRecord, error)
	TouchSession(ctx context.Context, id string, lastSeenAt, idleExpiresAt time.Time) error
	RevokeSession(ctx context.Context, id string, reason SessionRevokedReason, at time.Time) error
	// RevokeUserSessions revokes all of the user's active sessions, optionally
	// keeping one (exceptSessionID "" keeps none), and returns the count.
	RevokeUserSessions(ctx context.Context, userID string, reason SessionRevokedReason, at time.Time, exceptSessionID string) (int, error)
	ListActiveSessions(ctx context.Context, userID string, now time.Time) ([]SessionRecord, error)

	CreateToken(ctx context.Context, t TokenRecord) error
	FindToken(ctx context.Context, kind TokenKind, tokenHash string) (*TokenRecord, error)
	// ConsumeToken is an atomic conditional consume: it succeeds only if the
	// token is unused, not invalidated and unexpired.
	ConsumeToken(ctx context.Context, id string, now time.Time) (bool, error)
	InvalidateUserTokens(ctx context.Context, userID string, kind TokenKind, at time.Time) error

	// SyncRoles is the explicit role synchronization (AUTHZ-RBAC-005).
	SyncRoles(ctx context.Context, roles map[string][]string) error
	GetUserRoles(ctx context.Context, userID string) ([]string, error)
	GetRolePermissions(ctx context.Context, roles []string) ([]string, error)
	RoleExists(ctx context.Context, role string) (bool, error)
	AddUserRole(ctx context.Context, userID, role string, assignedBy *string, at time.Time) error
	RemoveUserRole(ctx context.Context, userID, role string) error
	// CountActiveUsersWithRole counts active users holding a role.
	CountActiveUsersWithRole(ctx context.Context, role string) (int, error)

	// RecordEvent is append-only (SEC-AUDIT-004).
	RecordEvent(ctx context.Context, e EventRecord) error
}
