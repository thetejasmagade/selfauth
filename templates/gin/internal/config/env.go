package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Env is the startup configuration read from the environment. It fails fast:
// an invalid environment prevents the server from starting (SEC-SECRET-003).
type Env struct {
	NodeEnv            string // development, test or production
	Port               int
	AppBaseURL         *url.URL
	CSRFSecret         []byte
	CSRFSecretPrevious []byte
}

func (e Env) Production() bool { return e.NodeEnv == "production" }

// LoadEnv reads the environment through lookup (os.LookupEnv in the server).
func LoadEnv(lookup func(string) (string, bool)) (Env, error) {
	get := func(name, fallback string) string {
		if v, ok := lookup(name); ok && v != "" {
			return v
		}
		return fallback
	}
	var problems []error
	bad := func(format string, args ...any) { problems = append(problems, fmt.Errorf(format, args...)) }

	env := Env{NodeEnv: get("APP_ENV", "development")}
	switch env.NodeEnv {
	case "development", "test", "production":
	default:
		bad("APP_ENV must be development, test or production (got %q)", env.NodeEnv)
	}

	port, err := strconv.Atoi(get("PORT", "3000"))
	if err != nil || port < 1 || port > 65535 {
		bad("PORT must be an integer between 1 and 65535")
	}
	env.Port = port

	raw := get("SELFAUTH_APP_BASE_URL", "")
	if raw == "" {
		bad("SELFAUTH_APP_BASE_URL is required (used to build email links)")
	} else if u, err := url.Parse(raw); err != nil || u.Host == "" {
		bad("SELFAUTH_APP_BASE_URL is not a valid URL")
	} else if u.Scheme != "https" && u.Scheme != "http" {
		bad("SELFAUTH_APP_BASE_URL must be an http(s) URL")
	} else if strings.ContainsAny(raw, "\r\n\t ") || strings.IndexFunc(raw, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
		bad("SELFAUTH_APP_BASE_URL contains control characters")
	} else if env.NodeEnv == "production" && u.Scheme != "https" {
		bad("SELFAUTH_APP_BASE_URL must use https in production (SEC-HTTP-002)")
	} else {
		env.AppBaseURL = u
	}

	secret := func(name string) []byte {
		v := get(name, "")
		if v == "" {
			return nil
		}
		b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(v, "="))
		if err != nil || len(b) < 32 {
			bad("%s must be at least 32 random bytes, base64url-encoded (SEC-SECRET-004)", name)
		}
		return b
	}
	env.CSRFSecret = secret("SELFAUTH_CSRF_SECRET")
	env.CSRFSecretPrevious = secret("SELFAUTH_CSRF_SECRET_PREVIOUS")

	if err := errors.Join(problems...); err != nil {
		return Env{}, fmt.Errorf("invalid environment:\n%w", err)
	}
	return env, nil
}

// OSLookup is LoadEnv's lookup for the real process environment.
func OSLookup(name string) (string, bool) { return os.LookupEnv(name) }
