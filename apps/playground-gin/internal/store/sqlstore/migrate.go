package sqlstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"example.com/app/internal/store/migrations"
	"github.com/go-sql-driver/mysql"
)

func (d dialect) ensureTable() string {
	if d.kind == MySQL {
		return "CREATE TABLE IF NOT EXISTS selfauth_migrations (name VARCHAR(255) NOT NULL PRIMARY KEY, checksum VARCHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
	}
	return "CREATE TABLE IF NOT EXISTS selfauth_migrations (name TEXT NOT NULL PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)"
}

func (d dialect) missingTable(err error) bool {
	if d.kind == MySQL {
		var m *mysql.MySQLError
		return errors.As(err, &m) && m.Number == 1146
	}
	return err != nil && strings.Contains(err.Error(), "no such table")
}

func applied(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, d dialect) (map[string]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT name, checksum FROM selfauth_migrations`)
	if err != nil {
		if d.missingTable(err) {
			return map[string]string{}, nil
		}
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

// openForMigrations connects like Open, but MySQL also accepts a file of several statements.
func openForMigrations(ctx context.Context, kind Kind, rawURL string) (*sql.DB, error) {
	if kind != MySQL {
		return Open(ctx, kind, rawURL)
	}
	connector, err := mysqlConnector(rawURL, true)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("cannot reach the database: %w", err)
	}
	return db, nil
}

// MigrationStatus reports applied and pending migrations without changing anything.
func MigrationStatus(ctx context.Context, kind Kind, rawURL string, all []migrations.Migration) (migrations.Status, error) {
	db, err := Open(ctx, kind, rawURL)
	if err != nil {
		return migrations.Status{}, err
	}
	defer db.Close()
	done, err := applied(ctx, db, dialectFor(kind))
	if err != nil {
		return migrations.Status{}, err
	}
	return migrations.Classify(all, done)
}

// Migrate applies every pending migration and returns the names it applied. On SQLite each file
// runs in a transaction. MySQL commits DDL as it goes, so a file that fails halfway leaves its
// earlier statements in place: restore from a backup, fix the file and run again.
func Migrate(ctx context.Context, kind Kind, rawURL string, all []migrations.Migration) ([]string, error) {
	db, err := openForMigrations(ctx, kind, rawURL)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	d := dialectFor(kind)
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if kind == MySQL {
		// Serializes concurrent migrators (two deploys starting at once).
		var got int
		if err := conn.QueryRowContext(ctx, `SELECT GET_LOCK('selfauth_migrate', 30)`).Scan(&got); err != nil || got != 1 {
			return nil, errors.New("another migration is running (could not get the migration lock)")
		}
		defer func() { _, _ = conn.ExecContext(context.WithoutCancel(ctx), `SELECT RELEASE_LOCK('selfauth_migrate')`) }()
	}
	if kind == SQLite {
		// One immediate transaction for the whole run: it holds the write lock, so concurrent
		// migrators queue, and SQLite DDL is transactional, so a failing file changes nothing.
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		ran, err := migrateWith(ctx, tx, d, all)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		return ran, tx.Commit()
	}
	return migrateWith(ctx, conn, d, all)
}

type executor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func migrateWith(ctx context.Context, q executor, d dialect, all []migrations.Migration) ([]string, error) {
	if _, err := q.ExecContext(ctx, d.ensureTable()); err != nil {
		return nil, err
	}
	done, err := applied(ctx, q, d)
	if err != nil {
		return nil, err
	}
	status, err := migrations.Classify(all, done)
	if err != nil {
		return nil, err
	}
	pending := map[string]struct{}{}
	for _, name := range status.Pending {
		pending[name] = struct{}{}
	}
	var ran []string
	for _, m := range all {
		if _, ok := pending[m.Name]; !ok {
			continue
		}
		if _, err := q.ExecContext(ctx, m.SQL); err != nil {
			return ran, fmt.Errorf("migration %s: %w", m.Name, err)
		}
		if _, err := q.ExecContext(ctx, `INSERT INTO selfauth_migrations (name, checksum, applied_at) VALUES (?, ?, ?)`, m.Name, m.Checksum, d.t(time.Now())); err != nil {
			return ran, err
		}
		ran = append(ran, m.Name)
	}
	return ran, nil
}
