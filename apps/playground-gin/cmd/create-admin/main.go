// Command create-admin grants the admin role to an existing, active account. The
// first administrator can only be created by a developer-run command like this
// one, never through the API (AUTHZ-ADMIN-005):
//
//	DATABASE_URL=... go run ./cmd/create-admin you@example.com
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"example.com/app/internal/auth"
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
	url := os.Getenv("DATABASE_URL")
	if url == "" || len(os.Args) != 2 {
		return errors.New("usage: DATABASE_URL=... create-admin <email>")
	}
	email := os.Args[1]
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
	db := conn.Store

	user, err := db.FindUserByEmail(ctx, auth.NormalizeEmail(email))
	if err != nil {
		return err
	}
	if user == nil || user.State != auth.StateActive {
		return errors.New("no active account with that email: register and verify it first")
	}
	if ok, err := db.RoleExists(ctx, auth.AdminRole); err != nil {
		return err
	} else if !ok {
		return errors.New("the admin role does not exist yet: run the seed command first")
	}
	now := time.Now().Truncate(time.Millisecond)
	if err := db.AddUserRole(ctx, user.ID, auth.AdminRole, nil, now); err != nil {
		return err
	}
	agent := "selfauth create-admin"
	if err := db.RecordEvent(ctx, auth.EventRecord{
		ID: auth.NewID(), Type: "role.assigned", Outcome: "success", OccurredAt: now,
		UserID: &user.ID, UserAgent: &agent, Metadata: map[string]any{"role": "admin", "via": "cli"},
	}); err != nil {
		return err
	}
	fmt.Printf("%s is now an administrator.\n", email)
	return nil
}
