// Command seed synchronizes the roles and permissions in selfauth.config.json
// into the database (AUTHZ-RBAC-005). Run it after migrating and whenever the
// configured roles change:
//
//	DATABASE_URL=... go run ./cmd/seed
package main

import (
	"context"
	"fmt"
	"os"
	"sort"

	"selfauth-app/internal/auth"
	"selfauth-app/internal/config"
	"selfauth-app/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	path := os.Getenv("SELFAUTH_CONFIG")
	if path == "" {
		path = "selfauth.config.json"
	}
	cfg, err := config.Load(path)
	if err != nil {
		return err
	}
	ctx := context.Background()
	conn, err := store.Connect(ctx, cfg.Adapter.Database, url)
	if err != nil {
		return err
	}
	defer conn.Close()
	roles := auth.RoleDefinitions(cfg)
	if err := conn.Store.SyncRoles(ctx, roles); err != nil {
		return err
	}
	names := make([]string, 0, len(roles))
	for name := range roles {
		names = append(names, name)
	}
	sort.Strings(names)
	fmt.Printf("Synchronized roles: %v\n", names)
	return nil
}
