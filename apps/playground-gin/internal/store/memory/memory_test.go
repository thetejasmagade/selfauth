package memory

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"example.com/app/internal/auth"
)

func newUser(email string) auth.UserRecord {
	now := time.Now()
	normalized := email
	return auth.UserRecord{ID: auth.NewID(), Email: &email, EmailNormalized: &normalized, State: auth.StateActive, CreatedAt: now, UpdatedAt: now}
}

func TestCreateUserIsUniqueByNormalizedEmail(t *testing.T) {
	ctx := context.Background()
	s := New()
	_ = s.SyncRoles(ctx, map[string][]string{"user": nil})
	if _, err := s.CreateUser(ctx, newUser("a@b.co"), "hash", []string{"user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUser(ctx, newUser("a@b.co"), "hash", []string{"user"}); !errors.Is(err, auth.ErrEmailTaken) {
		t.Fatalf("want ErrEmailTaken, got %v", err)
	}
	if _, err := s.CreateUser(ctx, newUser("c@d.co"), "hash", []string{"missing"}); err == nil {
		t.Fatal("an unsynchronized default role must fail the whole creation")
	}
	if got, _ := s.FindUserByEmail(ctx, "c@d.co"); got != nil {
		t.Fatal("a failed creation must leave nothing behind (AUTHN-REG-003)")
	}
}

// A token is single-use even when consumed concurrently (AUTHN-RESET-009).
func TestConsumeTokenIsAtomic(t *testing.T) {
	ctx := context.Background()
	s := New()
	now := time.Now()
	_ = s.CreateToken(ctx, auth.TokenRecord{ID: "t", Kind: auth.TokenPasswordReset, UserID: "u", TokenHash: "h", ExpiresAt: now.Add(time.Hour), CreatedAt: now})
	var wins atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _ := s.ConsumeToken(ctx, "t", now); ok {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d consumers succeeded, want exactly 1", wins.Load())
	}
}

func TestConsumeTokenRefusesExpiredAndInvalidated(t *testing.T) {
	ctx := context.Background()
	s := New()
	now := time.Now()
	_ = s.CreateToken(ctx, auth.TokenRecord{ID: "old", Kind: auth.TokenPasswordReset, UserID: "u", TokenHash: "a", ExpiresAt: now.Add(-time.Second), CreatedAt: now})
	_ = s.CreateToken(ctx, auth.TokenRecord{ID: "inv", Kind: auth.TokenPasswordReset, UserID: "u", TokenHash: "b", ExpiresAt: now.Add(time.Hour), CreatedAt: now})
	_ = s.InvalidateUserTokens(ctx, "u", auth.TokensAll, now)
	for _, id := range []string{"old", "inv"} {
		if ok, _ := s.ConsumeToken(ctx, id, now); ok {
			t.Errorf("token %s consumed", id)
		}
	}
}
