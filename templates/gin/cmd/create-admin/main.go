// Command create-admin grants the admin role to an existing, active account. The
// first administrator can only be created by a developer-run command like this
// one, never through the API (AUTHZ-ADMIN-005):
//
//	DATABASE_URL=postgres://... go run ./cmd/create-admin you@example.com
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"selfauth-app/internal/auth"
	"selfauth-app/internal/store/postgres"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	url := os.Getenv("DATABASE_URL")
	if url == "" || len(os.Args) != 2 {
		return errors.New("usage: DATABASE_URL=... create-admin <email>")
	}
	email := os.Args[1]
	ctx := context.Background()
	db, err := postgres.Open(ctx, postgres.Options{URL: url})
	if err != nil {
		return err
	}
	defer db.Close()
	store := postgres.New(db)

	user, err := store.FindUserByEmail(ctx, auth.NormalizeEmail(email))
	if err != nil {
		return err
	}
	if user == nil || user.State != auth.StateActive {
		return errors.New("no active account with that email: register and verify it first")
	}
	if ok, err := store.RoleExists(ctx, auth.AdminRole); err != nil {
		return err
	} else if !ok {
		return errors.New("the admin role does not exist yet: run the seed command first")
	}
	now := time.Now().Truncate(time.Millisecond)
	if err := store.AddUserRole(ctx, user.ID, auth.AdminRole, nil, now); err != nil {
		return err
	}
	agent := "selfauth create-admin"
	if err := store.RecordEvent(ctx, auth.EventRecord{
		ID: auth.NewID(), Type: "role.assigned", Outcome: "success", OccurredAt: now,
		UserID: &user.ID, UserAgent: &agent, Metadata: map[string]any{"role": "admin", "via": "cli"},
	}); err != nil {
		return err
	}
	fmt.Printf("%s is now an administrator.\n", email)
	return nil
}
