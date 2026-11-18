package auth

import (
	"context"
	"sync"
	"time"
)

// RateLimitRecord is the state of one limiter key. Times are Unix milliseconds.
//
// Fixed-window limiter with exponential back-off (SEC-RATE-001…006, ADR 0015):
// each key allows `limit` hits per window. The hit that reaches the limit
// starts a block lasting window × 2^(strikes-1), capped at 24 h; strikes reset
// after 24 h without a block. Blocks are always temporary (SEC-RATE-003).
type RateLimitRecord struct {
	Count        int
	WindowEndsAt int64
	BlockedUntil int64
	Strikes      int
	LastBlockAt  int64
}

// RateLimitStore holds limiter state. Use a shared store across instances in
// production (SEC-RATE-006). Update MUST be atomic per key: concurrent updates of
// one key are serialized, so parallel attempts cannot all read the same count.
// fn receives the current record (nil if none) and returns the record to store,
// or nil to leave the key unchanged.
type RateLimitStore interface {
	Update(ctx context.Context, key string, fn func(current *RateLimitRecord) *RateLimitRecord) error
	Delete(ctx context.Context, key string) error
}

// MemoryRateLimitStore is per-process; correct only for a single application instance.
type MemoryRateLimitStore struct {
	mu      sync.Mutex
	records map[string]RateLimitRecord
}

func NewMemoryRateLimitStore() *MemoryRateLimitStore {
	return &MemoryRateLimitStore{records: map[string]RateLimitRecord{}}
}

func (s *MemoryRateLimitStore) Update(_ context.Context, key string, fn func(*RateLimitRecord) *RateLimitRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var current *RateLimitRecord
	if r, ok := s.records[key]; ok {
		copy := r
		current = &copy
	}
	if next := fn(current); next != nil {
		s.records[key] = *next
	}
	return nil
}

func (s *MemoryRateLimitStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	delete(s.records, key)
	s.mu.Unlock()
	return nil
}

// LimitRule is limit hits per window.
type LimitRule struct {
	Limit         int
	WindowSeconds int
}

// LimitResult is the outcome of a limiter call.
type LimitResult struct {
	Allowed           bool
	RetryAfterSeconds int
	// JustBlocked is true when this call started a new block (rate_limit.triggered event).
	JustBlocked bool
}

const (
	maxBlockMs    = int64(24 * time.Hour / time.Millisecond)
	strikeDecayMs = int64(24 * time.Hour / time.Millisecond)
)

type RateLimiter struct {
	store RateLimitStore
	clock Clock
}

func NewRateLimiter(store RateLimitStore, clock Clock) *RateLimiter {
	return &RateLimiter{store: store, clock: clock}
}

func load(existing *RateLimitRecord, rule LimitRule, now int64) RateLimitRecord {
	windowMs := int64(rule.WindowSeconds) * 1000
	if existing == nil {
		return RateLimitRecord{WindowEndsAt: now + windowMs}
	}
	r := *existing
	if now >= r.WindowEndsAt && now >= r.BlockedUntil {
		r.Count = 0
		r.WindowEndsAt = now + windowMs
	}
	if r.Strikes > 0 && now-r.LastBlockAt >= strikeDecayMs {
		r.Strikes = 0
	}
	return r
}

func blockedResult(r RateLimitRecord, now int64) (LimitResult, bool) {
	if r.BlockedUntil > now {
		secs := int((r.BlockedUntil - now + 999) / 1000)
		if secs < 1 {
			secs = 1
		}
		return LimitResult{Allowed: false, RetryAfterSeconds: secs}, true
	}
	return LimitResult{}, false
}

// Hit counts a hit. Rejected (and not counted) while blocked.
func (l *RateLimiter) Hit(ctx context.Context, key string, rule LimitRule) (LimitResult, error) {
	now := l.clock.Now().UnixMilli()
	var result LimitResult
	err := l.store.Update(ctx, key, func(current *RateLimitRecord) *RateLimitRecord {
		r := load(current, rule, now)
		if blocked, ok := blockedResult(r, now); ok {
			result = blocked
			return nil
		}
		r.Count++
		justBlocked := false
		if r.Count >= rule.Limit {
			r.Strikes++
			duration := int64(rule.WindowSeconds) * 1000
			for i := 1; i < r.Strikes && duration < maxBlockMs; i++ {
				duration *= 2
			}
			if duration > maxBlockMs {
				duration = maxBlockMs
			}
			r.BlockedUntil = now + duration
			r.LastBlockAt = now
			justBlocked = true
		}
		result = LimitResult{Allowed: true, JustBlocked: justBlocked}
		return &r
	})
	return result, err
}

// Reset forgets a key (a verified password ends guessing).
func (l *RateLimiter) Reset(ctx context.Context, key string) error {
	return l.store.Delete(ctx, key)
}
