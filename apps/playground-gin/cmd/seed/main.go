// Command seed synchronizes the roles and permissions in selfauth.config.json
// into the database (AUTHZ-RBAC-005). Run it after migrating and whenever the
// configured roles change:
//
//	DATABASE_URL=postgres://... go run ./cmd/seed
package main

import (
	"context"
	"fmt"
	"os"
	"sort"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
	"example.com/app/internal/store/postgres"
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
	db, err := postgres.Open(ctx, postgres.Options{URL: url})
	if err != nil {
		return err
	}
	defer db.Close()
	roles := auth.RoleDefinitions(cfg)
	if err := postgres.New(db).SyncRoles(ctx, roles); err != nil {
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
