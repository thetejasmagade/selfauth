package auth

import (
	"strings"
	"testing"

	"selfauth-app/internal/config"
)

var fastHashing = config.Hashing{MemoryKiB: 64, Iterations: 1, Parallelism: 1}

func policy() config.Password {
	return config.Password{MinLength: 12, MaxLength: 64, RejectCommon: true, Hashing: fastHashing}
}

func TestHashVerifyRoundTrip(t *testing.T) {
	h := NewPasswordHasher(fastHashing)
	hash := h.Hash("correct horse battery")
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=64,t=1,p=1$") {
		t.Fatalf("not an Argon2id PHC string: %s", hash)
	}
	if !h.Verify(hash, "correct horse battery") {
		t.Fatal("correct password rejected")
	}
	if h.Verify(hash, "correct horse batterY") {
		t.Fatal("wrong password accepted")
	}
	if h.Hash("correct horse battery") == hash {
		t.Fatal("two hashes of one password are identical: the salt is not random")
	}
}

func TestPasswordsAreNFKCNormalizedButNotTrimmed(t *testing.T) {
	h := NewPasswordHasher(fastHashing)
	hash := h.Hash("ﬁnal password 1") // U+FB01 ligature normalizes to "fi"
	if !h.Verify(hash, "final password 1") {
		t.Fatal("NFKC-equivalent password rejected")
	}
	if h.Verify(hash, "final password 1 ") {
		t.Fatal("trailing space was ignored; passwords must not be trimmed")
	}
}

func TestVerifyRejectsMalformedHashes(t *testing.T) {
	h := NewPasswordHasher(fastHashing)
	for _, bad := range []string{"", "plaintext", "$argon2id$v=19$m=0,t=1,p=1$AAAA$AAAA", "$argon2i$v=19$m=64,t=1,p=1$AAAA$AAAA", "$argon2id$v=19$m=64,t=1,p=1$!!$AAAA"} {
		if h.Verify(bad, "anything") {
			t.Errorf("malformed hash %q verified", bad)
		}
	}
}

func TestNeedsRehash(t *testing.T) {
	weak := NewPasswordHasher(config.Hashing{MemoryKiB: 32, Iterations: 1, Parallelism: 1}).Hash("x password long")
	strong := NewPasswordHasher(fastHashing)
	if !strong.NeedsRehash(weak) {
		t.Error("a hash weaker than the configuration must be rehashed (SEC-HASH-004)")
	}
	if strong.NeedsRehash(strong.Hash("x password long")) {
		t.Error("a hash at the configured strength must not be rehashed")
	}
	if !strong.NeedsRehash("not a hash") {
		t.Error("an unparseable hash must be rehashed")
	}
}

func TestPasswordPolicy(t *testing.T) {
	cases := []struct {
		name     string
		password any
		email    string
		issue    string // "" means accepted
	}{
		{"ok", "a long enough pass", "", ""},
		{"not a string", 12345, "", "required"},
		{"too short", "short", "", "min_length_12"},
		{"too long", strings.Repeat("a", 65), "", "max_length_64"},
		{"common", "password12345", "", "too_common"},
		{"equals email", "someone@example.com", "SomeOne@Example.com", "equals_email"},
		{"counts code points, not bytes", strings.Repeat("é", 12), "", ""},
	}
	for _, c := range cases {
		_, err := CheckPasswordPolicy(c.password, policy(), c.email)
		switch {
		case c.issue == "" && err != nil:
			t.Errorf("%s: unexpected error %v", c.name, err)
		case c.issue != "" && (err == nil || err.Code != PasswordPolicyViolation || err.Details[0].Issue != c.issue):
			t.Errorf("%s: want issue %q, got %v", c.name, c.issue, err)
		}
	}
}
