package main

import (
	"context"

	"example.com/app/internal/auth"
)

// backend is a store plus the test-only views the conformance driver needs.
type backend interface {
	store() auth.Store
	rateLimitStore() auth.RateLimitStore
	// inspect returns the records of a logical entity (DATA_MODEL.md names).
	inspect(ctx context.Context, entity string) ([]map[string]any, error)
	// mutate changes stored fields directly (conformance mutateStorage).
	mutate(ctx context.Context, entity string, where, set map[string]any) error
	// events returns security events in insertion order.
	events(ctx context.Context) ([]map[string]any, error)
	close()
}
