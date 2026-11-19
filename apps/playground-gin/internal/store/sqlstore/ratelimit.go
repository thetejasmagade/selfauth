package sqlstore

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"example.com/app/internal/auth"
	"github.com/go-sql-driver/mysql"
)

func isDeadlock(err error) bool {
	var m *mysql.MySQLError
	return errors.As(err, &m) && (m.Number == 1213 || m.Number == 1205)
}

// RateLimitStore is the shared rate-limit store (SEC-RATE-006). On MySQL one row lock per key makes
// concurrent updates of a key serialize; SQLite runs one connection, so updates queue.
type RateLimitStore struct {
	db *sql.DB
	d  dialect
}

var _ auth.RateLimitStore = (*RateLimitStore)(nil)

func NewRateLimitStore(db *sql.DB, kind Kind) *RateLimitStore {
	return &RateLimitStore{db: db, d: dialectFor(kind)}
}

func (s *RateLimitStore) Update(ctx context.Context, key string, fn func(*auth.RateLimitRecord) *auth.RateLimitRecord) error {
	// Make sure the row exists first, outside the locking transaction: inserting inside it makes two
	// concurrent updates of a new key wait on each other's insert locks and deadlock (a new row reads
	// as window 0).
	zero := s.d.t(time.UnixMilli(0))
	if _, err := s.db.ExecContext(ctx, s.d.insertIgnore+` auth_rate_limits (`+"`key`"+`, count, window_ends_at, blocked_until, strikes, last_block_at)
		VALUES (?, 0, ?, ?, 0, ?)`, key, zero, zero, zero); err != nil {
		return err
	}
	// A deadlock victim is retried: the update has not been applied, so running it again is safe.
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		if err = s.update(ctx, key, fn); !isDeadlock(err) {
			return err
		}
	}
	return err
}

func (s *RateLimitStore) update(ctx context.Context, key string, fn func(*auth.RateLimitRecord) *auth.RateLimitRecord) error {
	return inTx(ctx, s.db, func(tx *sql.Tx) error {
		// Lock the row until the transaction ends.
		var r auth.RateLimitRecord
		var windowEnds, blockedUntil, lastBlock nullTime
		if err := tx.QueryRowContext(ctx, `
			SELECT count, window_ends_at, blocked_until, strikes, last_block_at
			FROM auth_rate_limits WHERE `+"`key`"+` = ?`+s.d.lock, key).
			Scan(&r.Count, &windowEnds, &blockedUntil, &r.Strikes, &lastBlock); err != nil {
			return err
		}
		r.WindowEndsAt, r.BlockedUntil, r.LastBlockAt = windowEnds.val().UnixMilli(), blockedUntil.val().UnixMilli(), lastBlock.val().UnixMilli()
		var current *auth.RateLimitRecord
		if r.WindowEndsAt != 0 {
			current = &r
		}
		next := fn(current)
		if next == nil {
			return nil
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE auth_rate_limits SET count = ?, window_ends_at = ?, blocked_until = ?, strikes = ?, last_block_at = ?
			WHERE `+"`key`"+` = ?`, next.Count, s.d.t(time.UnixMilli(next.WindowEndsAt)), s.d.t(time.UnixMilli(next.BlockedUntil)),
			next.Strikes, s.d.t(time.UnixMilli(next.LastBlockAt)), key)
		return err
	})
}

func (s *RateLimitStore) Delete(ctx context.Context, key string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_rate_limits WHERE `+"`key`"+` = ?`, key)
	return err
}
