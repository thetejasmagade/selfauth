package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"selfauth-app/internal/auth"
	"selfauth-app/internal/store/migrations"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// DB is your application's own access to the database, for your own tables or collections. It is
// the same connection SelfAuth uses: SQL is set for PostgreSQL, MySQL and SQLite, Mongo for
// MongoDB. Both are nil on the in-memory store.
type DB struct {
	SQL   *sql.DB
	Mongo *mongo.Database
}

// Connection is an open database: the store, the shared rate-limit store, your application's
// handle on the same database, and how to close it.
type Connection struct {
	Store          auth.Store
	RateLimitStore auth.RateLimitStore
	DB             DB
	Close          func()
}

// Driver is one database: how to connect and how to migrate it. Each database has its own
// register_<name>.go, so a project contains only the databases it uses.
type Driver struct {
	Open    func(ctx context.Context, url string) (Connection, error)
	Status  func(ctx context.Context, url, dir string) (migrations.Status, error)
	Migrate func(ctx context.Context, url, dir string) ([]string, error)
}

var drivers = map[string]Driver{}

func register(name string, d Driver) { drivers[name] = d }

func driver(database string) (Driver, error) {
	d, ok := drivers[database]
	if !ok {
		names := make([]string, 0, len(drivers))
		for n := range drivers {
			names = append(names, n)
		}
		sort.Strings(names)
		return Driver{}, fmt.Errorf("database %q is not built into this project (available: %s, memory)", database, strings.Join(names, ", "))
	}
	return d, nil
}

// Connect opens the database named by adapter.database at url. It does not migrate or seed
// anything (DATA-MODEL-003).
func Connect(ctx context.Context, database, url string) (Connection, error) {
	d, err := driver(database)
	if err != nil {
		return Connection{}, err
	}
	return d.Open(ctx, url)
}

// MigrationStatus reports applied and pending migrations in dir without changing anything.
func MigrationStatus(ctx context.Context, database, url, dir string) (migrations.Status, error) {
	d, err := driver(database)
	if err != nil {
		return migrations.Status{}, err
	}
	return d.Status(ctx, url, dir)
}

// Migrate applies the pending migrations in dir and returns their names.
func Migrate(ctx context.Context, database, url, dir string) ([]string, error) {
	d, err := driver(database)
	if err != nil {
		return nil, err
	}
	return d.Migrate(ctx, url, dir)
}
