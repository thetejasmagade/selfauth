// Package store chooses the persistence backend.
package store

import (
	"context"
	"errors"
	"fmt"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/store/memory"
)

// Stores are the backends the application uses.
type Stores struct {
	Store          auth.Store
	RateLimitStore auth.RateLimitStore
	Close          func()
}

// New creates the store for cfg. It never migrates or seeds a database on
// startup (DATA-MODEL-003, AUTHZ-RBAC-005).
func New(ctx context.Context, cfg *config.Config, env config.Env) (Stores, error) {
	if cfg.Adapter.Database != "memory" {
		return Stores{}, fmt.Errorf("database %q is not supported by this adapter yet (supported: memory)", cfg.Adapter.Database)
	}
	if env.Production() {
		return Stores{}, errors.New("a database is required in production; the in-memory store loses all data on restart")
	}
	m := memory.New()
	// Memory does not persist, so roles are synchronized on every start.
	if err := m.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		return Stores{}, err
	}
	return Stores{Store: m, Close: func() {}}, nil
}
