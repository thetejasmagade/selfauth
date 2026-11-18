package auth

import (
	"context"
	"time"
)

// newMapStore returns a minimal Store for the service tests of this package. It is deliberately
// small and not concurrency-safe: stores are tested properly in internal/store.
func newMapStore() Store { return &mapStore{roles: map[string][]string{}} }

type mapStore struct {
	users    map[string]UserRecord
	hashes   map[string]string
	sessions map[string]SessionRecord
	tokens   map[string]TokenRecord
	roles    map[string][]string
	userRole map[string][]string
}

func (m *mapStore) init() {
	if m.users == nil {
		m.users, m.hashes = map[string]UserRecord{}, map[string]string{}
		m.sessions, m.tokens, m.userRole = map[string]SessionRecord{}, map[string]TokenRecord{}, map[string][]string{}
	}
}

func (m *mapStore) CreateUser(_ context.Context, u UserRecord, hash string, roles []string) (UserRecord, error) {
	m.init()
	for _, o := range m.users {
		if o.EmailNormalized != nil && u.EmailNormalized != nil && *o.EmailNormalized == *u.EmailNormalized {
			return UserRecord{}, ErrEmailTaken
		}
	}
	m.users[u.ID], m.hashes[u.ID], m.userRole[u.ID] = u, hash, roles
	return u, nil
}
func (m *mapStore) FindUserByID(_ context.Context, id string) (*UserRecord, error) {
	m.init()
	if u, ok := m.users[id]; ok {
		return &u, nil
	}
	return nil, nil
}
func (m *mapStore) FindUserByEmail(_ context.Context, e string) (*UserRecord, error) {
	m.init()
	for _, u := range m.users {
		if u.EmailNormalized != nil && *u.EmailNormalized == e && u.State != StateDeleted {
			u := u
			return &u, nil
		}
	}
	return nil, nil
}
func (m *mapStore) UpdateUser(context.Context, string, UserPatch) error { return nil }
func (m *mapStore) GetPasswordHash(_ context.Context, id string) (string, bool, error) {
	m.init()
	h, ok := m.hashes[id]
	return h, ok, nil
}
func (m *mapStore) SetPasswordHash(_ context.Context, id, h string, _ time.Time) error {
	m.init()
	m.hashes[id] = h
	return nil
}
func (m *mapStore) DeleteCredentials(context.Context, string) error { return nil }
func (m *mapStore) CreateSession(_ context.Context, s SessionRecord) error {
	m.init()
	m.sessions[s.ID] = s
	return nil
}
func (m *mapStore) FindSessionByTokenHash(context.Context, string) (*SessionRecord, error) {
	return nil, nil
}
func (m *mapStore) FindSessionByID(context.Context, string) (*SessionRecord, error)  { return nil, nil }
func (m *mapStore) TouchSession(context.Context, string, time.Time, time.Time) error { return nil }
func (m *mapStore) RevokeSession(context.Context, string, SessionRevokedReason, time.Time) error {
	return nil
}
func (m *mapStore) RevokeUserSessions(context.Context, string, SessionRevokedReason, time.Time, string) (int, error) {
	return 0, nil
}
func (m *mapStore) ListActiveSessions(context.Context, string, time.Time) ([]SessionRecord, error) {
	return nil, nil
}
func (m *mapStore) CreateToken(_ context.Context, t TokenRecord) error {
	m.init()
	m.tokens[t.ID] = t
	return nil
}
func (m *mapStore) FindToken(context.Context, TokenKind, string) (*TokenRecord, error) {
	return nil, nil
}
func (m *mapStore) ConsumeToken(context.Context, string, time.Time) (bool, error) { return false, nil }
func (m *mapStore) InvalidateUserTokens(context.Context, string, TokenKind, time.Time) error {
	return nil
}
func (m *mapStore) SyncRoles(_ context.Context, roles map[string][]string) error {
	m.roles = roles
	return nil
}
func (m *mapStore) GetUserRoles(_ context.Context, id string) ([]string, error) {
	m.init()
	return m.userRole[id], nil
}
func (m *mapStore) GetRolePermissions(context.Context, []string) ([]string, error) { return nil, nil }
func (m *mapStore) RoleExists(_ context.Context, r string) (bool, error) {
	_, ok := m.roles[r]
	return ok, nil
}
func (m *mapStore) AddUserRole(context.Context, string, string, *string, time.Time) error { return nil }
func (m *mapStore) RemoveUserRole(context.Context, string, string) error                  { return nil }
func (m *mapStore) CountActiveUsersWithRole(context.Context, string) (int, error)         { return 0, nil }
func (m *mapStore) RecordEvent(context.Context, EventRecord) error                        { return nil }
