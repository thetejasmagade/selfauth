package store

import (
	"context"

	"github.com/jackc/pgx/v5/stdlib"
	"selfauth-app/internal/store/migrations"
	"selfauth-app/internal/store/postgres"
)

func init() {
	register("postgresql", Driver{
		Open: func(ctx context.Context, url string) (Connection, error) {
			db, err := postgres.Open(ctx, postgres.Options{URL: url})
			if err != nil {
				return Connection{}, err
			}
			// Your routes get database/sql on the same pool, like the other SQL databases.
			sqlDB := stdlib.OpenDBFromPool(db)
			return Connection{
				Store:          postgres.New(db),
				RateLimitStore: postgres.NewRateLimitStore(db),
				DB:             DB{SQL: sqlDB},
				Close:          func() { _ = sqlDB.Close(); db.Close() },
			}, nil
		},
		Status: func(ctx context.Context, url, dir string) (migrations.Status, error) {
			all, err := migrations.Load(dir)
			if err != nil {
				return migrations.Status{}, err
			}
			db, err := postgres.Open(ctx, postgres.Options{URL: url})
			if err != nil {
				return migrations.Status{}, err
			}
			defer db.Close()
			st, err := postgres.Status(ctx, db, toPostgres(all))
			return migrations.Status{Applied: st.Applied, Pending: st.Pending}, err
		},
		Migrate: func(ctx context.Context, url, dir string) ([]string, error) {
			all, err := migrations.Load(dir)
			if err != nil {
				return nil, err
			}
			db, err := postgres.Open(ctx, postgres.Options{URL: url})
			if err != nil {
				return nil, err
			}
			defer db.Close()
			return postgres.Migrate(ctx, db, toPostgres(all))
		},
	})
}

func toPostgres(in []migrations.Migration) []postgres.Migration {
	out := make([]postgres.Migration, len(in))
	for i, m := range in {
		out[i] = postgres.Migration{Name: m.Name, SQL: m.SQL, Checksum: m.Checksum}
	}
	return out
}
