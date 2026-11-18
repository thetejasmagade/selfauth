package auth

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newLimiter() (*RateLimiter, *ManualClock) {
	clock := NewManualClock()
	return NewRateLimiter(NewMemoryRateLimitStore(), clock), clock
}

var rule = LimitRule{Limit: 3, WindowSeconds: 60}

func TestBlockStartsAtTheLimitAndExpires(t *testing.T) {
	l, clock := newLimiter()
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		r, _ := l.Hit(ctx, "k", rule)
		if !r.Allowed || r.JustBlocked != (i == 3) {
			t.Fatalf("hit %d: %+v", i, r)
		}
	}
	r, _ := l.Hit(ctx, "k", rule)
	if r.Allowed || r.RetryAfterSeconds != 60 || r.JustBlocked {
		t.Fatalf("expected a block of 60s, got %+v", r)
	}
	clock.Advance(61 * time.Second)
	if r, _ := l.Hit(ctx, "k", rule); !r.Allowed {
		t.Fatal("block must be temporary (SEC-RATE-003)")
	}
}

func TestRepeatedBlocksBackOffExponentially(t *testing.T) {
	l, clock := newLimiter()
	ctx := context.Background()
	for strike, want := range []int{60, 120, 240} {
		var last LimitResult
		for i := 0; i < 3; i++ {
			last, _ = l.Hit(ctx, "k", rule)
		}
		_ = last
		blocked, _ := l.Hit(ctx, "k", rule)
		if blocked.RetryAfterSeconds != want {
			t.Fatalf("strike %d: retry after %d, want %d", strike+1, blocked.RetryAfterSeconds, want)
		}
		clock.Advance(time.Duration(want+1) * time.Second)
	}
}

func TestResetForgetsTheKey(t *testing.T) {
	l, _ := newLimiter()
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		_, _ = l.Hit(ctx, "k", rule)
	}
	_ = l.Reset(ctx, "k")
	if r, _ := l.Hit(ctx, "k", rule); !r.Allowed || r.JustBlocked {
		t.Fatalf("%+v", r)
	}
}

// Concurrent attempts must not all read the same count (SEC-RATE-001).
func TestConcurrentHitsCountAtomically(t *testing.T) {
	l, _ := newLimiter()
	ctx := context.Background()
	var allowed, blockedNow atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, _ := l.Hit(ctx, "k", LimitRule{Limit: 5, WindowSeconds: 60})
			if r.Allowed {
				allowed.Add(1)
			}
			if r.JustBlocked {
				blockedNow.Add(1)
			}
		}()
	}
	wg.Wait()
	if allowed.Load() != 5 || blockedNow.Load() != 1 {
		t.Fatalf("allowed=%d justBlocked=%d, want 5 and 1", allowed.Load(), blockedNow.Load())
	}
}
