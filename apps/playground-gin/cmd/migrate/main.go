// Command migrate applies the SQL migrations in db/migrations.
//
//	DATABASE_URL=... go run ./cmd/migrate status
//	DATABASE_URL=... go run ./cmd/migrate up
//
// It never runs at application startup (DATA-MODEL-003). Read a new migration
// before you apply it; there is no automatic rollback, so take a backup first.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"example.com/app/internal/config"
	"example.com/app/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	dir := flag.String("dir", "db/migrations", "directory of migrations")
	flag.Parse()
	command := flag.Arg(0)
	if command != "status" && command != "up" {
		return fmt.Errorf("usage: migrate [-dir db/migrations] status|up")
	}
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
	database := cfg.Adapter.Database
	ctx := context.Background()

	if command == "status" {
		st, err := store.MigrationStatus(ctx, database, url, *dir)
		if err != nil {
			return err
		}
		fmt.Printf("applied: %v\npending: %v\n", st.Applied, st.Pending)
		return nil
	}
	if os.Getenv("APP_ENV") == "production" {
		fmt.Println("Production database: make sure a recent backup exists.")
	}
	ran, err := store.Migrate(ctx, database, url, *dir)
	if err != nil {
		return err
	}
	if len(ran) == 0 {
		fmt.Println("No pending migrations.")
		return nil
	}
	fmt.Printf("Applied: %v\n", ran)
	return nil
}
