package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/mongostore"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// mongoBackend is one fresh MongoDB database with the indexes `migrate up` creates, so every case
// is isolated and cases can run concurrently.
type mongoBackend struct {
	client *mongo.Client
	db     *mongo.Database
	st     *mongostore.Store
	rate   *mongostore.RateLimitStore
}

func newMongoBackend(ctx context.Context) (*mongoBackend, error) {
	raw := os.Getenv("TEST_MONGODB_URL")
	if raw == "" {
		return nil, errors.New("TEST_MONGODB_URL is not set")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	u.Path = "/t_" + strings.ReplaceAll(auth.NewID(), "-", "")[:12]
	client, db, err := mongostore.Open(ctx, u.String())
	if err != nil {
		return nil, err
	}
	b := &mongoBackend{client: client, db: db}
	if _, err := mongostore.EnsureIndexes(ctx, db); err != nil {
		b.close()
		return nil, err
	}
	b.st, b.rate = mongostore.New(db), mongostore.NewRateLimitStore(db)
	return b, nil
}

func (b *mongoBackend) store() auth.Store                   { return b.st }
func (b *mongoBackend) rateLimitStore() auth.RateLimitStore { return b.rate }

func (b *mongoBackend) close() {
	_ = b.db.Drop(context.Background())
	_ = b.client.Disconnect(context.Background())
}

// find returns the documents of a collection as plain maps, oldest first by sortKey.
func (b *mongoBackend) find(ctx context.Context, collection string, filter bson.M, sortKey string) ([]bson.M, error) {
	cur, err := b.db.Collection(collection).Find(ctx, filter, options.Find().SetSort(bson.D{{Key: sortKey, Value: 1}}))
	if err != nil {
		return nil, err
	}
	var docs []bson.M
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	return docs, nil
}

// jsonDoc turns a document into its JSON form: _id becomes id, dates become ISO strings.
func jsonDoc(doc bson.M, drop ...string) map[string]any {
	out := map[string]any{}
	for k, v := range doc {
		out[jsonKey(k)] = jsonBSON(v)
	}
	for _, k := range drop {
		delete(out, k)
	}
	return out
}

func jsonKey(k string) string {
	if k == "_id" {
		return "id"
	}
	return k
}

// asM reads an embedded document whichever Go type the driver decoded it into (bson.D by default).
func asM(v any) (bson.M, bool) {
	switch x := v.(type) {
	case bson.M:
		return x, true
	case map[string]any:
		return bson.M(x), true
	case bson.D:
		m := make(bson.M, len(x))
		for _, e := range x {
			m[e.Key] = e.Value
		}
		return m, true
	}
	return nil, false
}

// asA reads an array whichever Go type the driver decoded it into.
func asA(v any) ([]any, bool) {
	switch x := v.(type) {
	case bson.A:
		return x, true
	case []any:
		return x, true
	}
	return nil, false
}

func jsonBSON(v any) any {
	if m, ok := asM(v); ok {
		out := map[string]any{}
		for k, e := range m {
			out[k] = jsonBSON(e)
		}
		return out
	}
	if a, ok := asA(v); ok {
		out := make([]any, len(a))
		for i, e := range a {
			out[i] = jsonBSON(e)
		}
		return out
	}
	switch x := v.(type) {
	case bson.DateTime:
		return auth.ISO(x.Time().UTC())
	case time.Time:
		return auth.ISO(x.UTC())
	}
	return v
}

func (b *mongoBackend) inspect(ctx context.Context, entity string) ([]map[string]any, error) {
	out := []map[string]any{}
	switch entity {
	case "user":
		docs, err := b.find(ctx, "auth_users", bson.M{}, "createdAt")
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			u := jsonDoc(d, "credential", "roles")
			roles := []string{}
			if arr, ok := asA(d["roles"]); ok {
				for _, r := range arr {
					if m, ok := asM(r); ok {
						roles = append(roles, fmt.Sprint(m["name"]))
					}
				}
			}
			u["roles"] = roles
			out = append(out, u)
		}
	case "credential":
		docs, err := b.find(ctx, "auth_users", bson.M{"credential": bson.M{"$ne": nil}}, "createdAt")
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			c, _ := asM(d["credential"])
			row := jsonDoc(c)
			row["userId"], row["type"] = d["_id"], "password"
			out = append(out, row)
		}
	case "session":
		docs, err := b.find(ctx, "auth_sessions", bson.M{}, "createdAt")
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			out = append(out, jsonDoc(d))
		}
	case "passwordResetToken", "emailVerificationToken":
		kind := map[string]string{"passwordResetToken": "passwordReset", "emailVerificationToken": "emailVerification"}[entity]
		docs, err := b.find(ctx, "auth_one_time_tokens", bson.M{"kind": kind}, "createdAt")
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			row := jsonDoc(d, "kind")
			// Like the other drivers: an address only where the token has one.
			if _, ok := row["email"].(string); !ok {
				delete(row, "email")
			}
			out = append(out, row)
		}
	default:
		return nil, fmt.Errorf("unknown entity %q", entity)
	}
	return out, nil
}

func (b *mongoBackend) events(ctx context.Context) ([]map[string]any, error) {
	docs, err := b.find(ctx, "auth_security_events", bson.M{}, "_id")
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, d := range docs {
		row := jsonDoc(d)
		delete(row, "_id") // the event's own id is the "id" field; the ObjectId is only the order
		out = append(out, row)
	}
	return out, nil
}

func (b *mongoBackend) mutate(ctx context.Context, entity string, where, set map[string]any) error {
	collection := map[string]string{"user": "auth_users", "session": "auth_sessions"}[entity]
	if collection == "" {
		return fmt.Errorf("mutateStorage: unsupported entity %q", entity)
	}
	columns := mutableColumns[entity]
	convert := func(fields map[string]any) (bson.M, error) {
		out := bson.M{}
		for field, value := range fields {
			if _, ok := columns[field]; !ok {
				return nil, fmt.Errorf("mutateStorage %s: unsupported field %q", entity, field)
			}
			if s, isString := value.(string); isString && strings.HasSuffix(field, "At") {
				t, err := time.Parse(time.RFC3339Nano, s)
				if err != nil {
					return nil, err
				}
				value = t
			}
			key := field
			if field == "id" {
				key = "_id"
			}
			out[key] = value
		}
		return out, nil
	}
	filter, err := convert(where)
	if err != nil {
		return err
	}
	update, err := convert(set)
	if err != nil {
		return err
	}
	if len(update) == 0 {
		return errors.New("mutateStorage: nothing to set")
	}
	_, err = b.db.Collection(collection).UpdateMany(ctx, filter, bson.M{"$set": update})
	return err
}
