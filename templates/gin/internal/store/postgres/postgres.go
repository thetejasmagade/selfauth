// Package postgres is the PostgreSQL auth.Store, using pgx. The schema is the
// migration in db/migrations (identical to the other SelfAuth backends).
//
// Atomicity (DATA-MODEL-002): user creation runs in one transaction, token
// consumption and session revocation are conditional updates, and rate-limit
// updates lock their row.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"selfauth-app/internal/auth"
)

// Options configure the connection pool.
type Options struct {
	URL string
	// Schema sets search_path; used by tests to isolate runs. Empty uses the connection default.
	Schema string
	// MaxConns defaults to pgx's default.
	MaxConns int32
}

var schemaName = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// Open connects a pool. It does not migrate or seed anything (DATA-MODEL-003).
func Open(ctx context.Context, o Options) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(o.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	if o.Schema != "" {
		if !schemaName.MatchString(o.Schema) {
			return nil, errors.New("invalid schema name")
		}
		cfg.ConnConfig.RuntimeParams["search_path"] = o.Schema
	}
	if o.MaxConns > 0 {
		cfg.MaxConns = o.MaxConns
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("cannot reach the database: %w", err)
	}
	return pool, nil
}

// Store implements auth.Store.
type Store struct{ db *pgxpool.Pool }

var _ auth.Store = (*Store)(nil)

func New(db *pgxpool.Pool) *Store { return &Store{db: db} }

var uuidShape = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// isUUID: id columns are uuid, and PostgreSQL raises an error for any other text. An id of
// another shape cannot exist, so it is "not found", as in the in-memory store.
func isUUID(id string) bool { return uuidShape.MatchString(id) }

func isUniqueViolation(err error, constraint string) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505" && strings.Contains(pg.ConstraintName, constraint)
}

// ── users ──

const userColumns = `id::text, email, email_normalized, email_verified_at, state::text, created_at, updated_at, deleted_at`

func scanUser(row pgx.Row) (*auth.UserRecord, error) {
	var u auth.UserRecord
	var state string
	err := row.Scan(&u.ID, &u.Email, &u.EmailNormalized, &u.EmailVerifiedAt, &state, &u.CreatedAt, &u.UpdatedAt, &u.DeletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	u.State = auth.AccountState(state)
	return &u, err
}

func (s *Store) CreateUser(ctx context.Context, user auth.UserRecord, passwordHash string, roles []string) (auth.UserRecord, error) {
	// All-or-nothing: user, password credential and default roles (AUTHN-REG-003).
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id::text FROM auth_roles WHERE name = ANY($1)`, roles)
		if err != nil {
			return err
		}
		roleIDs, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if len(roleIDs) != len(unique(roles)) {
			return fmt.Errorf("default roles are not synchronized: %s", strings.Join(roles, ", "))
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO auth_users (id, email, email_normalized, email_verified_at, state, created_at, updated_at, deleted_at)
			VALUES ($1, $2, $3, $4, $5::auth_account_state, $6, $7, $8)`,
			user.ID, user.Email, user.EmailNormalized, user.EmailVerifiedAt, string(user.State), user.CreatedAt, user.UpdatedAt, user.DeletedAt); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at)
			VALUES ($1, $2, 'password', $3, $4, $4)`, auth.NewID(), user.ID, passwordHash, user.CreatedAt); err != nil {
			return err
		}
		for _, roleID := range roleIDs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO auth_user_roles (user_id, role_id, assigned_at) VALUES ($1, $2, $3)`,
				user.ID, roleID, user.CreatedAt); err != nil {
				return err
			}
		}
		return nil
	})
	if isUniqueViolation(err, "email_normalized") {
		return auth.UserRecord{}, auth.ErrEmailTaken
	}
	return user, err
}

func unique(in []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, v := range in {
		out[v] = struct{}{}
	}
	return out
}

func (s *Store) FindUserByID(ctx context.Context, id string) (*auth.UserRecord, error) {
	if !isUUID(id) {
		return nil, nil
	}
	return scanUser(s.db.QueryRow(ctx, `SELECT `+userColumns+` FROM auth_users WHERE id = $1`, id))
}

func (s *Store) FindUserByEmail(ctx context.Context, emailNormalized string) (*auth.UserRecord, error) {
	return scanUser(s.db.QueryRow(ctx,
		`SELECT `+userColumns+` FROM auth_users WHERE email_normalized = $1 AND state <> 'deleted' LIMIT 1`, emailNormalized))
}

func (s *Store) UpdateUser(ctx context.Context, id string, p auth.UserPatch) error {
	if !isUUID(id) {
		return nil
	}
	var sets []string
	var args []any
	set := func(column string, value any, cast string) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d%s", column, len(args), cast))
	}
	if p.State != nil {
		set("state", string(*p.State), "::auth_account_state")
	}
	if p.EmailVerifiedAt != nil {
		set("email_verified_at", *p.EmailVerifiedAt, "")
	}
	if p.UpdatedAt != nil {
		set("updated_at", *p.UpdatedAt, "")
	}
	if p.DeletedAt != nil {
		set("deleted_at", *p.DeletedAt, "")
	}
	if p.ClearEmail {
		sets = append(sets, "email = NULL", "email_normalized = NULL")
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := s.db.Exec(ctx, fmt.Sprintf(`UPDATE auth_users SET %s WHERE id = $%d`, strings.Join(sets, ", "), len(args)), args...)
	return err
}

// ── credentials ──

func (s *Store) GetPasswordHash(ctx context.Context, userID string) (string, bool, error) {
	if !isUUID(userID) {
		return "", false, nil
	}
	var hash string
	err := s.db.QueryRow(ctx, `SELECT secret_hash FROM auth_credentials WHERE user_id = $1 AND type = 'password'`, userID).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return hash, err == nil, err
}

func (s *Store) SetPasswordHash(ctx context.Context, userID, hash string, at time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at)
		VALUES ($1, $2, 'password', $3, $4, $4)
		ON CONFLICT (user_id, type) DO UPDATE SET secret_hash = EXCLUDED.secret_hash, updated_at = EXCLUDED.updated_at`,
		auth.NewID(), userID, hash, at)
	return err
}

func (s *Store) DeleteCredentials(ctx context.Context, userID string) error {
	if !isUUID(userID) {
		return nil
	}
	_, err := s.db.Exec(ctx, `DELETE FROM auth_credentials WHERE user_id = $1`, userID)
	return err
}

// ── sessions ──

const sessionColumns = `id::text, token_hash, user_id::text, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
	revoked_at, revoked_reason::text, ip_address, user_agent, reauthenticated_at`

func scanSession(row pgx.Row) (*auth.SessionRecord, error) {
	var x auth.SessionRecord
	var reason *string
	err := row.Scan(&x.ID, &x.TokenHash, &x.UserID, &x.CreatedAt, &x.LastSeenAt, &x.IdleExpiresAt, &x.AbsoluteExpiresAt,
		&x.RevokedAt, &reason, &x.IPAddress, &x.UserAgent, &x.ReauthenticatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if reason != nil {
		r := auth.SessionRevokedReason(*reason)
		x.RevokedReason = &r
	}
	return &x, err
}

func (s *Store) CreateSession(ctx context.Context, x auth.SessionRecord) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO auth_sessions (id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
			revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)`,
		x.ID, x.TokenHash, x.UserID, x.CreatedAt, x.LastSeenAt, x.IdleExpiresAt, x.AbsoluteExpiresAt,
		x.IPAddress, x.UserAgent, x.ReauthenticatedAt)
	return err
}

func (s *Store) FindSessionByTokenHash(ctx context.Context, tokenHash string) (*auth.SessionRecord, error) {
	return scanSession(s.db.QueryRow(ctx, `SELECT `+sessionColumns+` FROM auth_sessions WHERE token_hash = $1`, tokenHash))
}

func (s *Store) FindSessionByID(ctx context.Context, id string) (*auth.SessionRecord, error) {
	if !isUUID(id) {
		return nil, nil
	}
	return scanSession(s.db.QueryRow(ctx, `SELECT `+sessionColumns+` FROM auth_sessions WHERE id = $1`, id))
}

func (s *Store) TouchSession(ctx context.Context, id string, lastSeenAt, idleExpiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `UPDATE auth_sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id = $1 AND revoked_at IS NULL`,
		id, lastSeenAt, idleExpiresAt)
	return err
}

func (s *Store) RevokeSession(ctx context.Context, id string, reason auth.SessionRevokedReason, at time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE auth_sessions SET revoked_at = $2, revoked_reason = $3::auth_session_revoked_reason
		WHERE id = $1 AND revoked_at IS NULL`, id, at, string(reason))
	return err
}

func (s *Store) RevokeUserSessions(ctx context.Context, userID string, reason auth.SessionRevokedReason, at time.Time, except string) (int, error) {
	if !isUUID(userID) {
		return 0, nil
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE auth_sessions SET revoked_at = $2, revoked_reason = $3::auth_session_revoked_reason
		WHERE user_id = $1 AND revoked_at IS NULL AND ($4 = '' OR id <> NULLIF($4, '')::uuid)`,
		userID, at, string(reason), except)
	return int(tag.RowsAffected()), err
}

func (s *Store) ListActiveSessions(ctx context.Context, userID string, now time.Time) ([]auth.SessionRecord, error) {
	if !isUUID(userID) {
		return nil, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT `+sessionColumns+` FROM auth_sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2
		ORDER BY created_at ASC`, userID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []auth.SessionRecord
	for rows.Next() {
		x, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *x)
	}
	return out, rows.Err()
}

// ── one-time tokens (two tables, one logical contract) ──

func tokenTable(kind auth.TokenKind) string {
	if kind == auth.TokenPasswordReset {
		return "auth_password_reset_tokens"
	}
	return "auth_email_verification_tokens"
}

func (s *Store) CreateToken(ctx context.Context, t auth.TokenRecord) error {
	if t.Kind == auth.TokenPasswordReset {
		_, err := s.db.Exec(ctx, `
			INSERT INTO auth_password_reset_tokens (id, user_id, token_hash, expires_at, used_at, invalidated_at, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, t.ID, t.UserID, t.TokenHash, t.ExpiresAt, t.UsedAt, t.InvalidatedAt, t.CreatedAt)
		return err
	}
	email := ""
	if t.Email != nil {
		email = *t.Email
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO auth_email_verification_tokens (id, user_id, token_hash, email, expires_at, used_at, invalidated_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, t.ID, t.UserID, t.TokenHash, email, t.ExpiresAt, t.UsedAt, t.InvalidatedAt, t.CreatedAt)
	return err
}

func (s *Store) FindToken(ctx context.Context, kind auth.TokenKind, tokenHash string) (*auth.TokenRecord, error) {
	t := auth.TokenRecord{Kind: kind}
	var err error
	if kind == auth.TokenPasswordReset {
		err = s.db.QueryRow(ctx, `
			SELECT id::text, user_id::text, token_hash, expires_at, used_at, invalidated_at, created_at
			FROM auth_password_reset_tokens WHERE token_hash = $1`, tokenHash).
			Scan(&t.ID, &t.UserID, &t.TokenHash, &t.ExpiresAt, &t.UsedAt, &t.InvalidatedAt, &t.CreatedAt)
	} else {
		var email string
		err = s.db.QueryRow(ctx, `
			SELECT id::text, user_id::text, token_hash, email, expires_at, used_at, invalidated_at, created_at
			FROM auth_email_verification_tokens WHERE token_hash = $1`, tokenHash).
			Scan(&t.ID, &t.UserID, &t.TokenHash, &email, &t.ExpiresAt, &t.UsedAt, &t.InvalidatedAt, &t.CreatedAt)
		t.Email = &email
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ConsumeToken is a conditional update: at most one concurrent caller succeeds
// (AUTHN-RESET-009, AUTHN-VERIFY-006).
func (s *Store) ConsumeToken(ctx context.Context, id string, now time.Time) (bool, error) {
	if !isUUID(id) {
		return false, nil
	}
	for _, table := range []string{"auth_password_reset_tokens", "auth_email_verification_tokens"} {
		tag, err := s.db.Exec(ctx, `UPDATE `+table+` SET used_at = $2
			WHERE id = $1 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > $2`, id, now)
		if err != nil {
			return false, err
		}
		if tag.RowsAffected() == 1 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) InvalidateUserTokens(ctx context.Context, userID string, kind auth.TokenKind, at time.Time) error {
	if !isUUID(userID) {
		return nil
	}
	kinds := []auth.TokenKind{kind}
	if kind == auth.TokensAll {
		kinds = []auth.TokenKind{auth.TokenPasswordReset, auth.TokenEmailVerification}
	}
	for _, k := range kinds {
		if _, err := s.db.Exec(ctx, `UPDATE `+tokenTable(k)+` SET invalidated_at = $2
			WHERE user_id = $1 AND used_at IS NULL AND invalidated_at IS NULL`, userID, at); err != nil {
			return err
		}
	}
	return nil
}

// ── roles ──

// SyncRoles upserts configured roles and permissions and makes each configured
// role's permissions exact. Roles and permissions no longer in configuration are
// kept (deleting them would silently strip users' roles); remove them with a
// reviewed migration (AUTHZ-RBAC-005, DATA-MODEL-004).
func (s *Store) SyncRoles(ctx context.Context, roles map[string][]string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		for _, perms := range roles {
			for _, name := range perms {
				if _, err := tx.Exec(ctx, `INSERT INTO auth_permissions (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
					auth.NewID(), name); err != nil {
					return err
				}
			}
		}
		for name, perms := range roles {
			var roleID string
			system := name == "admin" || name == "user"
			if err := tx.QueryRow(ctx, `
				INSERT INTO auth_roles (id, name, is_system) VALUES ($1, $2, $3)
				ON CONFLICT (name) DO UPDATE SET is_system = EXCLUDED.is_system
				RETURNING id::text`, auth.NewID(), name, system).Scan(&roleID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				DELETE FROM auth_role_permissions WHERE role_id = $1
				AND permission_id NOT IN (SELECT id FROM auth_permissions WHERE name = ANY($2))`, roleID, perms); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO auth_role_permissions (role_id, permission_id)
				SELECT $1, id FROM auth_permissions WHERE name = ANY($2)
				ON CONFLICT DO NOTHING`, roleID, perms); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) GetUserRoles(ctx context.Context, userID string) ([]string, error) {
	if !isUUID(userID) {
		return []string{}, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.name FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id WHERE ur.user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if out == nil {
		out = []string{}
	}
	return out, err
}

func (s *Store) GetRolePermissions(ctx context.Context, roles []string) ([]string, error) {
	if len(roles) == 0 {
		return []string{}, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT p.name FROM auth_role_permissions rp
		JOIN auth_roles r ON r.id = rp.role_id JOIN auth_permissions p ON p.id = rp.permission_id
		WHERE r.name = ANY($1)`, roles)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if out == nil {
		out = []string{}
	}
	return out, err
}

func (s *Store) RoleExists(ctx context.Context, role string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM auth_roles WHERE name = $1)`, role).Scan(&exists)
	return exists, err
}

func (s *Store) AddUserRole(ctx context.Context, userID, role string, assignedBy *string, at time.Time) error {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO auth_user_roles (user_id, role_id, assigned_at, assigned_by)
		SELECT $1, id, $3, $4 FROM auth_roles WHERE name = $2
		ON CONFLICT DO NOTHING`, userID, role, at, assignedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if ok, err := s.RoleExists(ctx, role); err != nil {
			return err
		} else if !ok {
			return fmt.Errorf("role %q does not exist", role)
		}
	}
	return nil
}

func (s *Store) RemoveUserRole(ctx context.Context, userID, role string) error {
	if !isUUID(userID) {
		return nil
	}
	_, err := s.db.Exec(ctx, `
		DELETE FROM auth_user_roles WHERE user_id = $1 AND role_id = (SELECT id FROM auth_roles WHERE name = $2)`, userID, role)
	return err
}

func (s *Store) CountActiveUsersWithRole(ctx context.Context, role string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM auth_user_roles ur
		JOIN auth_roles r ON r.id = ur.role_id JOIN auth_users u ON u.id = ur.user_id
		WHERE r.name = $1 AND u.state = 'active'`, role).Scan(&n)
	return n, err
}

// ── audit ──

func (s *Store) RecordEvent(ctx context.Context, e auth.EventRecord) error {
	metadata := e.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO auth_security_events (id, type, outcome, occurred_at, user_id, actor_id, ip_address, user_agent, request_id, metadata)
		VALUES ($1, $2, $3::auth_event_outcome, $4, $5, $6, $7, $8, $9, $10)`,
		e.ID, e.Type, e.Outcome, e.OccurredAt, e.UserID, e.ActorID, e.IPAddress, e.UserAgent, e.RequestID, metadata)
	return err
}
