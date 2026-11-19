package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"selfauth-app/internal/auth"
)

// RateLimitStore is the shared PostgreSQL rate-limit store (SEC-RATE-006); one
// row lock per key makes concurrent updates of a key serialize.
type RateLimitStore struct{ db *pgxpool.Pool }

var _ auth.RateLimitStore = (*RateLimitStore)(nil)

func NewRateLimitStore(db *pgxpool.Pool) *RateLimitStore { return &RateLimitStore{db: db} }

func (s *RateLimitStore) Update(ctx context.Context, key string, fn func(*auth.RateLimitRecord) *auth.RateLimitRecord) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		// Make sure the row exists, then lock it until the transaction ends (a new row reads as window 0).
		if _, err := tx.Exec(ctx, `
			INSERT INTO auth_rate_limits (key, count, window_ends_at, blocked_until, strikes, last_block_at)
			VALUES ($1, 0, to_timestamp(0), to_timestamp(0), 0, to_timestamp(0))
			ON CONFLICT (key) DO NOTHING`, key); err != nil {
			return err
		}
		var r auth.RateLimitRecord
		var windowEnds, blockedUntil, lastBlock time.Time
		if err := tx.QueryRow(ctx, `
			SELECT count, window_ends_at, blocked_until, strikes, last_block_at
			FROM auth_rate_limits WHERE key = $1 FOR UPDATE`, key).
			Scan(&r.Count, &windowEnds, &blockedUntil, &r.Strikes, &lastBlock); err != nil {
			return err
		}
		r.WindowEndsAt, r.BlockedUntil, r.LastBlockAt = windowEnds.UnixMilli(), blockedUntil.UnixMilli(), lastBlock.UnixMilli()
		var current *auth.RateLimitRecord
		if r.WindowEndsAt != 0 {
			current = &r
		}
		next := fn(current)
		if next == nil {
			return nil
		}
		_, err := tx.Exec(ctx, `
			UPDATE auth_rate_limits SET count = $2, window_ends_at = $3, blocked_until = $4, strikes = $5, last_block_at = $6
			WHERE key = $1`, key, next.Count, time.UnixMilli(next.WindowEndsAt), time.UnixMilli(next.BlockedUntil),
			next.Strikes, time.UnixMilli(next.LastBlockAt))
		return err
	})
}

func (s *RateLimitStore) Delete(ctx context.Context, key string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM auth_rate_limits WHERE key = $1`, key)
	return err
}
