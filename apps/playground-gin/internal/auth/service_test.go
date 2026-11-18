package auth

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"example.com/app/internal/config"
)

// A small in-memory store, enough for the service tests in this package (the real stores are
// tested in internal/store).
type fixture struct {
	svc    *Service
	hasher *PasswordHasher
	mailer *MemoryMailer
	store  Store
}

func newFixture(t *testing.T, store Store, edit func(*config.Config)) fixture {
	t.Helper()
	cfg := &config.Config{}
	cfg.Authentication.Password = policy()
	cfg.Authentication.Password.Hashing = fastHashing
	cfg.Authentication.EmailVerification.Mode = "required"
	cfg.Authentication.EmailVerification.TokenTTLMinutes = 60
	cfg.Authentication.PasswordReset.TokenTTLMinutes = 30
	cfg.Authentication.Sessions = config.Sessions{IdleTimeoutMinutes: 60, AbsoluteTimeoutMinutes: 120, TouchIntervalSeconds: 60}
	big := config.RateLimitOperation{
		PerAccount: config.RateLimitRule{Limit: 1000, WindowSeconds: 60},
		PerAddress: config.RateLimitRule{Limit: 1000, WindowSeconds: 60},
	}
	cfg.Authentication.RateLimit = config.RateLimits{Login: big, PasswordChange: big, Register: big, PasswordResetRequest: big, VerificationResend: big}
	cfg.Authorization.DefaultRoles = []string{"user"}
	cfg.Authorization.Roles = map[string][]string{"user": nil}
	if edit != nil {
		edit(cfg)
	}
	if err := store.SyncRoles(context.Background(), RoleDefinitions(cfg)); err != nil {
		t.Fatal(err)
	}
	clock := NewManualClock()
	hasher := NewPasswordHasher(cfg.Authentication.Password.Hashing)
	mailer := &MemoryMailer{}
	base, _ := url.Parse("https://app.example.test")
	return fixture{
		svc: NewService(Deps{
			Config: cfg, Store: store, Mailer: mailer, Clock: clock, Hasher: hasher,
			Limiter: NewRateLimiter(NewMemoryRateLimitStore(), clock), AppBaseURL: base,
		}),
		hasher: hasher, mailer: mailer, store: store,
	}
}

var rc = RequestContext{IPAddress: "192.0.2.1", UserAgent: "test", RequestID: "r"}

func input(email, password string) Input { return Input{"email": email, "password": password} }

// AUTHN-LOGIN-003: a login for an account that does not exist does the same password work as one
// for an account that does, so response time does not reveal which addresses have accounts.
func TestLoginDoesTheSameWorkWhetherOrNotTheAccountExists(t *testing.T) {
	f := newFixture(t, newMapStore(), nil)
	ctx := context.Background()
	if _, err := f.svc.Register(ctx, input("a@b.co", "a long enough pass"), rc); err != nil {
		t.Fatal(err)
	}
	_, _, _ = f.svc.Login(ctx, input("warm@up.co", "x"), "", rc) // the dummy hash is created once

	cost := func(email, password string) int64 {
		before := f.hasher.Computations()
		_, _, err := f.svc.Login(ctx, input(email, password), "", rc)
		if err == nil {
			t.Fatal("expected a failed login")
		}
		return f.hasher.Computations() - before
	}
	wrongPassword := cost("a@b.co", "not the right password")
	unknownAccount := cost("nobody@b.co", "not the right password")
	if wrongPassword < 1 || unknownAccount != wrongPassword {
		t.Fatalf("password computations: wrong password %d, unknown account %d", wrongPassword, unknownAccount)
	}
}

// AUTHN-REG-010: registering an address that already has an account costs the same as a new one.
func TestRegistrationHashesOnEveryPath(t *testing.T) {
	f := newFixture(t, newMapStore(), nil)
	ctx := context.Background()
	cost := func(email string) int64 {
		before := f.hasher.Computations()
		if _, err := f.svc.Register(ctx, input(email, "a long enough pass"), rc); err != nil {
			t.Fatal(err)
		}
		return f.hasher.Computations() - before
	}
	fresh := cost("a@b.co")
	existing := cost("a@b.co")
	if fresh < 1 || existing != fresh {
		t.Fatalf("hash computations: new address %d, existing address %d", fresh, existing)
	}
}

// SEC-TOKEN-005: the one-time token travels in the fragment, which browsers never send to a
// server or in a Referer header.
func TestEmailLinksCarryTheTokenInTheFragment(t *testing.T) {
	f := newFixture(t, newMapStore(), nil)
	if _, err := f.svc.Register(context.Background(), input("a@b.co", "a long enough pass"), rc); err != nil {
		t.Fatal(err)
	}
	mail, ok := f.mailer.LastTo("a@b.co")
	if !ok || mail.Link == "" {
		t.Fatal("no verification email")
	}
	if !strings.HasPrefix(mail.Link, "https://app.example.test/verify-email#token=") {
		t.Fatalf("link %q", mail.Link)
	}
	if strings.Contains(mail.Link, "?") {
		t.Fatalf("the token must not be in a query string: %q", mail.Link)
	}
	// The link is built from the configured base URL, never from the request (AUTHN-VERIFY-009).
	if !strings.HasPrefix(mail.Text, "Open this link to verify") {
		t.Fatalf("text %q", mail.Text)
	}
}
