package auth

import (
	"sync"
	"time"
)

// Clock is the time source. It is injected so expiry is testable.
type Clock interface{ Now() time.Time }

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

// SystemClock is the real clock.
var SystemClock Clock = systemClock{}

// ManualClock moves only when told to (tests and conformance harness).
type ManualClock struct {
	mu  sync.Mutex
	cur time.Time
}

func NewManualClock() *ManualClock {
	return &ManualClock{cur: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *ManualClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.cur }
func (c *ManualClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.cur = c.cur.Add(d)
	c.mu.Unlock()
}

// ISO formats t like JavaScript's Date#toISOString, the wire format of every date.
func ISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
