package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A deliberately small migration runner: SQL files applied in name order, each
// in its own transaction, recorded with a checksum so an applied migration that
// was edited afterwards is detected. It runs only when you ask (never at
// startup: DATA-MODEL-003). Read each new migration before you apply it.

// Migration is one directory of db/migrations containing migration.sql.
type Migration struct {
	Name     string
	SQL      string
	Checksum string
}

// LoadMigrations reads dir/<name>/migration.sql for every <name>, in name order.
func LoadMigrations(dir string) ([]Migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}
	var out []Migration
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name(), "migration.sql"))
		if err != nil {
			return nil, fmt.Errorf("migration %s: %w", e.Name(), err)
		}
		sum := sha256.Sum256(data)
		out = append(out, Migration{Name: e.Name(), SQL: string(data), Checksum: hex.EncodeToString(sum[:])})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// MigrationStatus lists which migrations are applied and which are pending.
type MigrationStatus struct {
	Applied []string
	Pending []string
}

const ensureTable = `CREATE TABLE IF NOT EXISTS selfauth_migrations (
	name       text PRIMARY KEY,
	checksum   text NOT NULL,
	applied_at timestamptz NOT NULL DEFAULT now()
)`

// advisoryLockKey serializes concurrent migrators (two deploys starting at once).
const advisoryLockKey = 7262230001

func applied(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT name, checksum FROM selfauth_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var name, sum string
		if err := rows.Scan(&name, &sum); err != nil {
			return nil, err
		}
		out[name] = sum
	}
	return out, rows.Err()
}

func classify(migrations []Migration, done map[string]string) (MigrationStatus, error) {
	var st MigrationStatus
	known := map[string]struct{}{}
	for _, m := range migrations {
		known[m.Name] = struct{}{}
		sum, ok := done[m.Name]
		switch {
		case !ok:
			st.Pending = append(st.Pending, m.Name)
		case sum != m.Checksum:
			return st, fmt.Errorf("migration %s was applied and has been edited since; add a new migration instead of changing an applied one", m.Name)
		default:
			st.Applied = append(st.Applied, m.Name)
		}
	}
	for name := range done {
		if _, ok := known[name]; !ok {
			return st, fmt.Errorf("the database has migration %s, which is not in the migrations directory", name)
		}
	}
	return st, nil
}

// Status reports applied and pending migrations without changing anything.
func Status(ctx context.Context, db *pgxpool.Pool, migrations []Migration) (MigrationStatus, error) {
	var exists bool
	if err := db.QueryRow(ctx, `SELECT to_regclass('selfauth_migrations') IS NOT NULL`).Scan(&exists); err != nil {
		return MigrationStatus{}, err
	}
	done := map[string]string{}
	if exists {
		var err error
		if done, err = applied(ctx, db); err != nil {
			return MigrationStatus{}, err
		}
	}
	return classify(migrations, done)
}

// Migrate applies every pending migration and returns the names it applied.
func Migrate(ctx context.Context, db *pgxpool.Pool, migrations []Migration) ([]string, error) {
	conn, err := db.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockKey); err != nil {
		return nil, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, advisoryLockKey) }()
	if _, err := conn.Exec(ctx, ensureTable); err != nil {
		return nil, err
	}
	done, err := applied(ctx, conn)
	if err != nil {
		return nil, err
	}
	status, err := classify(migrations, done)
	if err != nil {
		return nil, err
	}
	pending := map[string]struct{}{}
	for _, name := range status.Pending {
		pending[name] = struct{}{}
	}
	var ran []string
	for _, m := range migrations {
		if _, ok := pending[m.Name]; !ok {
			continue
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return ran, err
		}
		// The simple protocol runs a file of several statements.
		if _, err := tx.Conn().PgConn().Exec(ctx, m.SQL).ReadAll(); err != nil {
			_ = tx.Rollback(ctx)
			return ran, fmt.Errorf("migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO selfauth_migrations (name, checksum) VALUES ($1, $2)`, m.Name, m.Checksum); err != nil {
			_ = tx.Rollback(ctx)
			return ran, err
		}
		if err := tx.Commit(ctx); err != nil {
			return ran, err
		}
		ran = append(ran, m.Name)
	}
	return ran, nil
}
