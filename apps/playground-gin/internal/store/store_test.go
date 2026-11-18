package store

import (
	"context"
	"os"
	"testing"

	"example.com/app/internal/config"
)

func load(t *testing.T, database string) *config.Config {
	t.Helper()
	raw, err := os.ReadFile("../config/testdata/default.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Adapter.Database = database
	return cfg
}

// CONF-FILE-004: the schema describes every adapter; this one implements only some of it.
func TestUnsupportedDatabasesAreRefused(t *testing.T) {
	for _, db := range []string{"mysql", "sqlite", "mongodb"} {
		if _, err := New(context.Background(), load(t, db), config.Env{NodeEnv: "development"}); err == nil {
			t.Errorf("database %q accepted", db)
		}
	}
}

func TestMemoryStoreIsNotUsedInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	for _, db := range []string{"memory", "postgresql"} {
		if _, err := New(context.Background(), load(t, db), config.Env{NodeEnv: "production"}); err == nil {
			t.Errorf("%s without DATABASE_URL started in production", db)
		}
	}
}

func TestDevelopmentFallsBackToMemory(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	s, err := New(context.Background(), load(t, "postgresql"), config.Env{NodeEnv: "development"})
	if err != nil || s.Store == nil {
		t.Fatalf("%v", err)
	}
}
