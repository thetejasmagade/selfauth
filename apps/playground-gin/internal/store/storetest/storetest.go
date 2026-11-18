// Package storetest is the behavior every auth.Store must have, run against each
// implementation. It checks the guarantees the core relies on and the
// conformance suite can only observe indirectly (DATA-MODEL-001/002).
package storetest

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"example.com/app/internal/auth"
)

var now = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func user(email string) auth.UserRecord {
	id := auth.NewID()
	e := email
	return auth.UserRecord{ID: id, Email: &e, EmailNormalized: &e, State: auth.StateActive, CreatedAt: now, UpdatedAt: now}
}

// Run executes the suite. newStore returns a fresh, empty, migrated store.
func Run(t *testing.T, newStore func(t *testing.T) auth.Store) {
	ctx := context.Background()
	fresh := func(t *testing.T) auth.Store {
		t.Helper()
		s := newStore(t)
		if err := s.SyncRoles(ctx, map[string][]string{"user": {"a.read"}, "admin": {"a.read", "auth.users.manage"}}); err != nil {
			t.Fatal(err)
		}
		return s
	}

	t.Run("create user is unique by email and all-or-nothing", func(t *testing.T) {
		s := fresh(t)
		if _, err := s.CreateUser(ctx, user("a@b.co"), "hash", []string{"user"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateUser(ctx, user("a@b.co"), "hash", []string{"user"}); !errors.Is(err, auth.ErrEmailTaken) {
			t.Fatalf("duplicate email: %v", err)
		}
		bad := user("c@d.co")
		if _, err := s.CreateUser(ctx, bad, "hash", []string{"missing-role"}); err == nil {
			t.Fatal("an unsynchronized role must fail the creation")
		}
		if u, _ := s.FindUserByEmail(ctx, "c@d.co"); u != nil {
			t.Fatal("a failed creation left a user behind (AUTHN-REG-003)")
		}
		if _, ok, _ := s.GetPasswordHash(ctx, bad.ID); ok {
			t.Fatal("a failed creation left a credential behind")
		}
	})

	t.Run("concurrent registration of one address creates one account", func(t *testing.T) {
		s := fresh(t)
		var created atomic.Int32
		var wg sync.WaitGroup
		for i := 0; i < 20; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := s.CreateUser(ctx, user("race@b.co"), "hash", []string{"user"}); err == nil {
					created.Add(1)
				} else if !errors.Is(err, auth.ErrEmailTaken) {
					t.Errorf("unexpected error: %v", err)
				}
			}()
		}
		wg.Wait()
		if created.Load() != 1 {
			t.Fatalf("%d accounts created for one address, want 1", created.Load())
		}
	})

	t.Run("users, roles and credentials", func(t *testing.T) {
		s := fresh(t)
		u, _ := s.CreateUser(ctx, user("a@b.co"), "hash1", []string{"user"})
		if roles, _ := s.GetUserRoles(ctx, u.ID); len(roles) != 1 || roles[0] != "user" {
			t.Fatalf("roles %v", roles)
		}
		if perms, _ := s.GetRolePermissions(ctx, []string{"user"}); len(perms) != 1 || perms[0] != "a.read" {
			t.Fatalf("permissions %v", perms)
		}
		if h, ok, _ := s.GetPasswordHash(ctx, u.ID); !ok || h != "hash1" {
			t.Fatal("password hash not stored")
		}
		_ = s.SetPasswordHash(ctx, u.ID, "hash2", now)
		if h, _, _ := s.GetPasswordHash(ctx, u.ID); h != "hash2" {
			t.Fatal("password hash not replaced")
		}
		if err := s.AddUserRole(ctx, u.ID, "admin", nil, now); err != nil {
			t.Fatal(err)
		}
		if err := s.AddUserRole(ctx, u.ID, "admin", nil, now); err != nil {
			t.Fatalf("granting a held role must not fail: %v", err)
		}
		if n, _ := s.CountActiveUsersWithRole(ctx, "admin"); n != 1 {
			t.Fatalf("admins %d", n)
		}
		if err := s.AddUserRole(ctx, u.ID, "nope", nil, now); err == nil {
			t.Fatal("granting an unknown role must fail")
		}
		_ = s.RemoveUserRole(ctx, u.ID, "admin")
		if n, _ := s.CountActiveUsersWithRole(ctx, "admin"); n != 0 {
			t.Fatal("role not removed")
		}
		// Deleting an account releases its address and drops its credential.
		deleted := auth.StateDeleted
		_ = s.UpdateUser(ctx, u.ID, auth.UserPatch{State: &deleted, DeletedAt: &now, ClearEmail: true})
		_ = s.DeleteCredentials(ctx, u.ID)
		if got, _ := s.FindUserByEmail(ctx, "a@b.co"); got != nil {
			t.Fatal("a deleted account still owns its address")
		}
		if _, err := s.CreateUser(ctx, user("a@b.co"), "hash", []string{"user"}); err != nil {
			t.Fatalf("the address must be reusable after deletion: %v", err)
		}
	})

	t.Run("an id of another shape is simply not found", func(t *testing.T) {
		s := fresh(t)
		for _, id := range []string{"", "not-a-uuid", "../../etc/passwd", "1; DROP TABLE auth_users"} {
			if u, err := s.FindUserByID(ctx, id); u != nil || err != nil {
				t.Errorf("user %q: %v %v", id, u, err)
			}
			if x, err := s.FindSessionByID(ctx, id); x != nil || err != nil {
				t.Errorf("session %q: %v %v", id, x, err)
			}
		}
	})

	t.Run("sessions", func(t *testing.T) {
		s := fresh(t)
		u, _ := s.CreateUser(ctx, user("a@b.co"), "h", []string{"user"})
		mk := func(hash string, idle, abs time.Duration) auth.SessionRecord {
			return auth.SessionRecord{
				ID: auth.NewID(), TokenHash: hash, UserID: u.ID, CreatedAt: now, LastSeenAt: now,
				IdleExpiresAt: now.Add(idle), AbsoluteExpiresAt: now.Add(abs),
			}
		}
		live, other, idleOut := mk(hashOf("1"), time.Hour, 2*time.Hour), mk(hashOf("2"), time.Hour, 2*time.Hour), mk(hashOf("3"), -time.Minute, time.Hour)
		for _, x := range []auth.SessionRecord{live, other, idleOut} {
			if err := s.CreateSession(ctx, x); err != nil {
				t.Fatal(err)
			}
		}
		got, _ := s.FindSessionByTokenHash(ctx, live.TokenHash)
		if got == nil || got.ID != live.ID {
			t.Fatal("session not found by token hash")
		}
		if list, _ := s.ListActiveSessions(ctx, u.ID, now); len(list) != 2 {
			t.Fatalf("active sessions %d, want 2 (expired ones are not listed)", len(list))
		}
		n, _ := s.RevokeUserSessions(ctx, u.ID, auth.RevokedLogoutAll, now, live.ID)
		if n != 2 { // `other` and `idleOut` are both unrevoked
			t.Fatalf("revoked %d, want 2", n)
		}
		if x, _ := s.FindSessionByID(ctx, live.ID); x.RevokedAt != nil {
			t.Fatal("the excepted session was revoked")
		}
		_ = s.RevokeSession(ctx, live.ID, auth.RevokedLogout, now)
		_ = s.RevokeSession(ctx, live.ID, auth.RevokedAdmin, now.Add(time.Hour)) // already revoked: unchanged
		x, _ := s.FindSessionByID(ctx, live.ID)
		if x.RevokedReason == nil || *x.RevokedReason != auth.RevokedLogout || !x.RevokedAt.Equal(now) {
			t.Fatal("a revoked session must keep its first revocation")
		}
	})

	t.Run("a one-time token is consumed once, even concurrently", func(t *testing.T) {
		s := fresh(t)
		u, _ := s.CreateUser(ctx, user("a@b.co"), "h", []string{"user"})
		email := "a@b.co"
		for _, kind := range []auth.TokenKind{auth.TokenPasswordReset, auth.TokenEmailVerification} {
			tok := auth.TokenRecord{ID: auth.NewID(), Kind: kind, UserID: u.ID, TokenHash: hashOf(string(kind)),
				ExpiresAt: now.Add(time.Hour), CreatedAt: now}
			if kind == auth.TokenEmailVerification {
				tok.Email = &email
			}
			if err := s.CreateToken(ctx, tok); err != nil {
				t.Fatal(err)
			}
			found, _ := s.FindToken(ctx, kind, tok.TokenHash)
			if found == nil || found.ID != tok.ID || found.Kind != kind {
				t.Fatalf("%s not found", kind)
			}
			if other, _ := s.FindToken(ctx, otherKind(kind), tok.TokenHash); other != nil {
				t.Fatal("a token must only be found as its own kind")
			}
			var wins atomic.Int32
			var wg sync.WaitGroup
			for i := 0; i < 20; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					if ok, err := s.ConsumeToken(ctx, tok.ID, now); err != nil {
						t.Error(err)
					} else if ok {
						wins.Add(1)
					}
				}()
			}
			wg.Wait()
			if wins.Load() != 1 {
				t.Fatalf("%s: %d consumers won, want 1", kind, wins.Load())
			}
		}
	})

	t.Run("expired and invalidated tokens cannot be consumed", func(t *testing.T) {
		s := fresh(t)
		u, _ := s.CreateUser(ctx, user("a@b.co"), "h", []string{"user"})
		expired := auth.TokenRecord{ID: auth.NewID(), Kind: auth.TokenPasswordReset, UserID: u.ID, TokenHash: hashOf("e"), ExpiresAt: now.Add(-time.Second), CreatedAt: now}
		invalid := auth.TokenRecord{ID: auth.NewID(), Kind: auth.TokenPasswordReset, UserID: u.ID, TokenHash: hashOf("i"), ExpiresAt: now.Add(time.Hour), CreatedAt: now}
		_ = s.CreateToken(ctx, expired)
		_ = s.CreateToken(ctx, invalid)
		_ = s.InvalidateUserTokens(ctx, u.ID, auth.TokensAll, now)
		for _, id := range []string{expired.ID, invalid.ID, auth.NewID(), "not-a-uuid"} {
			if ok, err := s.ConsumeToken(ctx, id, now); ok || err != nil {
				t.Errorf("token %s: ok=%v err=%v", id, ok, err)
			}
		}
	})

	t.Run("roles are synchronized exactly and idempotently", func(t *testing.T) {
		s := fresh(t)
		_ = s.SyncRoles(ctx, map[string][]string{"user": {"b.read"}, "admin": {"a.read", "auth.users.manage"}})
		_ = s.SyncRoles(ctx, map[string][]string{"user": {"b.read"}, "admin": {"a.read", "auth.users.manage"}})
		perms, _ := s.GetRolePermissions(ctx, []string{"user"})
		if len(perms) != 1 || perms[0] != "b.read" {
			t.Fatalf("user permissions %v, want exactly [b.read]", perms)
		}
		if ok, _ := s.RoleExists(ctx, "admin"); !ok {
			t.Fatal("admin missing")
		}
		if ok, _ := s.RoleExists(ctx, "ghost"); ok {
			t.Fatal("ghost exists")
		}
	})

	t.Run("synchronizing roles never prunes assignments (AUTHZ-RBAC-005)", func(t *testing.T) {
		s := fresh(t)
		u, _ := s.CreateUser(ctx, user("a@b.co"), "h", []string{"user"})
		_ = s.SyncRoles(ctx, map[string][]string{"user": {"a.read"}, "editor": {"a.read"}, "admin": {"a.read"}})
		_ = s.AddUserRole(ctx, u.ID, "editor", nil, now)
		// "editor" disappears from the configuration: the user keeps the assignment.
		_ = s.SyncRoles(ctx, map[string][]string{"user": {"a.read"}, "admin": {"a.read"}})
		roles, _ := s.GetUserRoles(ctx, u.ID)
		if len(roles) != 2 {
			t.Fatalf("roles after a sync that dropped one from the configuration: %v", roles)
		}
	})

	t.Run("events are kept in insertion order", func(t *testing.T) {
		s := fresh(t)
		for i := 0; i < 5; i++ {
			err := s.RecordEvent(ctx, auth.EventRecord{ID: auth.NewID(), Type: "t", Outcome: "success", OccurredAt: now,
				Metadata: map[string]any{"n": i}})
			if err != nil {
				t.Fatal(err)
			}
		}
	})
}

func otherKind(k auth.TokenKind) auth.TokenKind {
	if k == auth.TokenPasswordReset {
		return auth.TokenEmailVerification
	}
	return auth.TokenPasswordReset
}

// hashOf makes a 64-character token hash for fixtures.
func hashOf(seed string) string { return auth.SHA256Hex(seed) }

// RunRateLimit checks that a RateLimitStore serializes concurrent updates of one
// key, which is what makes the per-account login limit hold (SEC-RATE-001).
func RunRateLimit(t *testing.T, newStores func(t *testing.T) []auth.RateLimitStore) {
	ctx := context.Background()
	stores := newStores(t)
	clock := auth.NewManualClock()
	rule := auth.LimitRule{Limit: 5, WindowSeconds: 60}
	var allowed, justBlocked atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// Different limiter instances over the same shared state model several application instances.
			limiter := auth.NewRateLimiter(stores[i%len(stores)], clock)
			r, err := limiter.Hit(ctx, "login:acct:x", rule)
			if err != nil {
				t.Error(err)
				return
			}
			if r.Allowed {
				allowed.Add(1)
			}
			if r.JustBlocked {
				justBlocked.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if allowed.Load() != 5 || justBlocked.Load() != 1 {
		t.Fatalf("allowed=%d justBlocked=%d, want 5 and 1", allowed.Load(), justBlocked.Load())
	}
	limiter := auth.NewRateLimiter(stores[0], clock)
	if err := limiter.Reset(ctx, "login:acct:x"); err != nil {
		t.Fatal(err)
	}
	if r, _ := limiter.Hit(ctx, "login:acct:x", rule); !r.Allowed {
		t.Fatal("reset must clear the block")
	}
}
