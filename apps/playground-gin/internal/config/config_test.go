package config

import (
	"os"
	"strings"
	"testing"
)

func TestShippedConfigIsValid(t *testing.T) {
	c, err := Load("../../selfauth.config.json")
	if err != nil {
		t.Fatal(err)
	}
	if c.Authentication.Sessions.Cookie.Name != "__Host-session" || !c.Authentication.Sessions.Cookie.Secure {
		t.Error("the shipped configuration must default to the __Host- secure cookie")
	}
	if proxies, err := c.TrustedProxies(); err != nil || proxies != nil {
		t.Errorf("forwarding headers must not be trusted by default (SEC-RATE-005): %v %v", proxies, err)
	}
}

func shipped(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../selfauth.config.json")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestParseRejectsTyposAndBadValues(t *testing.T) {
	base := shipped(t)
	for name, mutate := range map[string]func(string) string{
		"unknown field":   func(s string) string { return strings.Replace(s, `"basePath"`, `"basePth"`, 1) },
		"bad sameSite":    func(s string) string { return strings.Replace(s, `"sameSite": "lax"`, `"sameSite": "loose"`, 1) },
		"bad csrf mode":   func(s string) string { return strings.Replace(s, `"mode": "header"`, `"mode": "none"`, 1) },
		"zero body limit": func(s string) string { return strings.Replace(s, `"bodyLimitBytes": 16384`, `"bodyLimitBytes": 0`, 1) },
		"relative base":   func(s string) string { return strings.Replace(s, `"basePath": "/auth"`, `"basePath": "auth"`, 1) },
	} {
		if _, err := Parse([]byte(mutate(base))); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func lookup(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestLoadEnv(t *testing.T) {
	good := map[string]string{"SELFAUTH_APP_BASE_URL": "http://localhost:5173"}
	env, err := LoadEnv(lookup(good))
	if err != nil || env.Port != 3000 || env.NodeEnv != "development" {
		t.Fatalf("%+v %v", env, err)
	}
	for name, bad := range map[string]map[string]string{
		"missing base url":    {},
		"http in production":  {"APP_ENV": "production", "SELFAUTH_APP_BASE_URL": "http://app.example.com"},
		"bad port":            {"PORT": "99999", "SELFAUTH_APP_BASE_URL": "http://x.test"},
		"short csrf secret":   {"SELFAUTH_APP_BASE_URL": "http://x.test", "SELFAUTH_CSRF_SECRET": "c2hvcnQ"},
		"control characters":  {"SELFAUTH_APP_BASE_URL": "http://x.test/\nSet-Cookie: a=b"},
		"unknown environment": {"APP_ENV": "staging", "SELFAUTH_APP_BASE_URL": "http://x.test"},
	} {
		if _, err := LoadEnv(lookup(bad)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
