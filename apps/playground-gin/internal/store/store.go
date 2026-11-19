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
)

// Stores are the backends the application uses.
type Stores struct {
	Store          auth.Store
	RateLimitStore auth.RateLimitStore
	// DB is for your own routes' tables; empty on the in-memory store.
	DB    DB
	Close func()
}

// New creates the store for cfg. With a database configured it uses DATABASE_URL; without one it
// falls back to the in-memory store outside production. It never migrates or seeds a database on
// startup (DATA-MODEL-003, AUTHZ-RBAC-005): run `go run ./cmd/migrate up` and `go run ./cmd/seed`
// first.
func New(ctx context.Context, cfg *config.Config, env config.Env) (Stores, error) {
	database := cfg.Adapter.Database
	if database != "memory" {
		if _, err := driver(database); err != nil {
			return Stores{}, err
		}
		if url := os.Getenv("DATABASE_URL"); url != "" {
			return open(ctx, cfg, database, url)
		}
	}
	if env.Production() {
		return Stores{}, errors.New("DATABASE_URL is required in production; the in-memory store loses all data on restart")
	}
	m := memory.New()
	// Memory does not persist, so roles are synchronized on every start.
	if err := m.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		return Stores{}, err
	}
	log.Println("Using in-memory store (set DATABASE_URL to use " + database + ").")
	return Stores{Store: m, Close: func() {}}, nil
}

func open(ctx context.Context, cfg *config.Config, database, url string) (Stores, error) {
	conn, err := Connect(ctx, database, url)
	if err != nil {
		return Stores{}, err
	}
	for _, role := range cfg.Authorization.DefaultRoles {
		ok, err := conn.Store.RoleExists(ctx, role)
		if err != nil {
			conn.Close()
			return Stores{}, fmt.Errorf("cannot read roles (did you run the migrations?): %w", err)
		}
		if !ok {
			conn.Close()
			return Stores{}, fmt.Errorf("role %q is missing in the database: run `go run ./cmd/migrate up` and `go run ./cmd/seed` first", role)
		}
	}
	log.Printf("Using %s store.", database)
	return Stores{Store: conn.Store, RateLimitStore: conn.RateLimitStore, DB: conn.DB, Close: conn.Close}, nil
}
