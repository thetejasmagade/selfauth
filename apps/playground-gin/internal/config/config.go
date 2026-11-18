// Package config holds the resolved SelfAuth configuration (CONFIGURATION_SPEC.md)
// and the process environment. Configuration is behavior only, never secrets
// (CONF-FILE-002); secrets come from the environment.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
)

type RateLimitRule struct {
	Limit         int `json:"limit"`
	WindowSeconds int `json:"windowSeconds"`
}

type RateLimitOperation struct {
	PerAccount RateLimitRule `json:"perAccount"`
	PerAddress RateLimitRule `json:"perAddress"`
}

type Adapter struct {
	Backend  string `json:"backend"`
	Frontend string `json:"frontend"`
	Database string `json:"database"`
	ORM      string `json:"orm"`
}

type Hashing struct {
	MemoryKiB   uint32 `json:"memoryKiB"`
	Iterations  uint32 `json:"iterations"`
	Parallelism uint8  `json:"parallelism"`
}

type Password struct {
	MinLength    int     `json:"minLength"`
	MaxLength    int     `json:"maxLength"`
	RejectCommon bool    `json:"rejectCommon"`
	Hashing      Hashing `json:"hashing"`
}

type Cookie struct {
	Name     string `json:"name"`
	SameSite string `json:"sameSite"`
	Secure   bool   `json:"secure"`
}

type Sessions struct {
	Strategy               string `json:"strategy"`
	IdleTimeoutMinutes     int    `json:"idleTimeoutMinutes"`
	AbsoluteTimeoutMinutes int    `json:"absoluteTimeoutMinutes"`
	TouchIntervalSeconds   int    `json:"touchIntervalSeconds"`
	Cookie                 Cookie `json:"cookie"`
}

type RateLimits struct {
	Login                RateLimitOperation `json:"login"`
	PasswordChange       RateLimitOperation `json:"passwordChange"`
	Register             RateLimitOperation `json:"register"`
	PasswordResetRequest RateLimitOperation `json:"passwordResetRequest"`
	VerificationResend   RateLimitOperation `json:"verificationResend"`
}

type Authentication struct {
	Methods           []string `json:"methods"`
	EmailVerification struct {
		Mode            string `json:"mode"`
		TokenTTLMinutes int    `json:"tokenTtlMinutes"`
	} `json:"emailVerification"`
	Registration struct {
		RevealExistingEmail     bool `json:"revealExistingEmail"`
		SignInAfterRegistration bool `json:"signInAfterRegistration"`
	} `json:"registration"`
	PasswordReset struct {
		TokenTTLMinutes int `json:"tokenTtlMinutes"`
	} `json:"passwordReset"`
	Password  Password   `json:"password"`
	Sessions  Sessions   `json:"sessions"`
	RateLimit RateLimits `json:"rateLimit"`
}

type Authorization struct {
	Strategy                      string              `json:"strategy"`
	Permissions                   []string            `json:"permissions"`
	Roles                         map[string][]string `json:"roles"`
	DefaultRoles                  []string            `json:"defaultRoles"`
	ReauthenticationWindowMinutes int                 `json:"reauthenticationWindowMinutes"`
}

type CSRF struct {
	Mode       string `json:"mode"`
	HeaderName string `json:"headerName"`
}

type HTTP struct {
	BodyLimitBytes int64           `json:"bodyLimitBytes"`
	BasePath       string          `json:"basePath"`
	TrustedOrigins []string        `json:"trustedOrigins"`
	TrustProxy     json.RawMessage `json:"trustProxy"`
	CSRF           CSRF            `json:"csrf"`
}

// Config is the fully resolved configuration.
type Config struct {
	SpecVersion    string         `json:"specVersion"`
	Adapter        Adapter        `json:"adapter"`
	Authentication Authentication `json:"authentication"`
	Authorization  Authorization  `json:"authorization"`
	HTTP           HTTP           `json:"http"`
}

// Parse decodes a resolved configuration. Unknown fields are rejected so a
// typo cannot silently weaken a setting, and out-of-range values are errors.
func Parse(data []byte) (*Config, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("invalid selfauth configuration: %w", err)
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// Load reads and validates a configuration file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return Parse(data)
}

var (
	permissionPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	rolePattern       = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)
	cookieNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	basePathPattern   = regexp.MustCompile(`^/[A-Za-z0-9/_-]*$`)
	headerPattern     = regexp.MustCompile(`^[A-Za-z0-9-]+$`)
	specVersionFormat = regexp.MustCompile(`^\d+\.\d+$`)
)

// SpecMajor is the major version of the specification this application implements.
const SpecMajor = "0"

// systemPermissions mirror the spec (AUTHORIZATION_SPEC §5); roles may reference them.
var systemPermissions = []string{
	"auth.users.read", "auth.users.manage", "auth.sessions.manage",
	"auth.roles.assign", "auth.roles.manage", "auth.audit.read",
}

// Validate enforces the same bounds as the specification's configuration schema
// (CONFIGURATION_SPEC.md): out-of-range values are rejected, never clamped
// (CONF-FILE-003). The TypeScript schema is the reference; the conformance suite
// and this package's tests keep the two in step.
func (c *Config) Validate() error {
	var problems []error
	bad := func(format string, args ...any) { problems = append(problems, fmt.Errorf(format, args...)) }
	between := func(name string, v, lo, hi int) {
		if v < lo || v > hi {
			bad("%s must be between %d and %d (got %d)", name, lo, hi, v)
		}
	}
	oneOf := func(name, v string, allowed ...string) {
		if !slices.Contains(allowed, v) {
			bad("%s must be one of %s (got %q)", name, strings.Join(allowed, ", "), v)
		}
	}

	if !specVersionFormat.MatchString(c.SpecVersion) {
		bad("specVersion must look like 0.1")
	} else if major, _, _ := strings.Cut(c.SpecVersion, "."); major != SpecMajor {
		bad("specVersion %s is not supported (this application implements %s.x)", c.SpecVersion, SpecMajor)
	}

	oneOf("adapter.backend", c.Adapter.Backend, "express", "fastify", "gin")
	oneOf("adapter.frontend", c.Adapter.Frontend, "vue", "react", "none")
	oneOf("adapter.database", c.Adapter.Database, "postgresql", "mysql", "sqlite", "mongodb", "memory")
	orm := map[string]string{"postgresql": "prisma", "mysql": "prisma", "sqlite": "prisma", "mongodb": "mongoose", "memory": "none"}[c.Adapter.Database]
	if c.Adapter.Backend == "gin" {
		orm = "none" // a Go backend uses no ORM
	}
	if c.Adapter.ORM != orm {
		bad("adapter.orm %q is not supported with database %q", c.Adapter.ORM, c.Adapter.Database)
	}

	a := c.Authentication
	if len(a.Methods) == 0 {
		bad("authentication.methods needs at least one method")
	}
	for _, m := range a.Methods {
		oneOf("authentication.methods", m, "password")
	}
	oneOf("authentication.emailVerification.mode", a.EmailVerification.Mode, "required", "optional", "off")
	between("authentication.emailVerification.tokenTtlMinutes", a.EmailVerification.TokenTTLMinutes, 5, 10_080)
	between("authentication.passwordReset.tokenTtlMinutes", a.PasswordReset.TokenTTLMinutes, 5, 60)

	pw := a.Password
	between("authentication.password.minLength", pw.MinLength, 8, 1024) // SEC-PWPOLICY-001
	between("authentication.password.maxLength", pw.MaxLength, 64, 1024)
	if pw.MinLength > pw.MaxLength {
		bad("authentication.password.minLength must not exceed maxLength")
	}
	h := pw.Hashing
	between("authentication.password.hashing.memoryKiB", int(min(h.MemoryKiB, 1<<31-1)), 19_456, 4_194_304)
	between("authentication.password.hashing.iterations", int(min(h.Iterations, 1<<31-1)), 1, 10)
	between("authentication.password.hashing.parallelism", int(h.Parallelism), 1, 16)
	// Minimum Argon2id profiles (SEC-HASH-002): 19 MiB with 2+ iterations, or 46 MiB with 1.
	if !(h.MemoryKiB >= 19_456 && h.Iterations >= 2) && !(h.MemoryKiB >= 47_104 && h.Iterations >= 1) {
		bad("authentication.password.hashing is below the minimum (19 MiB with 2+ iterations, or 46 MiB with 1 iteration; SEC-HASH-002)")
	}

	s := a.Sessions
	oneOf("authentication.sessions.strategy", s.Strategy, "database")
	between("authentication.sessions.idleTimeoutMinutes", s.IdleTimeoutMinutes, 5, 525_600)
	between("authentication.sessions.absoluteTimeoutMinutes", s.AbsoluteTimeoutMinutes, 5, 525_600)
	if s.IdleTimeoutMinutes > s.AbsoluteTimeoutMinutes {
		bad("authentication.sessions.idleTimeoutMinutes must not exceed absoluteTimeoutMinutes")
	}
	between("authentication.sessions.touchIntervalSeconds", s.TouchIntervalSeconds, 0, 3_600)
	if !cookieNamePattern.MatchString(s.Cookie.Name) {
		bad("authentication.sessions.cookie.name must match %s", cookieNamePattern)
	}
	oneOf("authentication.sessions.cookie.sameSite", s.Cookie.SameSite, "lax", "strict", "none")
	if strings.HasPrefix(s.Cookie.Name, "__Host-") && !s.Cookie.Secure {
		bad("__Host- cookies require secure: true; use another name for local http development")
	}
	if s.Cookie.SameSite == "none" && !s.Cookie.Secure {
		bad("sameSite 'none' requires secure: true")
	}
	if s.Cookie.SameSite == "none" && c.HTTP.CSRF.Mode != "token" {
		bad("sameSite 'none' requires http.csrf.mode 'token' (SEC-COOKIE-005, SEC-CSRF-004)")
	}

	for name, op := range map[string]RateLimitOperation{
		"login": a.RateLimit.Login, "passwordChange": a.RateLimit.PasswordChange, "register": a.RateLimit.Register,
		"passwordResetRequest": a.RateLimit.PasswordResetRequest, "verificationResend": a.RateLimit.VerificationResend,
	} {
		for scope, rule := range map[string]RateLimitRule{"perAccount": op.PerAccount, "perAddress": op.PerAddress} {
			between("authentication.rateLimit."+name+"."+scope+".limit", rule.Limit, 1, 1_000_000)
			between("authentication.rateLimit."+name+"."+scope+".windowSeconds", rule.WindowSeconds, 1, 86_400)
		}
	}

	reg := a.Registration
	if reg.SignInAfterRegistration {
		if !reg.RevealExistingEmail {
			bad("signInAfterRegistration requires revealExistingEmail: true, because an immediate session reveals whether the email was new (AUTHN-REG-012)")
		}
		if a.EmailVerification.Mode == "required" {
			bad("signInAfterRegistration is not possible with emailVerification.mode 'required' (users are pending until verified)")
		}
	}

	z := c.Authorization
	oneOf("authorization.strategy", z.Strategy, "rbac")
	defined := map[string]bool{}
	for _, p := range z.Permissions {
		switch {
		case !permissionPattern.MatchString(p):
			bad("permission %q is not in the form resource.action (lowercase)", p)
		case strings.HasPrefix(p, "auth."):
			bad("permission %q: the 'auth.' prefix is reserved for system permissions", p)
		case defined[p]:
			bad("duplicate permission %q", p)
		}
		defined[p] = true
	}
	for role, perms := range z.Roles {
		if !rolePattern.MatchString(role) {
			bad("role name %q must match %s", role, rolePattern)
		}
		for _, p := range perms {
			if !defined[p] && !slices.Contains(systemPermissions, p) {
				bad("role %q references undefined permission %q", role, p)
			}
		}
	}
	if len(z.DefaultRoles) == 0 {
		bad("authorization.defaultRoles needs at least one role")
	}
	for _, r := range z.DefaultRoles {
		if r == "admin" {
			bad("'admin' must not be a default role (AUTHZ-ADMIN-005)")
		} else if _, ok := z.Roles[r]; !ok {
			bad("default role %q is not defined in roles", r)
		}
	}
	between("authorization.reauthenticationWindowMinutes", z.ReauthenticationWindowMinutes, 1, 1_440)

	between("http.bodyLimitBytes", int(min(c.HTTP.BodyLimitBytes, 1<<31-1)), 1_024, 1_048_576)
	if !basePathPattern.MatchString(c.HTTP.BasePath) {
		bad("http.basePath must match %s", basePathPattern)
	}
	for _, o := range c.HTTP.TrustedOrigins {
		if u, err := url.Parse(o); err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || originOf(u) != o {
			bad("http.trustedOrigins: %q must be an origin such as https://app.example.com (no path or trailing slash)", o)
		}
	}
	if err := c.validTrustProxy(); err != nil {
		bad("%v", err)
	}
	oneOf("http.csrf.mode", c.HTTP.CSRF.Mode, "header", "token")
	if !headerPattern.MatchString(c.HTTP.CSRF.HeaderName) {
		bad("http.csrf.headerName must match %s", headerPattern)
	}
	return errors.Join(problems...)
}

// originOf is scheme://host[:port] with the default port removed, like URL#origin.
func originOf(u *url.URL) string {
	host, port := u.Hostname(), u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host
}

// validTrustProxy checks the schema's shape: false, a hop count 1..32 or a non-empty list.
func (c *Config) validTrustProxy() error {
	raw := bytes.TrimSpace(c.HTTP.TrustProxy)
	if len(raw) == 0 || string(raw) == "false" {
		return nil
	}
	var hops int
	if err := json.Unmarshal(raw, &hops); err == nil {
		if hops < 1 || hops > 32 {
			return errors.New("http.trustProxy as a hop count must be between 1 and 32")
		}
		return nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil || len(list) == 0 {
		return errors.New("http.trustProxy must be false, a hop count or a non-empty list of addresses")
	}
	for _, entry := range list {
		if entry == "" {
			return errors.New("http.trustProxy entries must not be empty")
		}
	}
	return nil
}

// TrustedProxies interprets http.trustProxy: false (default) trusts no
// forwarding header; a list of addresses or CIDRs trusts exactly those proxies
// (SEC-RATE-005). A hop count is not supported by this adapter.
func (c *Config) TrustedProxies() ([]string, error) {
	raw := bytes.TrimSpace(c.HTTP.TrustProxy)
	if len(raw) == 0 || string(raw) == "false" || string(raw) == "null" {
		return nil, nil
	}
	var list []string
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, errors.New("http.trustProxy: the Gin adapter supports false or a list of proxy addresses/CIDRs")
	}
	return list, nil
}

// LocalDevelopment overrides only the cookie settings: plain-http local
// development cannot use Secure or __Host- cookies (SEC-COOKIE-003 forbids this
// in production).
func (c *Config) LocalDevelopment() {
	c.Authentication.Sessions.Cookie.Name = "dev_session"
	c.Authentication.Sessions.Cookie.Secure = false
}
