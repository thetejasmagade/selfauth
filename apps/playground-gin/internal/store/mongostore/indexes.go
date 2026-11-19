package mongostore

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// index is one index SelfAuth needs. The names are MongoDB's defaults, which are also the ones the
// TypeScript store creates.
type index struct {
	collection string
	name       string
	keys       bson.D
	unique     bool
	partial    bson.D
}

var indexes = []index{
	// Unique among non-deleted users: the address is cleared on deletion (IDENT-EMAIL-003).
	{usersC, "emailNormalized_1", bson.D{{Key: "emailNormalized", Value: 1}}, true,
		bson.D{{Key: "emailNormalized", Value: bson.D{{Key: "$type", Value: "string"}}}}},
	{usersC, "roles.name_1", bson.D{{Key: "roles.name", Value: 1}}, false, nil},
	{sessionsC, "tokenHash_1", bson.D{{Key: "tokenHash", Value: 1}}, true, nil},
	{sessionsC, "userId_1", bson.D{{Key: "userId", Value: 1}}, false, nil},
	{sessionsC, "absoluteExpiresAt_1", bson.D{{Key: "absoluteExpiresAt", Value: 1}}, false, nil},
	{tokensC, "kind_1_tokenHash_1", bson.D{{Key: "kind", Value: 1}, {Key: "tokenHash", Value: 1}}, true, nil},
	{tokensC, "userId_1", bson.D{{Key: "userId", Value: 1}}, false, nil},
	{eventsC, "occurredAt_1", bson.D{{Key: "occurredAt", Value: 1}}, false, nil},
	{eventsC, "userId_1", bson.D{{Key: "userId", Value: 1}}, false, nil},
}

// MissingIndexes lists the indexes the database needs and does not have yet ("collection.name").
// A collection that does not exist yet has none.
func MissingIndexes(ctx context.Context, db *mongo.Database) ([]string, error) {
	have := map[string]map[string]struct{}{}
	var missing []string
	for _, ix := range indexes {
		if _, ok := have[ix.collection]; !ok {
			names := map[string]struct{}{}
			cur, err := db.Collection(ix.collection).Indexes().List(ctx)
			switch {
			case err == nil:
				var specs []struct {
					Name string `bson:"name"`
				}
				if err := cur.All(ctx, &specs); err != nil {
					return nil, err
				}
				for _, s := range specs {
					names[s.Name] = struct{}{}
				}
			case isNamespaceNotFound(err):
			default:
				return nil, err
			}
			have[ix.collection] = names
		}
		if _, ok := have[ix.collection][ix.name]; !ok {
			missing = append(missing, ix.collection+"."+ix.name)
		}
	}
	return missing, nil
}

func isNamespaceNotFound(err error) bool {
	var ce mongo.CommandError
	return errors.As(err, &ce) && ce.Code == 26
}

// EnsureIndexes creates the missing indexes and returns their names. It never drops one.
func EnsureIndexes(ctx context.Context, db *mongo.Database) ([]string, error) {
	missing, err := MissingIndexes(ctx, db)
	if err != nil || len(missing) == 0 {
		return nil, err
	}
	want := map[string]struct{}{}
	for _, m := range missing {
		want[m] = struct{}{}
	}
	var created []string
	for _, ix := range indexes {
		if _, ok := want[ix.collection+"."+ix.name]; !ok {
			continue
		}
		opts := options.Index().SetName(ix.name).SetUnique(ix.unique)
		if ix.partial != nil {
			opts.SetPartialFilterExpression(ix.partial)
		}
		if _, err := db.Collection(ix.collection).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: ix.keys, Options: opts}); err != nil {
			return created, fmt.Errorf("create index %s.%s: %w", ix.collection, ix.name, err)
		}
		created = append(created, ix.collection+"."+ix.name)
	}
	return created, nil
}
