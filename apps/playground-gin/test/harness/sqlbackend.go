package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/migrations"
	"example.com/app/internal/store/sqlstore"
)

// sqlBackend is one fresh SQLite file or MySQL database with the migrations applied, so every case
// is isolated and cases can run concurrently.
type sqlBackend struct {
	kind    sqlstore.Kind
	db      *sql.DB
	cleanup func()
	st      *sqlstore.Store
	rate    *sqlstore.RateLimitStore
}

func newSQLBackend(ctx context.Context, kind sqlstore.Kind) (*sqlBackend, error) {
	b := &sqlBackend{kind: kind, cleanup: func() {}}
	var dbURL string
	switch kind {
	case sqlstore.SQLite:
		dir, err := os.MkdirTemp("", "selfauth-sqlite-")
		if err != nil {
			return nil, err
		}
		b.cleanup = func() { _ = os.RemoveAll(dir) }
		dbURL = "file:" + filepath.Join(dir, "app.db")
	case sqlstore.MySQL:
		admin := os.Getenv("TEST_MYSQL_URL")
		if admin == "" {
			return nil, errors.New("TEST_MYSQL_URL is not set")
		}
		adminDB, err := sqlstore.Open(ctx, sqlstore.MySQL, admin)
		if err != nil {
			return nil, err
		}
		name := "t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
		if _, err := adminDB.ExecContext(ctx, "CREATE DATABASE "+name+" DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			_ = adminDB.Close()
			return nil, err
		}
		b.cleanup = func() {
			_, _ = adminDB.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+name)
			_ = adminDB.Close()
		}
		u, _ := url.Parse(admin)
		u.Path = "/" + name
		dbURL = u.String()
	default:
		return nil, fmt.Errorf("unsupported SQL store %q", kind)
	}
	all, err := loadSQLMigrations(kind)
	if err != nil {
		b.cleanup()
		return nil, err
	}
	if _, err := sqlstore.Migrate(ctx, kind, dbURL, all); err != nil {
		b.cleanup()
		return nil, err
	}
	if b.db, err = sqlstore.Open(ctx, kind, dbURL); err != nil {
		b.cleanup()
		return nil, err
	}
	b.st, b.rate = sqlstore.New(b.db, kind), sqlstore.NewRateLimitStore(b.db, kind)
	return b, nil
}

// loadSQLMigrations reads the schema derived for this database: SELFAUTH_MIGRATIONS_DIR, else the
// reference's packages/cli/template-variants, else the project's own db/migrations.
func loadSQLMigrations(kind sqlstore.Kind) ([]migrations.Migration, error) {
	for _, dir := range []string{
		os.Getenv("SELFAUTH_MIGRATIONS_DIR"),
		filepath.Join("..", "..", "packages", "cli", "template-variants", string(kind), "prisma", "migrations"),
		filepath.Join("db", "migrations"),
	} {
		if dir == "" {
			continue
		}
		if all, err := migrations.Load(dir); err == nil && len(all) > 0 {
			return all, nil
		}
	}
	return nil, fmt.Errorf("no %s migrations found (set SELFAUTH_MIGRATIONS_DIR)", kind)
}

func (b *sqlBackend) store() auth.Store                   { return b.st }
func (b *sqlBackend) rateLimitStore() auth.RateLimitStore { return b.rate }

func (b *sqlBackend) close() {
	if b.db != nil {
		_ = b.db.Close()
	}
	b.cleanup()
}

// value converts a database value to its JSON form: ISO dates, text for bytes.
func (b *sqlBackend) value(column string, v any) any {
	switch x := v.(type) {
	case []byte:
		return string(x)
	case time.Time:
		return auth.ISO(x)
	case int64:
		if strings.HasSuffix(column, "_at") {
			return auth.ISO(time.UnixMilli(x).UTC())
		}
	}
	return v
}

func (b *sqlBackend) query(ctx context.Context, q string, args ...any) ([]map[string]any, error) {
	rows, err := b.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		record := map[string]any{}
		for i, column := range columns {
			record[camel(column)] = b.value(column, values[i])
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func (b *sqlBackend) inspect(ctx context.Context, entity string) ([]map[string]any, error) {
	switch entity {
	case "user":
		users, err := b.query(ctx, `SELECT id, email, email_normalized, email_verified_at, state, created_at, updated_at, deleted_at
			FROM auth_users ORDER BY created_at ASC`)
		if err != nil {
			return nil, err
		}
		for _, u := range users {
			roles, err := b.st.GetUserRoles(ctx, u["id"].(string))
			if err != nil {
				return nil, err
			}
			u["roles"] = roles
		}
		return users, nil
	case "credential":
		return b.query(ctx, `SELECT id, user_id, type, secret_hash, created_at, updated_at FROM auth_credentials ORDER BY created_at ASC`)
	case "session":
		return b.query(ctx, `SELECT id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
			revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at FROM auth_sessions ORDER BY created_at ASC`)
	case "passwordResetToken":
		return b.query(ctx, `SELECT id, user_id, token_hash, expires_at, used_at, invalidated_at, created_at
			FROM auth_password_reset_tokens ORDER BY created_at ASC`)
	case "emailVerificationToken":
		return b.query(ctx, `SELECT id, user_id, token_hash, email, expires_at, used_at, invalidated_at, created_at
			FROM auth_email_verification_tokens ORDER BY created_at ASC`)
	}
	return nil, fmt.Errorf("unknown entity %q", entity)
}

func (b *sqlBackend) events(ctx context.Context) ([]map[string]any, error) {
	// Insertion order: MySQL has a seq column, SQLite's rowid is the same counter.
	order := "seq"
	if b.kind == sqlstore.SQLite {
		order = "rowid"
	}
	rows, err := b.query(ctx, `SELECT id, type, outcome, occurred_at, user_id, actor_id, ip_address, user_agent, request_id, metadata
		FROM auth_security_events ORDER BY `+order+` ASC`)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if s, ok := r["metadata"].(string); ok {
			var parsed any
			if err := json.Unmarshal([]byte(s), &parsed); err == nil {
				r["metadata"] = parsed
			}
		}
	}
	return rows, nil
}

func (b *sqlBackend) mutate(ctx context.Context, entity string, where, set map[string]any) error {
	columns, ok := mutableColumns[entity]
	if !ok {
		return fmt.Errorf("mutateStorage: unsupported entity %q", entity)
	}
	table := map[string]string{"user": "auth_users", "session": "auth_sessions"}[entity]
	var args []any
	clause := func(fields map[string]any, sep string) (string, error) {
		var parts []string
		for field, value := range fields {
			column, ok := columns[field]
			if !ok {
				return "", fmt.Errorf("mutateStorage %s: unsupported field %q", entity, field)
			}
			if s, isString := value.(string); isString && strings.HasSuffix(column, "_at") {
				t, err := time.Parse(time.RFC3339Nano, s)
				if err != nil {
					return "", err
				}
				if b.kind == sqlstore.SQLite {
					value = t.UnixMilli()
				} else {
					value = t.UTC()
				}
			}
			args = append(args, value)
			parts = append(parts, column+" = ?")
		}
		return strings.Join(parts, sep), nil
	}
	setSQL, err := clause(set, ", ")
	if err != nil {
		return err
	}
	whereSQL, err := clause(where, " AND ")
	if err != nil {
		return err
	}
	if setSQL == "" {
		return errors.New("mutateStorage: nothing to set")
	}
	if whereSQL == "" {
		whereSQL = "1 = 1"
	}
	_, err = b.db.ExecContext(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, setSQL, whereSQL), args...)
	return err
}
