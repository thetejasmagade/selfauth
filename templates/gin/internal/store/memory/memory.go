// Package memory is an in-memory auth.Store for development and tests.
// It is single-process only and loses its data on restart. Every method holds
// one mutex for its whole duration, which makes the check-and-set operations
// atomic (DATA-MODEL-002). Use the PostgreSQL store for anything that must persist.
package memory

import (
	"context"
	"fmt"
	"sync"
	"time"

	"selfauth-app/internal/auth"
)

// Credential is a user's password credential.
type Credential struct {
	ID         string
	UserID     string
	Type       string
	SecretHash string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// UserRole links a user to a role.
type UserRole struct {
	UserID     string
	Role       string
	AssignedAt time.Time
	AssignedBy *string
}

// Store implements auth.Store.
type Store struct {
	mu          sync.Mutex
	users       map[string]auth.UserRecord
	credentials map[string]Credential // by user id
	sessions    map[string]auth.SessionRecord
	tokens      map[string]auth.TokenRecord
	roles       map[string][]string
	userRoles   []UserRole
	events      []auth.EventRecord
	credSeq     int
	// Insertion order, so listings and inspection are deterministic.
	userOrder, sessionOrder, tokenOrder, credOrder []string
}

var _ auth.Store = (*Store)(nil)

func New() *Store {
	return &Store{
		users:       map[string]auth.UserRecord{},
		credentials: map[string]Credential{},
		sessions:    map[string]auth.SessionRecord{},
		tokens:      map[string]auth.TokenRecord{},
		roles:       map[string][]string{},
	}
}

func (s *Store) CreateUser(_ context.Context, user auth.UserRecord, passwordHash string, roles []string) (auth.UserRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if user.EmailNormalized != nil {
		for _, u := range s.users {
			if u.EmailNormalized != nil && *u.EmailNormalized == *user.EmailNormalized {
				return auth.UserRecord{}, auth.ErrEmailTaken // unique among non-deleted users (IDENT-EMAIL-003)
			}
		}
	}
	for _, r := range roles {
		if _, ok := s.roles[r]; !ok {
			return auth.UserRecord{}, fmt.Errorf("default role %q is not synchronized", r)
		}
	}
	s.users[user.ID] = user
	s.userOrder = append(s.userOrder, user.ID)
	s.credSeq++
	s.credOrder = append(s.credOrder, user.ID)
	s.credentials[user.ID] = Credential{
		ID: fmt.Sprintf("cred-%d", s.credSeq), UserID: user.ID, Type: "password",
		SecretHash: passwordHash, CreatedAt: user.CreatedAt, UpdatedAt: user.CreatedAt,
	}
	for _, r := range roles {
		s.userRoles = append(s.userRoles, UserRole{UserID: user.ID, Role: r, AssignedAt: user.CreatedAt})
	}
	return user, nil
}

func (s *Store) FindUserByID(_ context.Context, id string) (*auth.UserRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if u, ok := s.users[id]; ok {
		return &u, nil
	}
	return nil, nil
}

func (s *Store) FindUserByEmail(_ context.Context, emailNormalized string) (*auth.UserRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.EmailNormalized != nil && *u.EmailNormalized == emailNormalized && u.State != auth.StateDeleted {
			u := u
			return &u, nil
		}
	}
	return nil, nil
}

func (s *Store) UpdateUser(_ context.Context, id string, p auth.UserPatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil
	}
	if p.State != nil {
		u.State = *p.State
	}
	if p.EmailVerifiedAt != nil {
		u.EmailVerifiedAt = p.EmailVerifiedAt
	}
	if p.UpdatedAt != nil {
		u.UpdatedAt = *p.UpdatedAt
	}
	if p.DeletedAt != nil {
		u.DeletedAt = p.DeletedAt
	}
	if p.ClearEmail {
		u.Email, u.EmailNormalized = nil, nil
	}
	s.users[id] = u
	return nil
}

func (s *Store) GetPasswordHash(_ context.Context, userID string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.credentials[userID]
	return c.SecretHash, ok, nil
}

func (s *Store) SetPasswordHash(_ context.Context, userID, hash string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.credentials[userID]
	if !ok {
		s.credSeq++
		s.credOrder = append(s.credOrder, userID)
		c = Credential{ID: fmt.Sprintf("cred-%d", s.credSeq), UserID: userID, Type: "password", CreatedAt: at}
	}
	c.SecretHash, c.UpdatedAt = hash, at
	s.credentials[userID] = c
	return nil
}

func (s *Store) DeleteCredentials(_ context.Context, userID string) error {
	s.mu.Lock()
	delete(s.credentials, userID)
	for i, id := range s.credOrder {
		if id == userID {
			s.credOrder = append(s.credOrder[:i], s.credOrder[i+1:]...)
			break
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *Store) CreateSession(_ context.Context, session auth.SessionRecord) error {
	s.mu.Lock()
	s.sessions[session.ID] = session
	s.sessionOrder = append(s.sessionOrder, session.ID)
	s.mu.Unlock()
	return nil
}

func (s *Store) FindSessionByTokenHash(_ context.Context, tokenHash string) (*auth.SessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.sessions {
		if x.TokenHash == tokenHash {
			x := x
			return &x, nil
		}
	}
	return nil, nil
}

func (s *Store) FindSessionByID(_ context.Context, id string) (*auth.SessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if x, ok := s.sessions[id]; ok {
		return &x, nil
	}
	return nil, nil
}

func (s *Store) TouchSession(_ context.Context, id string, lastSeenAt, idleExpiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if x, ok := s.sessions[id]; ok && x.RevokedAt == nil {
		x.LastSeenAt, x.IdleExpiresAt = lastSeenAt, idleExpiresAt
		s.sessions[id] = x
	}
	return nil
}

func revoke(x auth.SessionRecord, reason auth.SessionRevokedReason, at time.Time) auth.SessionRecord {
	x.RevokedAt, x.RevokedReason = &at, &reason
	return x
}

func (s *Store) RevokeSession(_ context.Context, id string, reason auth.SessionRevokedReason, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if x, ok := s.sessions[id]; ok && x.RevokedAt == nil {
		s.sessions[id] = revoke(x, reason, at)
	}
	return nil
}

func (s *Store) RevokeUserSessions(_ context.Context, userID string, reason auth.SessionRevokedReason, at time.Time, except string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for id, x := range s.sessions {
		if x.UserID == userID && x.RevokedAt == nil && x.ID != except {
			s.sessions[id] = revoke(x, reason, at)
			n++
		}
	}
	return n, nil
}

func (s *Store) ListActiveSessions(_ context.Context, userID string, now time.Time) ([]auth.SessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []auth.SessionRecord
	for _, id := range s.sessionOrder {
		x := s.sessions[id]
		if x.UserID == userID && x.RevokedAt == nil && now.Before(x.IdleExpiresAt) && now.Before(x.AbsoluteExpiresAt) {
			out = append(out, x)
		}
	}
	return out, nil
}

func (s *Store) CreateToken(_ context.Context, t auth.TokenRecord) error {
	s.mu.Lock()
	s.tokens[t.ID] = t
	s.tokenOrder = append(s.tokenOrder, t.ID)
	s.mu.Unlock()
	return nil
}

func (s *Store) FindToken(_ context.Context, kind auth.TokenKind, tokenHash string) (*auth.TokenRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.tokens {
		if t.Kind == kind && t.TokenHash == tokenHash {
			t := t
			return &t, nil
		}
	}
	return nil, nil
}

func (s *Store) ConsumeToken(_ context.Context, id string, now time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tokens[id]
	if !ok || t.UsedAt != nil || t.InvalidatedAt != nil || !now.Before(t.ExpiresAt) {
		return false, nil
	}
	t.UsedAt = &now
	s.tokens[id] = t
	return true, nil
}

func (s *Store) InvalidateUserTokens(_ context.Context, userID string, kind auth.TokenKind, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, t := range s.tokens {
		if t.UserID == userID && (kind == auth.TokensAll || t.Kind == kind) && t.UsedAt == nil && t.InvalidatedAt == nil {
			t.InvalidatedAt = &at
			s.tokens[id] = t
		}
	}
	return nil
}

func (s *Store) SyncRoles(_ context.Context, roles map[string][]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.roles = map[string][]string{}
	for name, perms := range roles {
		s.roles[name] = append([]string{}, perms...)
	}
	return nil
}

func (s *Store) GetUserRoles(_ context.Context, userID string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []string{}
	for _, r := range s.userRoles {
		if r.UserID == userID {
			out = append(out, r.Role)
		}
	}
	return out, nil
}

func (s *Store) GetRolePermissions(_ context.Context, roles []string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := map[string]struct{}{}
	out := []string{}
	for _, r := range roles {
		for _, p := range s.roles[r] {
			if _, ok := seen[p]; !ok {
				seen[p] = struct{}{}
				out = append(out, p)
			}
		}
	}
	return out, nil
}

func (s *Store) RoleExists(_ context.Context, role string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.roles[role]
	return ok, nil
}

func (s *Store) AddUserRole(_ context.Context, userID, role string, assignedBy *string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.roles[role]; !ok {
		return fmt.Errorf("role %q does not exist", role)
	}
	for _, r := range s.userRoles {
		if r.UserID == userID && r.Role == role {
			return nil
		}
	}
	s.userRoles = append(s.userRoles, UserRole{UserID: userID, Role: role, AssignedAt: at, AssignedBy: assignedBy})
	return nil
}

func (s *Store) RemoveUserRole(_ context.Context, userID, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, r := range s.userRoles {
		if r.UserID == userID && r.Role == role {
			s.userRoles = append(s.userRoles[:i], s.userRoles[i+1:]...)
			return nil
		}
	}
	return nil
}

func (s *Store) CountActiveUsersWithRole(_ context.Context, role string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, r := range s.userRoles {
		if r.Role == role && s.users[r.UserID].State == auth.StateActive {
			n++
		}
	}
	return n, nil
}

func (s *Store) RecordEvent(_ context.Context, e auth.EventRecord) error {
	s.mu.Lock()
	s.events = append(s.events, e)
	s.mu.Unlock()
	return nil
}

// ───────── inspection (tests and the conformance harness only) ─────────

// Snapshot is a consistent copy of everything stored.
type Snapshot struct {
	Users       []auth.UserRecord
	Credentials []Credential
	Sessions    []auth.SessionRecord
	Tokens      []auth.TokenRecord
	UserRoles   []UserRole
	Events      []auth.EventRecord
}

func (s *Store) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	var snap Snapshot
	for _, id := range s.userOrder {
		snap.Users = append(snap.Users, s.users[id])
	}
	for _, id := range s.credOrder {
		snap.Credentials = append(snap.Credentials, s.credentials[id])
	}
	for _, id := range s.sessionOrder {
		snap.Sessions = append(snap.Sessions, s.sessions[id])
	}
	for _, id := range s.tokenOrder {
		snap.Tokens = append(snap.Tokens, s.tokens[id])
	}
	snap.UserRoles = append(snap.UserRoles, s.userRoles...)
	snap.Events = append(snap.Events, s.events...)
	return snap
}

// MutateUser changes a user directly, bypassing the service (conformance mutateStorage).
func (s *Store) MutateUser(match func(auth.UserRecord) bool, change func(*auth.UserRecord)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, u := range s.users {
		if match(u) {
			change(&u)
			s.users[id] = u
		}
	}
}
