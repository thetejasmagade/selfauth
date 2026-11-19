package mongostore_test

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/mongostore"
	"example.com/app/internal/store/storetest"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// testURL is TEST_MONGODB_URL (a server, for example mongodb://localhost:27017). Without it these
// tests skip, unless SELFAUTH_REQUIRE_MONGODB=1 (CI sets it), which makes a missing server a failure.
func testURL(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("TEST_MONGODB_URL")
	if raw == "" {
		if os.Getenv("SELFAUTH_REQUIRE_MONGODB") == "1" {
			t.Fatal("SELFAUTH_REQUIRE_MONGODB=1 but TEST_MONGODB_URL is not set")
		}
		t.Skip("TEST_MONGODB_URL is not set")
	}
	return raw
}

// fresh returns a connection to an empty database that is dropped with the test; indexes only when asked.
func fresh(t *testing.T, indexes bool) *mongo.Database {
	t.Helper()
	u, err := url.Parse(testURL(t))
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
	ctx := context.Background()
	client, db, err := mongostore.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Drop(ctx)
		_ = client.Disconnect(ctx)
	})
	if indexes {
		if _, err := mongostore.EnsureIndexes(ctx, db); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestStoreContract(t *testing.T) {
	storetest.Run(t, func(t *testing.T) auth.Store { return mongostore.New(fresh(t, true)) })
}

func TestRateLimitStoreSerializesAcrossClients(t *testing.T) {
	storetest.RunRateLimit(t, func(t *testing.T) []auth.RateLimitStore {
		first := fresh(t, true)
		// A second client over the same database stands for a second application instance.
		second := first.Client().Database(first.Name())
		return []auth.RateLimitStore{mongostore.NewRateLimitStore(first), mongostore.NewRateLimitStore(second)}
	})
}

func TestIndexes(t *testing.T) {
	ctx := context.Background()
	db := fresh(t, false)
	missing, err := mongostore.MissingIndexes(ctx, db)
	if err != nil || len(missing) == 0 {
		t.Fatalf("a fresh database must be missing indexes: %v %v", missing, err)
	}
	created, err := mongostore.EnsureIndexes(ctx, db)
	if err != nil || len(created) != len(missing) {
		t.Fatalf("created %v, want %v (%v)", created, missing, err)
	}
	if again, err := mongostore.EnsureIndexes(ctx, db); err != nil || len(again) != 0 {
		t.Fatalf("a second run must do nothing: %v %v", again, err)
	}
	if left, _ := mongostore.MissingIndexes(ctx, db); len(left) != 0 {
		t.Fatalf("still missing: %v", left)
	}
}

// DATA-MODEL-001: the unique email index is what keeps accounts unique.
func TestEmailIsUniqueInTheDatabase(t *testing.T) {
	ctx := context.Background()
	store := mongostore.New(fresh(t, true))
	if err := store.SyncRoles(ctx, map[string][]string{"user": {}}); err != nil {
		t.Fatal(err)
	}
	mk := func(id string) auth.UserRecord {
		email := "same@example.test"
		now := auth.SystemClock.Now().Truncate(1_000_000)
		return auth.UserRecord{ID: id, Email: &email, EmailNormalized: &email, State: auth.StateActive, CreatedAt: now, UpdatedAt: now}
	}
	if _, err := store.CreateUser(ctx, mk(auth.NewID()), "hash", []string{"user"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateUser(ctx, mk(auth.NewID()), "hash", []string{"user"}); err != auth.ErrEmailTaken {
		t.Fatalf("second user with the same email: %v", err)
	}
}
