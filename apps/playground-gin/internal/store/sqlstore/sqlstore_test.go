package sqlstore_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/migrations"
	"example.com/app/internal/store/sqlstore"
	"example.com/app/internal/store/storetest"
)

// migrationsFor is the db/migrations of the project when it holds this database's schema (a
// generated project), else the reference schema derived for it in packages/cli/template-variants.
func migrationsFor(t *testing.T, kind sqlstore.Kind) []migrations.Migration {
	t.Helper()
	dirs := []string{os.Getenv("SELFAUTH_MIGRATIONS_DIR"),
		filepath.Join("..", "..", "..", "..", "..", "packages", "cli", "template-variants", string(kind), "prisma", "migrations"),
		filepath.Join("..", "..", "..", "db", "migrations")}
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		all, err := migrations.Load(dir)
		if err != nil || len(all) == 0 {
			continue
		}
		first := all[0].SQL
		if (kind == sqlstore.MySQL) == strings.Contains(first, "CHAR(36)") && (kind == sqlstore.SQLite) == !strings.Contains(first, "CHAR(36)") {
			return all
		}
	}
	t.Skipf("no %s migrations found", kind)
	return nil
}

// target is one database to test: the kinds that need no server always run.
type target struct {
	kind sqlstore.Kind
	// fresh returns a URL of an empty database that disappears with the test.
	fresh func(t *testing.T) string
}

func targets() []target {
	out := []target{{sqlstore.SQLite, func(t *testing.T) string { return "file:" + filepath.Join(t.TempDir(), "app.db") }}}
	if admin := os.Getenv("TEST_MYSQL_URL"); admin != "" {
		out = append(out, target{sqlstore.MySQL, func(t *testing.T) string { return freshMySQL(t, admin) }})
	}
	return out
}

func freshMySQL(t *testing.T, admin string) string {
	t.Helper()
	ctx := context.Background()
	db, err := sqlstore.Open(ctx, sqlstore.MySQL, admin)
	if err != nil {
		t.Fatal(err)
	}
	name := "t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
	if _, err := db.ExecContext(ctx, "CREATE DATABASE "+name+" DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, "DROP DATABASE "+name)
		_ = db.Close()
	})
	u, _ := url.Parse(admin)
	u.Path = "/" + name
	return u.String()
}

// migrated returns the URL of a fresh database with the migrations applied.
func migrated(t *testing.T, tg target) string {
	t.Helper()
	u := tg.fresh(t)
	if _, err := sqlstore.Migrate(context.Background(), tg.kind, u, migrationsFor(t, tg.kind)); err != nil {
		t.Fatal(err)
	}
	return u
}

func TestStoreContract(t *testing.T) {
	for _, tg := range targets() {
		t.Run(string(tg.kind), func(t *testing.T) {
			storetest.Run(t, func(t *testing.T) auth.Store {
				db, err := sqlstore.Open(context.Background(), tg.kind, migrated(t, tg))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = db.Close() })
				return sqlstore.New(db, tg.kind)
			})
		})
	}
}

func TestRateLimitStoreSerializesAcrossConnections(t *testing.T) {
	for _, tg := range targets() {
		t.Run(string(tg.kind), func(t *testing.T) {
			storetest.RunRateLimit(t, func(t *testing.T) []auth.RateLimitStore {
				u := migrated(t, tg)
				var stores []auth.RateLimitStore
				// Two connections over the same database stand for two application instances (SQLite
				// is one file on one host, but its single-writer lock still serializes them).
				for i := 0; i < 2; i++ {
					db, err := sqlstore.Open(context.Background(), tg.kind, u)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = db.Close() })
					stores = append(stores, sqlstore.NewRateLimitStore(db, tg.kind))
				}
				return stores
			})
		})
	}
}

func TestMigrations(t *testing.T) {
	ctx := context.Background()
	for _, tg := range targets() {
		t.Run(string(tg.kind), func(t *testing.T) {
			all := migrationsFor(t, tg.kind)
			u := tg.fresh(t)
			st, err := sqlstore.MigrationStatus(ctx, tg.kind, u, all)
			if err != nil || len(st.Pending) != len(all) || len(st.Applied) != 0 {
				t.Fatalf("fresh database: %+v %v", st, err)
			}
			if ran, err := sqlstore.Migrate(ctx, tg.kind, u, all); err != nil || len(ran) != len(all) {
				t.Fatalf("first run: %v %v", ran, err)
			}
			if ran, err := sqlstore.Migrate(ctx, tg.kind, u, all); err != nil || len(ran) != 0 {
				t.Fatalf("a second run must do nothing: %v %v", ran, err)
			}
			st, _ = sqlstore.MigrationStatus(ctx, tg.kind, u, all)
			if len(st.Pending) != 0 || len(st.Applied) != len(all) {
				t.Fatalf("after migrating: %+v", st)
			}
			// An applied migration that was edited afterwards is refused, not re-run.
			edited := append([]migrations.Migration{}, all...)
			edited[0].Checksum = "different"
			if _, err := sqlstore.Migrate(ctx, tg.kind, u, edited); err == nil || !strings.Contains(err.Error(), "edited") {
				t.Fatalf("edited migration: %v", err)
			}
			// A database ahead of the directory is refused too.
			if _, err := sqlstore.MigrationStatus(ctx, tg.kind, u, nil); err == nil {
				t.Fatal("a database with unknown migrations must be reported")
			}
		})
	}
}

func TestConcurrentMigratorsApplyOnce(t *testing.T) {
	ctx := context.Background()
	for _, tg := range targets() {
		t.Run(string(tg.kind), func(t *testing.T) {
			all := migrationsFor(t, tg.kind)
			u := tg.fresh(t)
			results := make(chan int, 4)
			for i := 0; i < 4; i++ {
				go func() {
					ran, err := sqlstore.Migrate(ctx, tg.kind, u, all)
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
			if total != len(all) {
				t.Fatalf("%d migrations applied across 4 concurrent runs, want %d", total, len(all))
			}
		})
	}
}
