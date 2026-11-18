package auth

import (
	"strings"
	"unicode"
	"unicode/utf16"

	"golang.org/x/text/unicode/norm"
)

// jsSpace matches what JavaScript's trim() and \s treat as white space, so the
// Go and TypeScript implementations accept and reject the same addresses.
func jsSpace(r rune) bool {
	switch {
	case r == '\t', r == '\n', r == '\v', r == '\f', r == '\r', r == ' ', r == 0xA0, r == 0x1680,
		r >= 0x2000 && r <= 0x200A, r == 0x2028, r == 0x2029, r == 0x202F, r == 0x205F, r == 0x3000, r == 0xFEFF:
		return true
	}
	return false
}

func trimJS(s string) string { return strings.TrimFunc(s, jsSpace) }

// NormalizeEmail trims, applies NFC and lower-cases (IDENT-EMAIL-001). No
// provider-specific rules (IDENT-EMAIL-002).
func NormalizeEmail(input string) string {
	return strings.ToLower(norm.NFC.String(trimJS(input)))
}

// ValidateEmail returns the trimmed address, or ok=false (IDENT-EMAIL-004).
func ValidateEmail(input any) (string, bool) {
	s, isString := input.(string)
	if !isString {
		return "", false
	}
	email := trimJS(s)
	if email == "" || len(utf16.Encode([]rune(email))) > 254 {
		return "", false
	}
	for _, r := range email {
		if jsSpace(r) || unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) {
			return "", false
		}
	}
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return "", false
	}
	if strings.Index(email, "@") != at { // exactly one "@"
		return "", false
	}
	return email, true
}
