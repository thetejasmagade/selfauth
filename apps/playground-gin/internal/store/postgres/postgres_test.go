package postgres_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/postgres"
	"example.com/app/internal/store/storetest"
	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationsDir = "../../../db/migrations"

// testURL is TEST_DATABASE_URL. Without it these tests skip, unless
// SELFAUTH_REQUIRE_POSTGRES=1 (CI sets it), which makes a missing database a failure.
func testURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		if os.Getenv("SELFAUTH_REQUIRE_POSTGRES") == "1" {
			t.Fatal("SELFAUTH_REQUIRE_POSTGRES=1 but TEST_DATABASE_URL is not set")
		}
		t.Skip("TEST_DATABASE_URL is not set")
	}
	return url
}

// schema creates an isolated schema and returns a pool bound to it; migrate applies the migrations.
func schema(t *testing.T, migrate bool) *pgxpool.Pool {
	t.Helper()
	url := testURL(t)
	ctx := context.Background()
	admin, err := postgres.Open(ctx, postgres.Options{URL: url, MaxConns: 1})
	if err != nil {
		t.Fatal(err)
	}
	name := "t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		t.Fatal(err)
	}
	db, err := postgres.Open(ctx, postgres.Options{URL: url, Schema: name, MaxConns: 8})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+name+" CASCADE")
		admin.Close()
	})
	if migrate {
		migrations, err := postgres.LoadMigrations(migrationsDir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Migrate(ctx, db, migrations); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestStoreContract(t *testing.T) {
	storetest.Run(t, func(t *testing.T) auth.Store { return postgres.New(schema(t, true)) })
}

func TestRateLimitStoreSerializesAcrossPools(t *testing.T) {
	storetest.RunRateLimit(t, func(t *testing.T) []auth.RateLimitStore {
		url := testURL(t)
		first := schema(t, true)
		// A second pool over the same schema stands for a second application instance.
		var name string
		if err := first.QueryRow(context.Background(), "SELECT current_schema()").Scan(&name); err != nil {
			t.Fatal(err)
		}
		second, err := postgres.Open(context.Background(), postgres.Options{URL: url, Schema: name, MaxConns: 8})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(second.Close)
		return []auth.RateLimitStore{postgres.NewRateLimitStore(first), postgres.NewRateLimitStore(second)}
	})
}

func TestMigrations(t *testing.T) {
	ctx := context.Background()
	db := schema(t, false)
	migrations, err := postgres.LoadMigrations(migrationsDir)
	if err != nil || len(migrations) == 0 {
		t.Fatalf("%v %d", err, len(migrations))
	}

	st, err := postgres.Status(ctx, db, migrations)
	if err != nil || len(st.Pending) != len(migrations) || len(st.Applied) != 0 {
		t.Fatalf("fresh database: %+v %v", st, err)
	}
	if ran, err := postgres.Migrate(ctx, db, migrations); err != nil || len(ran) != len(migrations) {
		t.Fatalf("first run: %v %v", ran, err)
	}
	if ran, err := postgres.Migrate(ctx, db, migrations); err != nil || len(ran) != 0 {
		t.Fatalf("a second run must do nothing: %v %v", ran, err)
	}
	st, _ = postgres.Status(ctx, db, migrations)
	if len(st.Pending) != 0 || len(st.Applied) != len(migrations) {
		t.Fatalf("after migrating: %+v", st)
	}

	// An applied migration that was edited afterwards is refused, not re-run.
	edited := append([]postgres.Migration{}, migrations...)
	edited[0].Checksum = "different"
	if _, err := postgres.Migrate(ctx, db, edited); err == nil || !strings.Contains(err.Error(), "edited") {
		t.Fatalf("edited migration: %v", err)
	}
	// A database ahead of the directory is refused too.
	if _, err := postgres.Status(ctx, db, nil); err == nil {
		t.Fatal("a database with unknown migrations must be reported")
	}
}

func TestConcurrentMigratorsApplyOnce(t *testing.T) {
	ctx := context.Background()
	db := schema(t, false)
	migrations, _ := postgres.LoadMigrations(migrationsDir)
	results := make(chan int, 4)
	for i := 0; i < 4; i++ {
		go func() {
			ran, err := postgres.Migrate(ctx, db, migrations)
			if err != nil {
				t.Error(err)
			}
			results <- len(ran)
		}()
	}
	total := 0
	for i := 0; i < 4; i++ {
		total += <-results
	}
	if total != len(migrations) {
		t.Fatalf("%d migrations applied across 4 concurrent runs, want %d", total, len(migrations))
	}
}

// DATA-MODEL-001: uniqueness is enforced by the database, not only by the application.
func TestUniqueIndexesExist(t *testing.T) {
	ctx := context.Background()
	db := schema(t, true)
	for _, want := range []string{
		"auth_users_email_normalized_key", "auth_sessions_token_hash_key",
		"auth_password_reset_tokens_token_hash_key", "auth_email_verification_tokens_token_hash_key",
		"auth_credentials_user_id_type_key", "auth_roles_name_key", "auth_permissions_name_key",
	} {
		var unique bool
		err := db.QueryRow(ctx, `SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
			WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace`, want).Scan(&unique)
		if err != nil || !unique {
			t.Errorf("unique index %s: %v (unique=%v)", want, err, unique)
		}
	}
}

// DATA-MODEL-004: applying SelfAuth's migrations to a database that already holds application
// tables and data adds SelfAuth's objects and touches nothing else.
func TestMigrationsLeaveApplicationDataAlone(t *testing.T) {
	ctx := context.Background()
	db := schema(t, false)
	if _, err := db.Exec(ctx, `CREATE TABLE orders (id serial PRIMARY KEY, total int NOT NULL);
		INSERT INTO orders (total) VALUES (10), (20), (30)`); err != nil {
		t.Fatal(err)
	}
	migrations, _ := postgres.LoadMigrations(migrationsDir)
	if _, err := postgres.Migrate(ctx, db, migrations); err != nil {
		t.Fatal(err)
	}
	var count, sum int
	if err := db.QueryRow(ctx, `SELECT count(*), sum(total) FROM orders`).Scan(&count, &sum); err != nil || count != 3 || sum != 60 {
		t.Fatalf("application data changed: %d rows, sum %d, %v", count, sum, err)
	}
	// Every table SelfAuth owns is prefixed, so none can collide with an application table.
	rows, _ := db.Query(ctx, `SELECT table_name FROM information_schema.tables
		WHERE table_schema = current_schema() AND table_name <> 'orders' AND table_name <> 'selfauth_migrations'`)
	defer rows.Close()
	for rows.Next() {
		var name string
		_ = rows.Scan(&name)
		if !strings.HasPrefix(name, "auth_") {
			t.Errorf("unexpected table %s", name)
		}
	}
}
