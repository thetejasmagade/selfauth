package auth

import (
	"context"
	"fmt"
	"sort"

	"selfauth-app/internal/config"
)

// SystemPermissions are held by the admin role (AUTHORIZATION_SPEC §5).
var SystemPermissions = []string{
	"auth.users.read",
	"auth.users.manage",
	"auth.sessions.manage",
	"auth.roles.assign",
	"auth.roles.manage",
	"auth.audit.read",
}

const AdminRole = "admin"

// Subject is the authenticated subject, always derived server-side (AUTHZ-CORE-003).
type Subject struct {
	UserID      string
	Roles       []string
	Permissions map[string]struct{}
}

func (s Subject) Has(permission string) bool { _, ok := s.Permissions[permission]; return ok }

// RoleDefinitions maps role → permissions as stored; admin always holds every
// system permission (AUTHZ-RBAC-004).
func RoleDefinitions(cfg *config.Config) map[string][]string {
	roles := map[string][]string{}
	dedupe := func(in []string) []string {
		seen := map[string]struct{}{}
		var out []string
		for _, p := range in {
			if _, ok := seen[p]; !ok {
				seen[p] = struct{}{}
				out = append(out, p)
			}
		}
		return out
	}
	for name, perms := range cfg.Authorization.Roles {
		roles[name] = dedupe(perms)
	}
	roles[AdminRole] = dedupe(append(append([]string{}, roles[AdminRole]...), SystemPermissions...))
	return roles
}

// KnownPermissions is every permission a check may reference (AUTHZ-PERM-004).
func KnownPermissions(cfg *config.Config) map[string]struct{} {
	known := map[string]struct{}{}
	for _, p := range cfg.Authorization.Permissions {
		known[p] = struct{}{}
	}
	for _, p := range SystemPermissions {
		known[p] = struct{}{}
	}
	return known
}

func sortedKeys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Resource is loaded from storage, never from the request (AUTHZ-RES-003).
type Resource struct {
	Type    string
	ID      string
	OwnerID string // "" when the resource has no owner
}

// ResourcePolicy loads a resource and decides whether a subject may act on it.
type ResourcePolicy interface {
	Load(ctx context.Context, id string) (*Resource, error)
	Authorize(subject Subject, action string, r Resource) bool
}

type Decision string

const (
	Allow          Decision = "allow"
	Deny           Decision = "deny"
	DecideNotFound Decision = "not_found"
)

// PolicyRegistry implements authorize(subject, action, resource) (AUTHZ-RES-001).
// Unregistered resource types are denied (AUTHZ-RES-002).
type PolicyRegistry struct{ policies map[string]ResourcePolicy }

func NewPolicyRegistry() *PolicyRegistry {
	return &PolicyRegistry{policies: map[string]ResourcePolicy{}}
}

// Register panics on a duplicate, which is a programming error found at startup.
func (r *PolicyRegistry) Register(resourceType string, p ResourcePolicy) {
	if _, dup := r.policies[resourceType]; dup {
		panic(fmt.Sprintf("policy for %q already registered", resourceType))
	}
	r.policies[resourceType] = p
}

func (r *PolicyRegistry) Decide(ctx context.Context, s Subject, action, resourceType, id string) (Decision, error) {
	p, ok := r.policies[resourceType]
	if !ok {
		return Deny, nil
	}
	res, err := p.Load(ctx, id)
	if err != nil {
		return Deny, err
	}
	// Hide existence from subjects who may not see it (AUTHZ-RES-004).
	if res == nil {
		return DecideNotFound, nil
	}
	if p.Authorize(s, action, *res) {
		return Allow, nil
	}
	return DecideNotFound, nil
}

type ownership struct {
	load func(ctx context.Context, id string) (*Resource, error)
}

// OwnershipPolicy allows the action if the subject holds `${action}_any`, or
// holds the action and owns the resource (AUTHZ-RES-005).
func OwnershipPolicy(load func(ctx context.Context, id string) (*Resource, error)) ResourcePolicy {
	return ownership{load: load}
}

func (o ownership) Load(ctx context.Context, id string) (*Resource, error) { return o.load(ctx, id) }
func (o ownership) Authorize(s Subject, action string, r Resource) bool {
	if s.Has(action + "_any") {
		return true
	}
	return s.Has(action) && r.OwnerID != "" && r.OwnerID == s.UserID
}

// OwnerFilter is the query filter for list operations (AUTHZ-RES-006). all means
// the subject may list every owner's rows; otherwise filter by ownerID in the
// query. ok is false when the subject may not list at all.
func OwnerFilter(s Subject, action string) (ownerID string, all bool, ok bool) {
	if s.Has(action + "_any") {
		return "", true, true
	}
	if s.Has(action) {
		return s.UserID, false, true
	}
	return "", false, false
}
