package auth

import (
	"strings"
	"testing"
)

func TestNormalizeEmail(t *testing.T) {
	// Trimmed, NFC, lower-cased; no provider-specific rules (IDENT-EMAIL-001/002).
	if got := NormalizeEmail("  Alice+Tag@Example.COM  "); got != "alice+tag@example.com" {
		t.Errorf("got %q", got)
	}
	if NormalizeEmail("café@example.com") != NormalizeEmail("café@example.com") {
		t.Error("NFC-equivalent addresses must normalize equally")
	}
}

func TestValidateEmail(t *testing.T) {
	valid := []string{"a@b.co", " a@b.co ", "first.last+tag@example.com", "ü@example.com"}
	invalid := []any{
		"", " ", "no-at-sign", "@b.co", "a@", "a@@b.co", "a@b@c.co", "a b@c.co", "a\u0000@b.co",
		"a​@b.co", "a\n@b.co", strings.Repeat("a", 250) + "@b.co", 42, nil, []string{"a@b.co"},
	}
	for _, v := range valid {
		if _, ok := ValidateEmail(v); !ok {
			t.Errorf("%q rejected", v)
		}
	}
	for _, v := range invalid {
		if _, ok := ValidateEmail(v); ok {
			t.Errorf("%v accepted", v)
		}
	}
}
