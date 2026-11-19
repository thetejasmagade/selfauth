package sqlstore

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"
)

// Open connects to MySQL (mysql://user:password@host:3306/db) or SQLite (file:./app.db). It does
// not migrate or seed anything (DATA-MODEL-003).
func Open(ctx context.Context, kind Kind, rawURL string) (*sql.DB, error) {
	var db *sql.DB
	switch kind {
	case MySQL:
		connector, err := mysqlConnector(rawURL, false)
		if err != nil {
			return nil, err
		}
		db = sql.OpenDB(connector)
		db.SetMaxOpenConns(10)
		db.SetConnMaxLifetime(30 * time.Minute)
	case SQLite:
		dsn, err := sqliteDSN(rawURL)
		if err != nil {
			return nil, err
		}
		var openErr error
		if db, openErr = sql.Open("sqlite", dsn); openErr != nil {
			return nil, openErr
		}
		// One file, one writer: a single connection makes every transaction run on its own.
		db.SetMaxOpenConns(1)
	default:
		return nil, fmt.Errorf("unsupported database %q", kind)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("cannot reach the database: %w", err)
	}
	return db, nil
}

// mysqlConnector turns a mysql:// URL into driver settings. multiStatements is only for the
// migration runner, which executes a whole file.
func mysqlConnector(rawURL string, multi bool) (driver.Connector, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "mysql" || u.Host == "" {
		return nil, errors.New("invalid DATABASE_URL: expected mysql://user:password@host:3306/database")
	}
	cfg := mysql.NewConfig()
	cfg.User = u.User.Username()
	cfg.Passwd, _ = u.User.Password()
	cfg.Net = "tcp"
	cfg.Addr = u.Host
	if u.Port() == "" {
		cfg.Addr = u.Host + ":3306"
	}
	cfg.DBName = strings.TrimPrefix(u.Path, "/")
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.Collation = "utf8mb4_bin"
	cfg.MultiStatements = multi
	cfg.Params = map[string]string{}
	for k, v := range u.Query() {
		cfg.Params[k] = v[0]
	}
	return mysql.NewConnector(cfg)
}

func sqliteDSN(raw string) (string, error) {
	path := strings.TrimPrefix(strings.TrimPrefix(raw, "sqlite:"), "file:")
	if path == "" || strings.HasPrefix(raw, "mysql:") || strings.HasPrefix(raw, "postgres") {
		return "", errors.New(`invalid DATABASE_URL: expected a file, for example file:./app.db`)
	}
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "journal_mode(WAL)")
	// A transaction takes the write lock when it starts, so two of them never deadlock on an upgrade.
	q.Set("_txlock", "immediate")
	return "file:" + path + "?" + q.Encode(), nil
}

// Store implements auth.Store.
type Store struct {
	db *sql.DB
	d  dialect
}

var _ auth.Store = (*Store)(nil)

func New(db *sql.DB, kind Kind) *Store { return &Store{db: db, d: dialectFor(kind)} }

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }

func anySlice(in []string) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}

func inTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ── users ──

const userColumns = `id, email, email_normalized, email_verified_at, state, created_at, updated_at, deleted_at`

type scanner interface{ Scan(dest ...any) error }

func scanUser(row scanner) (*auth.UserRecord, error) {
	var u auth.UserRecord
	var state string
	var verified, created, updated, deleted nullTime
	err := row.Scan(&u.ID, &u.Email, &u.EmailNormalized, &verified, &state, &created, &updated, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.State = auth.AccountState(state)
	u.EmailVerifiedAt, u.CreatedAt, u.UpdatedAt, u.DeletedAt = verified.ptr(), created.val(), updated.val(), deleted.ptr()
	return &u, nil
}

func (s *Store) CreateUser(ctx context.Context, user auth.UserRecord, passwordHash string, roles []string) (auth.UserRecord, error) {
	// All-or-nothing: user, password credential and default roles (AUTHN-REG-003).
	err := inTx(ctx, s.db, func(tx *sql.Tx) error {
		var roleIDs []string
		if len(roles) > 0 {
			rows, err := tx.QueryContext(ctx, `SELECT id FROM auth_roles WHERE name IN (`+placeholders(len(roles))+`)`, anySlice(roles)...)
			if err != nil {
				return err
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					_ = rows.Close()
					return err
				}
				roleIDs = append(roleIDs, id)
			}
			if err := rows.Close(); err != nil {
				return err
			}
		}
		if len(roleIDs) != len(uniqueNames(roles)) {
			return fmt.Errorf("default roles are not synchronized: %s", strings.Join(roles, ", "))
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auth_users (id, email, email_normalized, email_verified_at, state, created_at, updated_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			user.ID, user.Email, user.EmailNormalized, s.d.tp(user.EmailVerifiedAt), string(user.State),
			s.d.t(user.CreatedAt), s.d.t(user.UpdatedAt), s.d.tp(user.DeletedAt)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at)
			VALUES (?, ?, 'password', ?, ?, ?)`, auth.NewID(), user.ID, passwordHash, s.d.t(user.CreatedAt), s.d.t(user.CreatedAt)); err != nil {
			return err
		}
		for _, roleID := range roleIDs {
			if _, err := tx.ExecContext(ctx, `INSERT INTO auth_user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)`,
				user.ID, roleID, s.d.t(user.CreatedAt)); err != nil {
				return err
			}
		}
		return nil
	})
	if s.d.isDuplicate(err, "email_normalized") {
		return auth.UserRecord{}, auth.ErrEmailTaken
	}
	return user, err
}

func uniqueNames(in []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, v := range in {
		out[v] = struct{}{}
	}
	return out
}

func (s *Store) FindUserByID(ctx context.Context, id string) (*auth.UserRecord, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM auth_users WHERE id = ?`, id))
}

func (s *Store) FindUserByEmail(ctx context.Context, emailNormalized string) (*auth.UserRecord, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM auth_users WHERE email_normalized = ? AND state <> 'deleted' LIMIT 1`, emailNormalized))
}

func (s *Store) UpdateUser(ctx context.Context, id string, p auth.UserPatch) error {
	var sets []string
	var args []any
	set := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, column+" = ?")
	}
	if p.State != nil {
		set("state", string(*p.State))
	}
	if p.EmailVerifiedAt != nil {
		set("email_verified_at", s.d.t(*p.EmailVerifiedAt))
	}
	if p.UpdatedAt != nil {
		set("updated_at", s.d.t(*p.UpdatedAt))
	}
	if p.DeletedAt != nil {
		set("deleted_at", s.d.t(*p.DeletedAt))
	}
	if p.ClearEmail {
		sets = append(sets, "email = NULL", "email_normalized = NULL")
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := s.db.ExecContext(ctx, `UPDATE auth_users SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	return err
}

// ── credentials ──

func (s *Store) GetPasswordHash(ctx context.Context, userID string) (string, bool, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT secret_hash FROM auth_credentials WHERE user_id = ? AND type = 'password'`, userID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return hash, err == nil, err
}

func (s *Store) SetPasswordHash(ctx context.Context, userID, hash string, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at)
		VALUES (?, ?, 'password', ?, ?, ?) `+s.d.upsertCredential, auth.NewID(), userID, hash, s.d.t(at), s.d.t(at))
	return err
}

func (s *Store) DeleteCredentials(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_credentials WHERE user_id = ?`, userID)
	return err
}

// ── sessions ──

const sessionColumns = `id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
	revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at`

func scanSession(row scanner) (*auth.SessionRecord, error) {
	var x auth.SessionRecord
	var reason *string
	var created, seen, idle, absolute, revoked, reauth nullTime
	err := row.Scan(&x.ID, &x.TokenHash, &x.UserID, &created, &seen, &idle, &absolute, &revoked, &reason, &x.IPAddress, &x.UserAgent, &reauth)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	x.CreatedAt, x.LastSeenAt, x.IdleExpiresAt, x.AbsoluteExpiresAt = created.val(), seen.val(), idle.val(), absolute.val()
	x.RevokedAt, x.ReauthenticatedAt = revoked.ptr(), reauth.ptr()
	if reason != nil {
		r := auth.SessionRevokedReason(*reason)
		x.RevokedReason = &r
	}
	return &x, nil
}

func (s *Store) CreateSession(ctx context.Context, x auth.SessionRecord) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth_sessions (id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
			revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
		x.ID, x.TokenHash, x.UserID, s.d.t(x.CreatedAt), s.d.t(x.LastSeenAt), s.d.t(x.IdleExpiresAt), s.d.t(x.AbsoluteExpiresAt),
		x.IPAddress, x.UserAgent, s.d.tp(x.ReauthenticatedAt))
	return err
}

func (s *Store) FindSessionByTokenHash(ctx context.Context, tokenHash string) (*auth.SessionRecord, error) {
	return scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM auth_sessions WHERE token_hash = ?`, tokenHash))
}

func (s *Store) FindSessionByID(ctx context.Context, id string) (*auth.SessionRecord, error) {
	return scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM auth_sessions WHERE id = ?`, id))
}

func (s *Store) TouchSession(ctx context.Context, id string, lastSeenAt, idleExpiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ? AND revoked_at IS NULL`,
		s.d.t(lastSeenAt), s.d.t(idleExpiresAt), id)
	return err
}

func (s *Store) RevokeSession(ctx context.Context, id string, reason auth.SessionRevokedReason, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`,
		s.d.t(at), string(reason), id)
	return err
}

func (s *Store) RevokeUserSessions(ctx context.Context, userID string, reason auth.SessionRevokedReason, at time.Time, except string) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ?
		WHERE user_id = ? AND revoked_at IS NULL AND (? = '' OR id <> ?)`,
		s.d.t(at), string(reason), userID, except, except)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}

func (s *Store) ListActiveSessions(ctx context.Context, userID string, now time.Time) ([]auth.SessionRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+sessionColumns+` FROM auth_sessions
		WHERE user_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?
		ORDER BY created_at ASC`, userID, s.d.t(now), s.d.t(now))
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
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO auth_password_reset_tokens (id, user_id, token_hash, expires_at, used_at, invalidated_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, t.ID, t.UserID, t.TokenHash, s.d.t(t.ExpiresAt), s.d.tp(t.UsedAt), s.d.tp(t.InvalidatedAt), s.d.t(t.CreatedAt))
		return err
	}
	email := ""
	if t.Email != nil {
		email = *t.Email
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth_email_verification_tokens (id, user_id, token_hash, email, expires_at, used_at, invalidated_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, t.ID, t.UserID, t.TokenHash, email, s.d.t(t.ExpiresAt), s.d.tp(t.UsedAt), s.d.tp(t.InvalidatedAt), s.d.t(t.CreatedAt))
	return err
}

func (s *Store) FindToken(ctx context.Context, kind auth.TokenKind, tokenHash string) (*auth.TokenRecord, error) {
	t := auth.TokenRecord{Kind: kind}
	var expires, used, invalidated, created nullTime
	var err error
	if kind == auth.TokenPasswordReset {
		err = s.db.QueryRowContext(ctx, `
			SELECT id, user_id, token_hash, expires_at, used_at, invalidated_at, created_at
			FROM auth_password_reset_tokens WHERE token_hash = ?`, tokenHash).
			Scan(&t.ID, &t.UserID, &t.TokenHash, &expires, &used, &invalidated, &created)
	} else {
		var email string
		err = s.db.QueryRowContext(ctx, `
			SELECT id, user_id, token_hash, email, expires_at, used_at, invalidated_at, created_at
			FROM auth_email_verification_tokens WHERE token_hash = ?`, tokenHash).
			Scan(&t.ID, &t.UserID, &t.TokenHash, &email, &expires, &used, &invalidated, &created)
		t.Email = &email
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.ExpiresAt, t.UsedAt, t.InvalidatedAt, t.CreatedAt = expires.val(), used.ptr(), invalidated.ptr(), created.val()
	return &t, nil
}

// ConsumeToken is a conditional update: at most one concurrent caller succeeds
// (AUTHN-RESET-009, AUTHN-VERIFY-006).
func (s *Store) ConsumeToken(ctx context.Context, id string, now time.Time) (bool, error) {
	for _, table := range []string{"auth_password_reset_tokens", "auth_email_verification_tokens"} {
		res, err := s.db.ExecContext(ctx, `UPDATE `+table+` SET used_at = ?
			WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`, s.d.t(now), id, s.d.t(now))
		if err != nil {
			return false, err
		}
		if n, err := res.RowsAffected(); err != nil {
			return false, err
		} else if n == 1 {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) InvalidateUserTokens(ctx context.Context, userID string, kind auth.TokenKind, at time.Time) error {
	kinds := []auth.TokenKind{kind}
	if kind == auth.TokensAll {
		kinds = []auth.TokenKind{auth.TokenPasswordReset, auth.TokenEmailVerification}
	}
	for _, k := range kinds {
		if _, err := s.db.ExecContext(ctx, `UPDATE `+tokenTable(k)+` SET invalidated_at = ?
			WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL`, s.d.t(at), userID); err != nil {
			return err
		}
	}
	return nil
}

// ── roles ──

// SyncRoles upserts configured roles and permissions and makes each configured role's permissions
// exact. Roles and permissions no longer in configuration are kept (deleting them would silently
// strip users' roles); remove them with a reviewed migration (AUTHZ-RBAC-005, DATA-MODEL-004).
func (s *Store) SyncRoles(ctx context.Context, roles map[string][]string) error {
	return inTx(ctx, s.db, func(tx *sql.Tx) error {
		for _, perms := range roles {
			for _, name := range perms {
				if _, err := tx.ExecContext(ctx, s.d.insertIgnore+` auth_permissions (id, name) VALUES (?, ?)`, auth.NewID(), name); err != nil {
					return err
				}
			}
		}
		for name, perms := range roles {
			system := name == "admin" || name == "user"
			if _, err := tx.ExecContext(ctx, `INSERT INTO auth_roles (id, name, is_system) VALUES (?, ?, ?) `+s.d.upsertRole,
				auth.NewID(), name, system); err != nil {
				return err
			}
			var roleID string
			if err := tx.QueryRowContext(ctx, `SELECT id FROM auth_roles WHERE name = ?`, name).Scan(&roleID); err != nil {
				return err
			}
			if len(perms) == 0 {
				if _, err := tx.ExecContext(ctx, `DELETE FROM auth_role_permissions WHERE role_id = ?`, roleID); err != nil {
					return err
				}
				continue
			}
			list := placeholders(len(perms))
			if _, err := tx.ExecContext(ctx, `
				DELETE FROM auth_role_permissions WHERE role_id = ?
				AND permission_id NOT IN (SELECT id FROM auth_permissions WHERE name IN (`+list+`))`,
				append([]any{roleID}, anySlice(perms)...)...); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, s.d.insertIgnore+` auth_role_permissions (role_id, permission_id)
				SELECT ?, id FROM auth_permissions WHERE name IN (`+list+`)`,
				append([]any{roleID}, anySlice(perms)...)...); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Store) names(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) GetUserRoles(ctx context.Context, userID string) ([]string, error) {
	return s.names(ctx, `SELECT r.name FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id WHERE ur.user_id = ?`, userID)
}

func (s *Store) GetRolePermissions(ctx context.Context, roles []string) ([]string, error) {
	if len(roles) == 0 {
		return []string{}, nil
	}
	return s.names(ctx, `
		SELECT DISTINCT p.name FROM auth_role_permissions rp
		JOIN auth_roles r ON r.id = rp.role_id JOIN auth_permissions p ON p.id = rp.permission_id
		WHERE r.name IN (`+placeholders(len(roles))+`)`, anySlice(roles)...)
}

func (s *Store) RoleExists(ctx context.Context, role string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM auth_roles WHERE name = ?`, role).Scan(&n)
	return n > 0, err
}

func (s *Store) AddUserRole(ctx context.Context, userID, role string, assignedBy *string, at time.Time) error {
	res, err := s.db.ExecContext(ctx, s.d.insertIgnore+` auth_user_roles (user_id, role_id, assigned_at, assigned_by)
		SELECT ?, id, ?, ? FROM auth_roles WHERE name = ?`, userID, s.d.t(at), assignedBy, role)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		if ok, err := s.RoleExists(ctx, role); err != nil {
			return err
		} else if !ok {
			return fmt.Errorf("role %q does not exist", role)
		}
	}
	return nil
}

func (s *Store) RemoveUserRole(ctx context.Context, userID, role string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_user_roles WHERE user_id = ? AND role_id = (SELECT id FROM auth_roles WHERE name = ?)`, userID, role)
	return err
}

func (s *Store) CountActiveUsersWithRole(ctx context.Context, role string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM auth_user_roles ur
		JOIN auth_roles r ON r.id = ur.role_id JOIN auth_users u ON u.id = ur.user_id
		WHERE r.name = ? AND u.state = 'active'`, role).Scan(&n)
	return n, err
}

// ── audit ──

func (s *Store) RecordEvent(ctx context.Context, e auth.EventRecord) error {
	metadata := e.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO auth_security_events (id, type, outcome, occurred_at, user_id, actor_id, ip_address, user_agent, request_id, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.Type, e.Outcome, s.d.t(e.OccurredAt), e.UserID, e.ActorID, e.IPAddress, e.UserAgent, e.RequestID, string(raw))
	return err
}
