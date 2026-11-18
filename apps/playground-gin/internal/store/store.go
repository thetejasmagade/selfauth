// Package store chooses the persistence backend.
package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/store/memory"
	"example.com/app/internal/store/postgres"
)

// Stores are the backends the application uses.
type Stores struct {
	Store          auth.Store
	RateLimitStore auth.RateLimitStore
	Close          func()
}

// New creates the store for cfg. With PostgreSQL configured it uses DATABASE_URL;
// without one it falls back to the in-memory store outside production. It never
// migrates or seeds a database on startup (DATA-MODEL-003, AUTHZ-RBAC-005): run
// `go run ./cmd/migrate up` and `go run ./cmd/seed` first.
func New(ctx context.Context, cfg *config.Config, env config.Env) (Stores, error) {
	switch cfg.Adapter.Database {
	case "postgresql":
		if url := os.Getenv("DATABASE_URL"); url != "" {
			return newPostgres(ctx, cfg, url)
		}
	case "memory":
	default:
		return Stores{}, fmt.Errorf("database %q is not supported by this adapter (supported: postgresql, memory)", cfg.Adapter.Database)
	}
	if env.Production() {
		return Stores{}, errors.New("DATABASE_URL is required in production; the in-memory store loses all data on restart")
	}
	m := memory.New()
	// Memory does not persist, so roles are synchronized on every start.
	if err := m.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		return Stores{}, err
	}
	log.Println("Using in-memory store (set DATABASE_URL to use PostgreSQL).")
	return Stores{Store: m, Close: func() {}}, nil
}

func newPostgres(ctx context.Context, cfg *config.Config, url string) (Stores, error) {
	db, err := postgres.Open(ctx, postgres.Options{URL: url})
	if err != nil {
		return Stores{}, err
	}
	store := postgres.New(db)
	for _, role := range cfg.Authorization.DefaultRoles {
		ok, err := store.RoleExists(ctx, role)
		if err != nil {
			db.Close()
			return Stores{}, fmt.Errorf("cannot read roles (did you run the migrations?): %w", err)
		}
		if !ok {
			db.Close()
			return Stores{}, fmt.Errorf("role %q is missing in the database: run `go run ./cmd/migrate up` and `go run ./cmd/seed` first", role)
		}
	}
	log.Println("Using PostgreSQL store.")
	return Stores{Store: store, RateLimitStore: postgres.NewRateLimitStore(db), Close: db.Close}, nil
}
