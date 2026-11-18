package config

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// edit loads the default configuration, applies change to its generic JSON form and parses it.
func edit(t *testing.T, change func(c map[string]any)) (*Config, error) {
	t.Helper()
	raw, err := os.ReadFile("testdata/default.json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	change(m)
	out, _ := json.Marshal(m)
	return Parse(out)
}

func at(m map[string]any, path ...string) map[string]any {
	for _, key := range path {
		m = m[key].(map[string]any)
	}
	return m
}

func TestRejectedConfigurations(t *testing.T) {
	cases := map[string]struct {
		change func(m map[string]any)
		want   string // a fragment of the error
	}{
		// CONF-FILE-001: strict, at every level.
		"unknown top-level key": {func(m map[string]any) { m["extra"] = true }, "unknown field"},
		"unknown nested key":    {func(m map[string]any) { at(m, "http")["cors"] = "*" }, "unknown field"},
		// CONF-FILE-002: a secret has no place to go.
		"a secret in the file": {func(m map[string]any) { at(m, "http", "csrf")["secret"] = "hunter2" }, "unknown field"},
		// CONF-FILE-003: out of range is rejected, never clamped.
		"password reset ttl too long": {func(m map[string]any) { at(m, "authentication", "passwordReset")["tokenTtlMinutes"] = 61 }, "tokenTtlMinutes"},
		"verification ttl too short":  {func(m map[string]any) { at(m, "authentication", "emailVerification")["tokenTtlMinutes"] = 1 }, "tokenTtlMinutes"},
		"idle longer than absolute": {func(m map[string]any) {
			at(m, "authentication", "sessions")["idleTimeoutMinutes"] = 50000
			at(m, "authentication", "sessions")["absoluteTimeoutMinutes"] = 40000
		}, "idleTimeoutMinutes must not exceed"},
		"rate limit of zero":   {func(m map[string]any) { at(m, "authentication", "rateLimit", "login", "perAccount")["limit"] = 0 }, "limit"},
		"body limit too large": {func(m map[string]any) { at(m, "http")["bodyLimitBytes"] = 2_000_000 }, "bodyLimitBytes"},
		// CONF-FILE-005.
		"unsupported major version": {func(m map[string]any) { m["specVersion"] = "1.0" }, "specVersion"},
		// SEC-PWPOLICY-001, SEC-HASH-002.
		"minimum length below 8": {func(m map[string]any) { at(m, "authentication", "password")["minLength"] = 7 }, "minLength"},
		"hashing below the floor": {func(m map[string]any) {
			at(m, "authentication", "password", "hashing")["memoryKiB"] = 8192
		}, "memoryKiB"},
		"one iteration with little memory": {func(m map[string]any) {
			at(m, "authentication", "password", "hashing")["iterations"] = 1
		}, "below the minimum"},
		// SEC-PWPOLICY-005: no password expiry exists, and none can be added.
		"a password age setting": {func(m map[string]any) { at(m, "authentication", "password")["maxAgeDays"] = 90 }, "unknown field"},
		// AUTHZ-PERM-001/002/004.
		"malformed permission":  {func(m map[string]any) { at(m, "authorization")["permissions"] = []any{"Orders"} }, "resource.action"},
		"reserved auth. prefix": {func(m map[string]any) { at(m, "authorization")["permissions"] = []any{"auth.custom"} }, "reserved"},
		"duplicate permission":  {func(m map[string]any) { at(m, "authorization")["permissions"] = []any{"a.b", "a.b"} }, "duplicate"},
		"role with an undefined permission": {func(m map[string]any) {
			at(m, "authorization", "roles")["user"] = []any{"nothing.defined"}
		}, "undefined permission"},
		"admin as a default role": {func(m map[string]any) { at(m, "authorization")["defaultRoles"] = []any{"admin"} }, "AUTHZ-ADMIN-005"},
		"an undefined default role": {func(m map[string]any) {
			at(m, "authorization")["defaultRoles"] = []any{"ghost"}
		}, "not defined"},
		// Cookies and CSRF.
		"__Host- cookie without secure": {func(m map[string]any) { at(m, "authentication", "sessions", "cookie")["secure"] = false }, "__Host-"},
		"sameSite none with header csrf": {func(m map[string]any) {
			c := at(m, "authentication", "sessions", "cookie")
			c["sameSite"] = "none"
		}, "sameSite 'none' requires http.csrf.mode"},
		"a trusted origin with a path": {func(m map[string]any) {
			at(m, "http")["trustedOrigins"] = []any{"https://app.example.com/login"}
		}, "origin"},
		// AUTHN-REG-012.
		"sign in after registration without revealing": {func(m map[string]any) {
			at(m, "authentication", "emailVerification")["mode"] = "off"
			at(m, "authentication", "registration")["signInAfterRegistration"] = true
		}, "revealExistingEmail"},
		"a missing section": {func(m map[string]any) { delete(m, "authorization") }, "defaultRoles"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := edit(t, c.change)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want an error containing %q, got %v", c.want, err)
			}
		})
	}
}

// SEC-ENUM-004: the options that reveal registered addresses are off by default.
func TestEnumerationOptionsAreOffByDefault(t *testing.T) {
	c, err := Load("testdata/default.json")
	if err != nil {
		t.Fatal(err)
	}
	if c.Authentication.Registration.RevealExistingEmail || c.Authentication.Registration.SignInAfterRegistration {
		t.Fatal("sign-up must not reveal which addresses have accounts by default")
	}
	if c.Authentication.EmailVerification.Mode != "required" {
		t.Fatal("email verification must be required by default")
	}
}

func TestAccepts(t *testing.T) {
	for name, change := range map[string]func(m map[string]any){
		"a development cookie": func(m map[string]any) {
			cookie := at(m, "authentication", "sessions", "cookie")
			cookie["name"], cookie["secure"] = "dev_session", false
		},
		"token-mode csrf with sameSite none": func(m map[string]any) {
			at(m, "authentication", "sessions", "cookie")["sameSite"] = "none"
			at(m, "http", "csrf")["mode"] = "token"
		},
		"application permissions and a role that uses them": func(m map[string]any) {
			at(m, "authorization")["permissions"] = []any{"orders.view", "orders.create"}
			at(m, "authorization", "roles")["user"] = []any{"orders.view"}
		},
		"a trusted origin":     func(m map[string]any) { at(m, "http")["trustedOrigins"] = []any{"https://app.example.com"} },
		"a proxy list":         func(m map[string]any) { at(m, "http")["trustProxy"] = []any{"10.0.0.0/8"} },
		"a proxy hop count":    func(m map[string]any) { at(m, "http")["trustProxy"] = 1 },
		"a Go backend, no ORM": func(m map[string]any) { at(m, "adapter")["backend"] = "gin" },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := edit(t, change); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The configuration struct has no field that could hold a secret (CONF-FILE-002).
func TestNoFieldHoldsASecret(t *testing.T) {
	var walk func(rt reflect.Type, path string)
	walk = func(rt reflect.Type, path string) {
		for rt.Kind() == reflect.Pointer || rt.Kind() == reflect.Slice || rt.Kind() == reflect.Map {
			rt = rt.Elem()
		}
		if rt.Kind() != reflect.Struct {
			return
		}
		for i := 0; i < rt.NumField(); i++ {
			f := rt.Field(i)
			name := strings.ToLower(f.Name)
			for _, word := range []string{"secret", "apikey", "privatekey", "credential"} {
				if strings.Contains(name, word) {
					t.Errorf("%s.%s looks like it could hold a secret", path, f.Name)
				}
			}
			walk(f.Type, path+"."+f.Name)
		}
	}
	walk(reflect.TypeOf(Config{}), "Config")
}
