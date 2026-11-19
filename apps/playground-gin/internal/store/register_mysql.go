package store

import (
	"context"

	"example.com/app/internal/store/migrations"
	"example.com/app/internal/store/sqlstore"
)

func init() {
	register("mysql", Driver{
		Open: func(ctx context.Context, url string) (Connection, error) {
			db, err := sqlstore.Open(ctx, sqlstore.MySQL, url)
			if err != nil {
				return Connection{}, err
			}
			return Connection{
				Store:          sqlstore.New(db, sqlstore.MySQL),
				RateLimitStore: sqlstore.NewRateLimitStore(db, sqlstore.MySQL),
				Close:          func() { _ = db.Close() },
			}, nil
		},
		Status: func(ctx context.Context, url, dir string) (migrations.Status, error) {
			all, err := migrations.Load(dir)
			if err != nil {
				return migrations.Status{}, err
			}
			return sqlstore.MigrationStatus(ctx, sqlstore.MySQL, url, all)
		},
		Migrate: func(ctx context.Context, url, dir string) ([]string, error) {
			all, err := migrations.Load(dir)
			if err != nil {
				return nil, err
			}
			return sqlstore.Migrate(ctx, sqlstore.MySQL, url, all)
		},
	})
}
