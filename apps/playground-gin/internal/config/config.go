// Package config holds the resolved SelfAuth configuration (CONFIGURATION_SPEC.md)
// and the process environment. Configuration is behavior only, never secrets
// (CONF-FILE-002); secrets come from the environment.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
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

// Validate checks the bounds the Go code relies on.
func (c *Config) Validate() error {
	var problems []error
	bad := func(format string, args ...any) { problems = append(problems, fmt.Errorf(format, args...)) }
	a := c.Authentication
	if a.Password.MinLength < 1 || a.Password.MaxLength < a.Password.MinLength {
		bad("authentication.password: minLength/maxLength out of range")
	}
	h := a.Password.Hashing
	if h.MemoryKiB < 8 || h.Iterations < 1 || h.Parallelism < 1 {
		bad("authentication.password.hashing: memoryKiB, iterations and parallelism must be positive")
	}
	if a.Sessions.Cookie.Name == "" {
		bad("authentication.sessions.cookie.name is required")
	}
	switch a.Sessions.Cookie.SameSite {
	case "lax", "strict", "none":
	default:
		bad("authentication.sessions.cookie.sameSite must be lax, strict or none")
	}
	if a.Sessions.IdleTimeoutMinutes < 1 || a.Sessions.AbsoluteTimeoutMinutes < 1 {
		bad("authentication.sessions: timeouts must be positive")
	}
	switch a.EmailVerification.Mode {
	case "required", "optional", "off":
	default:
		bad("authentication.emailVerification.mode must be required, optional or off")
	}
	switch c.HTTP.CSRF.Mode {
	case "header", "token":
	default:
		bad("http.csrf.mode must be header or token")
	}
	if c.HTTP.CSRF.HeaderName == "" {
		bad("http.csrf.headerName is required")
	}
	if c.HTTP.BodyLimitBytes < 1 {
		bad("http.bodyLimitBytes must be positive")
	}
	if len(c.HTTP.BasePath) == 0 || c.HTTP.BasePath[0] != '/' {
		bad("http.basePath must start with /")
	}
	return errors.Join(problems...)
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
