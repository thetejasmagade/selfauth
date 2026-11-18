package main

import (
	"context"
	"fmt"
	"time"

	"example.com/app/internal/auth"
	"example.com/app/internal/store/memory"
)

func iso(t time.Time) string { return auth.ISO(t) }

func isoPtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return iso(*t)
}

func strPtr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// inspect returns the records of a logical entity (DATA_MODEL.md names) in the
// JSON shape every driver exposes: camelCase fields, ISO dates, users with roles.
func (b *memoryBackend) inspect(_ context.Context, entity string) ([]map[string]any, error) {
	snap := b.mem.Snapshot()
	out := []map[string]any{}
	switch entity {
	case "user":
		for _, u := range snap.Users {
			roles := []string{}
			for _, r := range snap.UserRoles {
				if r.UserID == u.ID {
					roles = append(roles, r.Role)
				}
			}
			out = append(out, map[string]any{
				"id": u.ID, "email": strPtr(u.Email), "emailNormalized": strPtr(u.EmailNormalized),
				"emailVerifiedAt": isoPtr(u.EmailVerifiedAt), "state": string(u.State),
				"createdAt": iso(u.CreatedAt), "updatedAt": iso(u.UpdatedAt), "deletedAt": isoPtr(u.DeletedAt),
				"roles": roles,
			})
		}
	case "credential":
		for _, c := range snap.Credentials {
			out = append(out, map[string]any{
				"id": c.ID, "userId": c.UserID, "type": c.Type, "secretHash": c.SecretHash,
				"createdAt": iso(c.CreatedAt), "updatedAt": iso(c.UpdatedAt),
			})
		}
	case "session":
		for _, s := range snap.Sessions {
			var reason any
			if s.RevokedReason != nil {
				reason = string(*s.RevokedReason)
			}
			out = append(out, map[string]any{
				"id": s.ID, "tokenHash": s.TokenHash, "userId": s.UserID,
				"createdAt": iso(s.CreatedAt), "lastSeenAt": iso(s.LastSeenAt),
				"idleExpiresAt": iso(s.IdleExpiresAt), "absoluteExpiresAt": iso(s.AbsoluteExpiresAt),
				"revokedAt": isoPtr(s.RevokedAt), "revokedReason": reason,
				"ipAddress": strPtr(s.IPAddress), "userAgent": strPtr(s.UserAgent),
				"reauthenticatedAt": isoPtr(s.ReauthenticatedAt),
			})
		}
	case "passwordResetToken", "emailVerificationToken":
		kind := auth.TokenPasswordReset
		if entity == "emailVerificationToken" {
			kind = auth.TokenEmailVerification
		}
		for _, t := range snap.Tokens {
			if t.Kind != kind {
				continue
			}
			out = append(out, map[string]any{
				"id": t.ID, "kind": string(t.Kind), "userId": t.UserID, "tokenHash": t.TokenHash,
				"email": strPtr(t.Email), "expiresAt": iso(t.ExpiresAt), "usedAt": isoPtr(t.UsedAt),
				"invalidatedAt": isoPtr(t.InvalidatedAt), "createdAt": iso(t.CreatedAt),
			})
		}
	default:
		return nil, fmt.Errorf("unknown entity %q", entity)
	}
	return out, nil
}

func eventsJSON(events []auth.EventRecord) []map[string]any {
	out := make([]map[string]any, 0, len(events))
	for _, e := range events {
		out = append(out, map[string]any{
			"id": e.ID, "type": e.Type, "outcome": e.Outcome, "occurredAt": iso(e.OccurredAt),
			"userId": strPtr(e.UserID), "actorId": strPtr(e.ActorID),
			"ipAddress": strPtr(e.IPAddress), "userAgent": strPtr(e.UserAgent),
			"requestId": strPtr(e.RequestID), "metadata": e.Metadata,
		})
	}
	return out
}

// mutate changes records directly, bypassing the service (conformance
// mutateStorage). Only the fields conformance cases change are supported; an
// unsupported request fails loudly rather than being ignored.
func (b *memoryBackend) mutate(_ context.Context, entity string, where, set map[string]any) error {
	if entity != "user" {
		return fmt.Errorf("mutateStorage supports entity \"user\" only (got %q)", entity)
	}
	for k := range where {
		if k != "id" && k != "email" {
			return fmt.Errorf("mutateStorage user: unsupported filter %q", k)
		}
	}
	for k := range set {
		if k != "state" {
			return fmt.Errorf("mutateStorage user: unsupported field %q", k)
		}
	}
	state, _ := set["state"].(string)
	if state == "" {
		return fmt.Errorf("mutateStorage user: state is required")
	}
	b.mem.MutateUser(
		func(u auth.UserRecord) bool {
			if id, ok := where["id"]; ok && id != u.ID {
				return false
			}
			if e, ok := where["email"]; ok && (u.Email == nil || e != *u.Email) {
				return false
			}
			return true
		},
		func(u *auth.UserRecord) { u.State = auth.AccountState(state) },
	)
	return nil
}

func (b *memoryBackend) events(_ context.Context) ([]map[string]any, error) {
	return eventsJSON(b.mem.Snapshot().Events), nil
}

// memoryBackend is the in-memory store with its test views.
type memoryBackend struct {
	mem  *memory.Store
	rate *auth.MemoryRateLimitStore
}

func newMemoryBackend() *memoryBackend {
	return &memoryBackend{mem: memory.New(), rate: auth.NewMemoryRateLimitStore()}
}

func (b *memoryBackend) store() auth.Store                   { return b.mem }
func (b *memoryBackend) rateLimitStore() auth.RateLimitStore { return b.rate }
func (b *memoryBackend) close()                              {}
