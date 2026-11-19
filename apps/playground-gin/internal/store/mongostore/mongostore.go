// Package mongostore is the auth.Store for MongoDB (mongo-driver v2). It uses the same collections
// and document shapes as the TypeScript store, so a database can move between the two apps.
//
// Atomicity (DATA-MODEL-002) without transactions, so it works on a standalone server as well as a
// replica set:
//   - the credential and the role links are embedded in the user document, so creating a user is
//     one write (all or nothing);
//   - token consumption and session revocation are conditional updates;
//   - rate-limit counters are updated with compare-and-swap on a version number, retried on a clash.
//
// Indexes are created by `go run ./cmd/migrate up`, never at start-up (DATA-MODEL-003); start-up
// refuses to run without them, because the unique email index is what keeps accounts unique.
package mongostore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"example.com/app/internal/auth"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/x/mongo/driver/connstring"
)

// Open connects to a mongodb:// or mongodb+srv:// URL (DATABASE_URL). The database is the path of
// the URL. It does not create indexes or seed anything (DATA-MODEL-003).
func Open(ctx context.Context, rawURL string) (*mongo.Client, *mongo.Database, error) {
	cs, err := connstring.Parse(rawURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	if cs.Database == "" {
		return nil, nil, errors.New("invalid DATABASE_URL: it must name a database, for example mongodb://localhost:27017/app")
	}
	client, err := mongo.Connect(options.Client().ApplyURI(rawURL).SetMaxPoolSize(10).SetServerSelectionTimeout(8 * time.Second))
	if err != nil {
		return nil, nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.WithoutCancel(ctx))
		return nil, nil, fmt.Errorf("cannot reach the database: %w", err)
	}
	return client, client.Database(cs.Database), nil
}

type credentialDoc struct {
	SecretHash string    `bson:"secretHash"`
	CreatedAt  time.Time `bson:"createdAt"`
	UpdatedAt  time.Time `bson:"updatedAt"`
}

type userRoleDoc struct {
	Name       string    `bson:"name"`
	AssignedAt time.Time `bson:"assignedAt"`
	AssignedBy *string   `bson:"assignedBy"`
}

type userDoc struct {
	ID              string         `bson:"_id"`
	Email           *string        `bson:"email"`
	EmailNormalized *string        `bson:"emailNormalized"`
	EmailVerifiedAt *time.Time     `bson:"emailVerifiedAt"`
	State           string         `bson:"state"`
	CreatedAt       time.Time      `bson:"createdAt"`
	UpdatedAt       time.Time      `bson:"updatedAt"`
	DeletedAt       *time.Time     `bson:"deletedAt"`
	Credential      *credentialDoc `bson:"credential"`
	Roles           []userRoleDoc  `bson:"roles"`
}

type sessionDoc struct {
	ID                string     `bson:"_id"`
	TokenHash         string     `bson:"tokenHash"`
	UserID            string     `bson:"userId"`
	CreatedAt         time.Time  `bson:"createdAt"`
	LastSeenAt        time.Time  `bson:"lastSeenAt"`
	IdleExpiresAt     time.Time  `bson:"idleExpiresAt"`
	AbsoluteExpiresAt time.Time  `bson:"absoluteExpiresAt"`
	RevokedAt         *time.Time `bson:"revokedAt"`
	RevokedReason     *string    `bson:"revokedReason"`
	IPAddress         *string    `bson:"ipAddress"`
	UserAgent         *string    `bson:"userAgent"`
	ReauthenticatedAt *time.Time `bson:"reauthenticatedAt"`
}

type tokenDoc struct {
	ID            string     `bson:"_id"`
	Kind          string     `bson:"kind"`
	UserID        string     `bson:"userId"`
	TokenHash     string     `bson:"tokenHash"`
	Email         *string    `bson:"email"`
	ExpiresAt     time.Time  `bson:"expiresAt"`
	UsedAt        *time.Time `bson:"usedAt"`
	InvalidatedAt *time.Time `bson:"invalidatedAt"`
	CreatedAt     time.Time  `bson:"createdAt"`
}

type roleDoc struct {
	Name        string   `bson:"_id"`
	IsSystem    bool     `bson:"isSystem"`
	Permissions []string `bson:"permissions"`
}

type eventDoc struct {
	ID         string         `bson:"id"`
	Type       string         `bson:"type"`
	Outcome    string         `bson:"outcome"`
	OccurredAt time.Time      `bson:"occurredAt"`
	UserID     *string        `bson:"userId"`
	ActorID    *string        `bson:"actorId"`
	IPAddress  *string        `bson:"ipAddress"`
	UserAgent  *string        `bson:"userAgent"`
	RequestID  *string        `bson:"requestId"`
	Metadata   map[string]any `bson:"metadata"`
}

// Store implements auth.Store.
type Store struct {
	users, sessions, tokens, roles, events *mongo.Collection
}

var _ auth.Store = (*Store)(nil)

// Collection names (DATA_MODEL.md: the auth_ prefix, so nothing collides with the application's).
const (
	usersC     = "auth_users"
	sessionsC  = "auth_sessions"
	tokensC    = "auth_one_time_tokens"
	rolesC     = "auth_roles"
	eventsC    = "auth_security_events"
	rateLimitC = "auth_rate_limits"
)

func New(db *mongo.Database) *Store {
	return &Store{
		users: db.Collection(usersC), sessions: db.Collection(sessionsC), tokens: db.Collection(tokensC),
		roles: db.Collection(rolesC), events: db.Collection(eventsC),
	}
}

func notFound(err error) bool { return errors.Is(err, mongo.ErrNoDocuments) }

// ── users ──

func (d userDoc) record() *auth.UserRecord {
	return &auth.UserRecord{
		ID: d.ID, Email: d.Email, EmailNormalized: d.EmailNormalized, EmailVerifiedAt: d.EmailVerifiedAt,
		State: auth.AccountState(d.State), CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt, DeletedAt: d.DeletedAt,
	}
}

// withoutCredential keeps the password hash out of every user read (IDENT-PROFILE-002).
var withoutCredential = options.FindOne().SetProjection(bson.M{"credential": 0})

func (s *Store) CreateUser(ctx context.Context, user auth.UserRecord, passwordHash string, roles []string) (auth.UserRecord, error) {
	// Checked before anything is written, so a missing role leaves nothing behind (AUTHN-REG-003).
	for _, role := range roles {
		if ok, err := s.RoleExists(ctx, role); err != nil {
			return auth.UserRecord{}, err
		} else if !ok {
			return auth.UserRecord{}, fmt.Errorf("role %q does not exist", role)
		}
	}
	doc := userDoc{
		ID: user.ID, Email: user.Email, EmailNormalized: user.EmailNormalized, EmailVerifiedAt: user.EmailVerifiedAt,
		State: string(user.State), CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt, DeletedAt: user.DeletedAt,
		// One document holds the user, the password credential and the role links: all or nothing.
		Credential: &credentialDoc{SecretHash: passwordHash, CreatedAt: user.CreatedAt, UpdatedAt: user.CreatedAt},
		Roles:      []userRoleDoc{},
	}
	for _, name := range roles {
		doc.Roles = append(doc.Roles, userRoleDoc{Name: name, AssignedAt: user.CreatedAt})
	}
	if _, err := s.users.InsertOne(ctx, doc); err != nil {
		if mongo.IsDuplicateKeyError(err) && strings.Contains(err.Error(), "emailNormalized") {
			return auth.UserRecord{}, auth.ErrEmailTaken
		}
		return auth.UserRecord{}, err
	}
	return user, nil
}

func (s *Store) findUser(ctx context.Context, filter bson.M) (*auth.UserRecord, error) {
	var d userDoc
	if err := s.users.FindOne(ctx, filter, withoutCredential).Decode(&d); err != nil {
		if notFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return d.record(), nil
}

func (s *Store) FindUserByID(ctx context.Context, id string) (*auth.UserRecord, error) {
	return s.findUser(ctx, bson.M{"_id": id})
}

func (s *Store) FindUserByEmail(ctx context.Context, emailNormalized string) (*auth.UserRecord, error) {
	return s.findUser(ctx, bson.M{"emailNormalized": emailNormalized, "state": bson.M{"$ne": "deleted"}})
}

func (s *Store) UpdateUser(ctx context.Context, id string, p auth.UserPatch) error {
	set := bson.M{}
	if p.State != nil {
		set["state"] = string(*p.State)
	}
	if p.EmailVerifiedAt != nil {
		set["emailVerifiedAt"] = *p.EmailVerifiedAt
	}
	if p.UpdatedAt != nil {
		set["updatedAt"] = *p.UpdatedAt
	}
	if p.DeletedAt != nil {
		set["deletedAt"] = *p.DeletedAt
	}
	if p.ClearEmail {
		set["email"], set["emailNormalized"] = nil, nil
	}
	if len(set) == 0 {
		return nil
	}
	_, err := s.users.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": set})
	return err
}

// ── credentials ──

func (s *Store) GetPasswordHash(ctx context.Context, userID string) (string, bool, error) {
	var d userDoc
	err := s.users.FindOne(ctx, bson.M{"_id": userID}, options.FindOne().SetProjection(bson.M{"credential.secretHash": 1})).Decode(&d)
	if notFound(err) {
		return "", false, nil
	}
	if err != nil || d.Credential == nil {
		return "", false, err
	}
	return d.Credential.SecretHash, true, nil
}

func (s *Store) SetPasswordHash(ctx context.Context, userID, hash string, at time.Time) error {
	// Two conditional updates, each atomic: the first replaces the hash of an existing credential and
	// keeps its creation time; the second creates the credential when the user has none (after
	// DeleteCredentials).
	res, err := s.users.UpdateOne(ctx, bson.M{"_id": userID, "credential": bson.M{"$ne": nil}},
		bson.M{"$set": bson.M{"credential.secretHash": hash, "credential.updatedAt": at}})
	if err != nil || res.MatchedCount > 0 {
		return err
	}
	_, err = s.users.UpdateOne(ctx, bson.M{"_id": userID, "credential": nil},
		bson.M{"$set": bson.M{"credential": credentialDoc{SecretHash: hash, CreatedAt: at, UpdatedAt: at}}})
	return err
}

func (s *Store) DeleteCredentials(ctx context.Context, userID string) error {
	_, err := s.users.UpdateOne(ctx, bson.M{"_id": userID}, bson.M{"$set": bson.M{"credential": nil}})
	return err
}

// ── sessions ──

func (d sessionDoc) record() *auth.SessionRecord {
	r := &auth.SessionRecord{
		ID: d.ID, TokenHash: d.TokenHash, UserID: d.UserID, CreatedAt: d.CreatedAt, LastSeenAt: d.LastSeenAt,
		IdleExpiresAt: d.IdleExpiresAt, AbsoluteExpiresAt: d.AbsoluteExpiresAt, RevokedAt: d.RevokedAt,
		IPAddress: d.IPAddress, UserAgent: d.UserAgent, ReauthenticatedAt: d.ReauthenticatedAt,
	}
	if d.RevokedReason != nil {
		reason := auth.SessionRevokedReason(*d.RevokedReason)
		r.RevokedReason = &reason
	}
	return r
}

func (s *Store) CreateSession(ctx context.Context, x auth.SessionRecord) error {
	_, err := s.sessions.InsertOne(ctx, sessionDoc{
		ID: x.ID, TokenHash: x.TokenHash, UserID: x.UserID, CreatedAt: x.CreatedAt, LastSeenAt: x.LastSeenAt,
		IdleExpiresAt: x.IdleExpiresAt, AbsoluteExpiresAt: x.AbsoluteExpiresAt, IPAddress: x.IPAddress,
		UserAgent: x.UserAgent, ReauthenticatedAt: x.ReauthenticatedAt,
	})
	return err
}

func (s *Store) findSession(ctx context.Context, filter bson.M) (*auth.SessionRecord, error) {
	var d sessionDoc
	if err := s.sessions.FindOne(ctx, filter).Decode(&d); err != nil {
		if notFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return d.record(), nil
}

func (s *Store) FindSessionByTokenHash(ctx context.Context, tokenHash string) (*auth.SessionRecord, error) {
	return s.findSession(ctx, bson.M{"tokenHash": tokenHash})
}

func (s *Store) FindSessionByID(ctx context.Context, id string) (*auth.SessionRecord, error) {
	return s.findSession(ctx, bson.M{"_id": id})
}

func (s *Store) TouchSession(ctx context.Context, id string, lastSeenAt, idleExpiresAt time.Time) error {
	_, err := s.sessions.UpdateOne(ctx, bson.M{"_id": id, "revokedAt": nil},
		bson.M{"$set": bson.M{"lastSeenAt": lastSeenAt, "idleExpiresAt": idleExpiresAt}})
	return err
}

func (s *Store) RevokeSession(ctx context.Context, id string, reason auth.SessionRevokedReason, at time.Time) error {
	_, err := s.sessions.UpdateOne(ctx, bson.M{"_id": id, "revokedAt": nil},
		bson.M{"$set": bson.M{"revokedAt": at, "revokedReason": string(reason)}})
	return err
}

func (s *Store) RevokeUserSessions(ctx context.Context, userID string, reason auth.SessionRevokedReason, at time.Time, except string) (int, error) {
	filter := bson.M{"userId": userID, "revokedAt": nil}
	if except != "" {
		filter["_id"] = bson.M{"$ne": except}
	}
	res, err := s.sessions.UpdateMany(ctx, filter, bson.M{"$set": bson.M{"revokedAt": at, "revokedReason": string(reason)}})
	if err != nil {
		return 0, err
	}
	return int(res.ModifiedCount), nil
}

func (s *Store) ListActiveSessions(ctx context.Context, userID string, now time.Time) ([]auth.SessionRecord, error) {
	cur, err := s.sessions.Find(ctx, bson.M{
		"userId": userID, "revokedAt": nil,
		"idleExpiresAt": bson.M{"$gt": now}, "absoluteExpiresAt": bson.M{"$gt": now},
	}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var docs []sessionDoc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	var out []auth.SessionRecord
	for _, d := range docs {
		out = append(out, *d.record())
	}
	return out, nil
}

// ── one-time tokens ──

func (s *Store) CreateToken(ctx context.Context, t auth.TokenRecord) error {
	_, err := s.tokens.InsertOne(ctx, tokenDoc{
		ID: t.ID, Kind: string(t.Kind), UserID: t.UserID, TokenHash: t.TokenHash, Email: t.Email,
		ExpiresAt: t.ExpiresAt, UsedAt: t.UsedAt, InvalidatedAt: t.InvalidatedAt, CreatedAt: t.CreatedAt,
	})
	return err
}

func (s *Store) FindToken(ctx context.Context, kind auth.TokenKind, tokenHash string) (*auth.TokenRecord, error) {
	var d tokenDoc
	if err := s.tokens.FindOne(ctx, bson.M{"kind": string(kind), "tokenHash": tokenHash}).Decode(&d); err != nil {
		if notFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return &auth.TokenRecord{
		ID: d.ID, Kind: auth.TokenKind(d.Kind), UserID: d.UserID, TokenHash: d.TokenHash, Email: d.Email,
		ExpiresAt: d.ExpiresAt, UsedAt: d.UsedAt, InvalidatedAt: d.InvalidatedAt, CreatedAt: d.CreatedAt,
	}, nil
}

// ConsumeToken is a conditional update: at most one concurrent caller succeeds
// (AUTHN-RESET-009, AUTHN-VERIFY-006).
func (s *Store) ConsumeToken(ctx context.Context, id string, now time.Time) (bool, error) {
	res, err := s.tokens.UpdateOne(ctx,
		bson.M{"_id": id, "usedAt": nil, "invalidatedAt": nil, "expiresAt": bson.M{"$gt": now}},
		bson.M{"$set": bson.M{"usedAt": now}})
	if err != nil {
		return false, err
	}
	return res.ModifiedCount == 1, nil
}

func (s *Store) InvalidateUserTokens(ctx context.Context, userID string, kind auth.TokenKind, at time.Time) error {
	filter := bson.M{"userId": userID, "usedAt": nil, "invalidatedAt": nil}
	if kind != auth.TokensAll {
		filter["kind"] = string(kind)
	}
	_, err := s.tokens.UpdateMany(ctx, filter, bson.M{"$set": bson.M{"invalidatedAt": at}})
	return err
}

// ── roles ──

// SyncRoles upserts configured roles and makes each configured role's permissions exact. Roles no
// longer in configuration are kept (deleting them would silently strip users' roles); remove them
// with a reviewed change (AUTHZ-RBAC-005, DATA-MODEL-004).
func (s *Store) SyncRoles(ctx context.Context, roles map[string][]string) error {
	if len(roles) == 0 {
		return nil
	}
	var models []mongo.WriteModel
	for name, perms := range roles {
		seen := map[string]struct{}{}
		unique := []string{}
		for _, p := range perms {
			if _, dup := seen[p]; !dup {
				seen[p] = struct{}{}
				unique = append(unique, p)
			}
		}
		models = append(models, mongo.NewUpdateOneModel().
			SetFilter(bson.M{"_id": name}).
			SetUpdate(bson.M{"$set": bson.M{"permissions": unique, "isSystem": name == "admin" || name == "user"}}).
			SetUpsert(true))
	}
	_, err := s.roles.BulkWrite(ctx, models)
	return err
}

func (s *Store) GetUserRoles(ctx context.Context, userID string) ([]string, error) {
	var d userDoc
	err := s.users.FindOne(ctx, bson.M{"_id": userID}, options.FindOne().SetProjection(bson.M{"roles": 1})).Decode(&d)
	if notFound(err) {
		return []string{}, nil
	}
	out := []string{}
	for _, r := range d.Roles {
		out = append(out, r.Name)
	}
	return out, err
}

func (s *Store) GetRolePermissions(ctx context.Context, roles []string) ([]string, error) {
	if len(roles) == 0 {
		return []string{}, nil
	}
	cur, err := s.roles.Find(ctx, bson.M{"_id": bson.M{"$in": roles}})
	if err != nil {
		return nil, err
	}
	var docs []roleDoc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, d := range docs {
		for _, p := range d.Permissions {
			if _, dup := seen[p]; !dup {
				seen[p] = struct{}{}
				out = append(out, p)
			}
		}
	}
	return out, nil
}

func (s *Store) RoleExists(ctx context.Context, role string) (bool, error) {
	n, err := s.roles.CountDocuments(ctx, bson.M{"_id": role}, options.Count().SetLimit(1))
	return n > 0, err
}

func (s *Store) AddUserRole(ctx context.Context, userID, role string, assignedBy *string, at time.Time) error {
	if ok, err := s.RoleExists(ctx, role); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("role %q does not exist", role)
	}
	// Atomic and idempotent: the filter matches only a user who does not have the role yet.
	_, err := s.users.UpdateOne(ctx, bson.M{"_id": userID, "roles.name": bson.M{"$ne": role}},
		bson.M{"$push": bson.M{"roles": userRoleDoc{Name: role, AssignedAt: at, AssignedBy: assignedBy}}})
	return err
}

func (s *Store) RemoveUserRole(ctx context.Context, userID, role string) error {
	_, err := s.users.UpdateOne(ctx, bson.M{"_id": userID}, bson.M{"$pull": bson.M{"roles": bson.M{"name": role}}})
	return err
}

func (s *Store) CountActiveUsersWithRole(ctx context.Context, role string) (int, error) {
	n, err := s.users.CountDocuments(ctx, bson.M{"state": "active", "roles.name": role})
	return int(n), err
}

// ── audit ──

func (s *Store) RecordEvent(ctx context.Context, e auth.EventRecord) error {
	metadata := e.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := s.events.InsertOne(ctx, eventDoc{
		ID: e.ID, Type: e.Type, Outcome: e.Outcome, OccurredAt: e.OccurredAt, UserID: e.UserID, ActorID: e.ActorID,
		IPAddress: e.IPAddress, UserAgent: e.UserAgent, RequestID: e.RequestID, Metadata: metadata,
	})
	return err
}
