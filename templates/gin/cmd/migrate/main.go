// Command migrate applies the SQL migrations in db/migrations.
//
//	DATABASE_URL=postgres://... go run ./cmd/migrate status
//	DATABASE_URL=postgres://... go run ./cmd/migrate up
//
// It never runs at application startup (DATA-MODEL-003). Read a new migration
// before you apply it; there is no automatic rollback, so take a backup first.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"selfauth-app/internal/store/postgres"
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
	ctx := context.Background()
	migrations, err := postgres.LoadMigrations(*dir)
	if err != nil {
		return err
	}
	db, err := postgres.Open(ctx, postgres.Options{URL: url})
	if err != nil {
		return err
	}
	defer db.Close()

	if command == "status" {
		st, err := postgres.Status(ctx, db, migrations)
		if err != nil {
			return err
		}
		fmt.Printf("applied: %v\npending: %v\n", st.Applied, st.Pending)
		return nil
	}
	if os.Getenv("APP_ENV") == "production" {
		fmt.Println("Production database: make sure a recent backup exists.")
	}
	ran, err := postgres.Migrate(ctx, db, migrations)
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
