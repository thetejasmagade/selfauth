package mongostore

import (
	"context"
	"errors"
	"time"

	"example.com/app/internal/auth"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type rateLimitDoc struct {
	Key          string    `bson:"_id"`
	Count        int       `bson:"count"`
	WindowEndsAt time.Time `bson:"windowEndsAt"`
	BlockedUntil time.Time `bson:"blockedUntil"`
	Strikes      int       `bson:"strikes"`
	LastBlockAt  time.Time `bson:"lastBlockAt"`
	// V is the compare-and-swap version.
	V int `bson:"v"`
}

// RateLimitStore is the shared MongoDB rate-limit store (SEC-RATE-006): compare-and-swap on a
// version number.
type RateLimitStore struct{ c *mongo.Collection }

var _ auth.RateLimitStore = (*RateLimitStore)(nil)

func NewRateLimitStore(db *mongo.Database) *RateLimitStore {
	return &RateLimitStore{c: db.Collection(rateLimitC)}
}

func (s *RateLimitStore) Update(ctx context.Context, key string, fn func(*auth.RateLimitRecord) *auth.RateLimitRecord) error {
	// Concurrent updates of one key serialize: only one compare-and-swap wins, the rest re-read.
	for attempt := 0; attempt < 100; attempt++ {
		var doc rateLimitDoc
		found := true
		if err := s.c.FindOne(ctx, bson.M{"_id": key}).Decode(&doc); err != nil {
			if !errors.Is(err, mongo.ErrNoDocuments) {
				return err
			}
			found = false
		}
		var current *auth.RateLimitRecord
		if found {
			current = &auth.RateLimitRecord{
				Count: doc.Count, WindowEndsAt: doc.WindowEndsAt.UnixMilli(), BlockedUntil: doc.BlockedUntil.UnixMilli(),
				Strikes: doc.Strikes, LastBlockAt: doc.LastBlockAt.UnixMilli(),
			}
		}
		next := fn(current)
		if next == nil {
			return nil
		}
		fields := bson.M{
			"count": next.Count, "windowEndsAt": time.UnixMilli(next.WindowEndsAt), "blockedUntil": time.UnixMilli(next.BlockedUntil),
			"strikes": next.Strikes, "lastBlockAt": time.UnixMilli(next.LastBlockAt),
		}
		if !found {
			fields["_id"], fields["v"] = key, 1
			if _, err := s.c.InsertOne(ctx, fields); err != nil {
				if mongo.IsDuplicateKeyError(err) {
					continue // another request created the row first
				}
				return err
			}
			return nil
		}
		fields["v"] = doc.V + 1
		res, err := s.c.UpdateOne(ctx, bson.M{"_id": key, "v": doc.V}, bson.M{"$set": fields})
		if err != nil {
			return err
		}
		if res.ModifiedCount == 1 {
			return nil
		}
	}
	return errors.New("rate-limit counter is too contended to update")
}

func (s *RateLimitStore) Delete(ctx context.Context, key string) error {
	_, err := s.c.DeleteOne(ctx, bson.M{"_id": key})
	return err
}
