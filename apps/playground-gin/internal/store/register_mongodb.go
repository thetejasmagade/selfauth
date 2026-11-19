package store

import (
	"context"
	"fmt"
	"strings"

	"example.com/app/internal/store/migrations"
	"example.com/app/internal/store/mongostore"
)

// MongoDB has no migrations, only indexes: "pending" lists the indexes `migrate up` would create.
func init() {
	register("mongodb", Driver{
		Open: func(ctx context.Context, url string) (Connection, error) {
			client, db, err := mongostore.Open(ctx, url)
			if err != nil {
				return Connection{}, err
			}
			closeClient := func() { _ = client.Disconnect(context.Background()) }
			// The unique email index is what keeps accounts unique, so the server refuses to run without it.
			missing, err := mongostore.MissingIndexes(ctx, db)
			if err != nil {
				closeClient()
				return Connection{}, err
			}
			if len(missing) > 0 {
				closeClient()
				return Connection{}, fmt.Errorf("the database is missing indexes (%s): run `go run ./cmd/migrate up` first", strings.Join(missing, ", "))
			}
			return Connection{Store: mongostore.New(db), RateLimitStore: mongostore.NewRateLimitStore(db), DB: DB{Mongo: db}, Close: closeClient}, nil
		},
		Status: func(ctx context.Context, url, _ string) (migrations.Status, error) {
			client, db, err := mongostore.Open(ctx, url)
			if err != nil {
				return migrations.Status{}, err
			}
			defer func() { _ = client.Disconnect(context.Background()) }()
			missing, err := mongostore.MissingIndexes(ctx, db)
			return migrations.Status{Pending: missing}, err
		},
		Migrate: func(ctx context.Context, url, _ string) ([]string, error) {
			client, db, err := mongostore.Open(ctx, url)
			if err != nil {
				return nil, err
			}
			defer func() { _ = client.Disconnect(context.Background()) }()
			return mongostore.EnsureIndexes(ctx, db)
		},
	})
}
