package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

// postgresBackend is one fresh PostgreSQL schema with the migrations applied, so
// every case is isolated and cases can run concurrently.
type postgresBackend struct {
	admin  *pgxpool.Pool
	db     *pgxpool.Pool
	schema string
	pg     *postgres.Store
	rate   *postgres.RateLimitStore
}

func newPostgresBackend(ctx context.Context) (*postgresBackend, error) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		return nil, errors.New("TEST_DATABASE_URL is not set")
	}
	admin, err := postgres.Open(ctx, postgres.Options{URL: url, MaxConns: 1})
	if err != nil {
		return nil, err
	}
	schema := "t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		return nil, err
	}
	b := &postgresBackend{admin: admin, schema: schema}
	if b.db, err = postgres.Open(ctx, postgres.Options{URL: url, Schema: schema, MaxConns: 4}); err != nil {
		b.close()
		return nil, err
	}
	migrations, err := postgres.LoadMigrations(migrationsDir())
	if err != nil {
		b.close()
		return nil, err
	}
	if _, err := postgres.Migrate(ctx, b.db, migrations); err != nil {
		b.close()
		return nil, err
	}
	b.pg, b.rate = postgres.New(b.db), postgres.NewRateLimitStore(b.db)
	return b, nil
}

// migrationsDir is db/migrations of the application (the harness runs from anywhere).
func migrationsDir() string {
	if dir := os.Getenv("SELFAUTH_MIGRATIONS_DIR"); dir != "" {
		return dir
	}
	return filepath.Join("db", "migrations")
}

func (b *postgresBackend) store() auth.Store                   { return b.pg }
func (b *postgresBackend) rateLimitStore() auth.RateLimitStore { return b.rate }

func (b *postgresBackend) close() {
	if b.db != nil {
		b.db.Close()
	}
	if b.admin != nil {
		_, _ = b.admin.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+b.schema+" CASCADE")
		b.admin.Close()
	}
}

// camel turns snake_case column names into the camelCase every driver exposes.
func camel(column string) string {
	parts := strings.Split(column, "_")
	for i := 1; i < len(parts); i++ {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}

// jsonValue converts a database value to its JSON form: ISO dates, textual UUIDs.
func jsonValue(v any) any {
	switch x := v.(type) {
	case time.Time:
		return auth.ISO(x)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:])
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = jsonValue(e)
		}
		return out
	}
	return v
}

func (b *postgresBackend) query(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := b.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		record := map[string]any{}
		for i, f := range rows.FieldDescriptions() {
			record[camel(f.Name)] = jsonValue(values[i])
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func (b *postgresBackend) inspect(ctx context.Context, entity string) ([]map[string]any, error) {
	switch entity {
	case "user":
		return b.query(ctx, `
			SELECT u.id::text AS id, u.email, u.email_normalized, u.email_verified_at, u.state::text AS state,
			       u.created_at, u.updated_at, u.deleted_at,
			       ARRAY(SELECT r.name FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id
			             WHERE ur.user_id = u.id) AS roles
			FROM auth_users u ORDER BY u.created_at ASC`)
	case "credential":
		return b.query(ctx, `SELECT id::text AS id, user_id::text AS user_id, type::text AS type, secret_hash,
			created_at, updated_at FROM auth_credentials ORDER BY created_at ASC`)
	case "session":
		return b.query(ctx, `SELECT id::text AS id, token_hash, user_id::text AS user_id, created_at, last_seen_at,
			idle_expires_at, absolute_expires_at, revoked_at, revoked_reason::text AS revoked_reason, ip_address,
			user_agent, reauthenticated_at FROM auth_sessions ORDER BY created_at ASC`)
	case "passwordResetToken":
		return b.query(ctx, `SELECT id::text AS id, user_id::text AS user_id, token_hash, expires_at, used_at,
			invalidated_at, created_at FROM auth_password_reset_tokens ORDER BY created_at ASC`)
	case "emailVerificationToken":
		return b.query(ctx, `SELECT id::text AS id, user_id::text AS user_id, token_hash, email, expires_at, used_at,
			invalidated_at, created_at FROM auth_email_verification_tokens ORDER BY created_at ASC`)
	}
	return nil, fmt.Errorf("unknown entity %q", entity)
}

func (b *postgresBackend) events(ctx context.Context) ([]map[string]any, error) {
	return b.query(ctx, `SELECT id::text AS id, type, outcome::text AS outcome, occurred_at, user_id::text AS user_id,
		actor_id::text AS actor_id, ip_address, user_agent, request_id, metadata
		FROM auth_security_events ORDER BY seq ASC`)
}

// Columns a conformance case may change or match, by logical field name. Names are checked
// against this list, never interpolated from the request.
var mutableColumns = map[string]map[string]string{
	"user": {"id": "id", "email": "email", "state": "state", "emailVerifiedAt": "email_verified_at"},
	"session": {"id": "id", "userId": "user_id", "revokedAt": "revoked_at", "revokedReason": "revoked_reason",
		"idleExpiresAt": "idle_expires_at", "absoluteExpiresAt": "absolute_expires_at", "reauthenticatedAt": "reauthenticated_at"},
}

var casts = map[string]string{"id": "::uuid", "user_id": "::uuid", "state": "::auth_account_state",
	"revoked_reason": "::auth_session_revoked_reason"}

func (b *postgresBackend) mutate(ctx context.Context, entity string, where, set map[string]any) error {
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
				value = t
			}
			args = append(args, value)
			parts = append(parts, fmt.Sprintf("%s = $%d%s", column, len(args), casts[column]))
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
		whereSQL = "true"
	}
	_, err = b.db.Exec(ctx, fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, setSQL, whereSQL), args...)
	return err
}
