package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"example.com/app/internal/config"
	"golang.org/x/crypto/argon2"
	"golang.org/x/text/unicode/norm"
)

const (
	saltLength = 16
	keyLength  = 32
)

// PasswordHasher hashes with Argon2id and emits PHC strings (SEC-HASH-001…003)
// with a random 16-byte salt (SEC-HASH-002). Concurrent hashes are bounded so a
// burst of requests cannot exhaust memory (SEC-HASH-006).
type PasswordHasher struct {
	params config.Hashing
	slots  chan struct{}

	dummyOnce sync.Once
	dummy     string
}

func NewPasswordHasher(params config.Hashing) *PasswordHasher {
	n := runtime.GOMAXPROCS(0) * 2
	if n < 2 {
		n = 2
	}
	return &PasswordHasher{params: params, slots: make(chan struct{}, n)}
}

// NormalizePassword is NFKC only; never trimmed, case-folded or truncated (SEC-HASH-005).
func NormalizePassword(password string) string { return norm.NFKC.String(password) }

func (h *PasswordHasher) derive(password string, salt []byte, memoryKiB, iterations uint32, parallelism uint8) []byte {
	h.slots <- struct{}{}
	defer func() { <-h.slots }()
	return argon2.IDKey([]byte(NormalizePassword(password)), salt, iterations, memoryKiB, parallelism, keyLength)
}

// Hash returns a PHC string for password.
func (h *PasswordHasher) Hash(password string) string {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		panic(fmt.Sprintf("system random source failed: %v", err))
	}
	key := h.derive(password, salt, h.params.MemoryKiB, h.params.Iterations, h.params.Parallelism)
	enc := base64.RawStdEncoding
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version,
		h.params.MemoryKiB, h.params.Iterations, h.params.Parallelism, enc.EncodeToString(salt), enc.EncodeToString(key))
}

type phc struct {
	memory, iterations uint32
	parallelism        uint8
	salt, key          []byte
}

func parsePHC(encoded string) (phc, bool) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || !strings.HasPrefix(parts[2], "v=") {
		return phc{}, false
	}
	if v, err := strconv.Atoi(parts[2][2:]); err != nil || v != argon2.Version {
		return phc{}, false
	}
	var p phc
	var m, t, par uint64
	for _, kv := range strings.Split(parts[3], ",") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			return phc{}, false
		}
		n, err := strconv.ParseUint(v, 10, 32)
		if err != nil {
			return phc{}, false
		}
		switch k {
		case "m":
			m = n
		case "t":
			t = n
		case "p":
			par = n
		}
	}
	if m == 0 || t == 0 || par == 0 || par > 255 {
		return phc{}, false
	}
	enc := base64.RawStdEncoding
	salt, err1 := enc.DecodeString(parts[4])
	key, err2 := enc.DecodeString(parts[5])
	if err1 != nil || err2 != nil || len(key) == 0 {
		return phc{}, false
	}
	p.memory, p.iterations, p.parallelism, p.salt, p.key = uint32(m), uint32(t), uint8(par), salt, key
	return p, true
}

// Verify reports whether password matches the stored PHC string. Any malformed
// hash is simply "no match".
func (h *PasswordHasher) Verify(stored, password string) bool {
	p, ok := parsePHC(stored)
	if !ok {
		return false
	}
	key := h.derive(password, p.salt, p.memory, p.iterations, p.parallelism)
	if len(key) != len(p.key) {
		// Derive with the stored length so the comparison below is over equal lengths.
		h.slots <- struct{}{}
		key = argon2.IDKey([]byte(NormalizePassword(password)), p.salt, p.iterations, p.memory, p.parallelism, uint32(len(p.key)))
		<-h.slots
	}
	return subtle.ConstantTimeCompare(key, p.key) == 1
}

// VerifyDummy burns comparable work when there is no real hash to check, so
// response time does not reveal account existence (AUTHN-LOGIN-003, AUTHN-REG-010).
func (h *PasswordHasher) VerifyDummy(password string) {
	h.dummyOnce.Do(func() { h.dummy = h.Hash("selfauth-dummy-password-for-timing") })
	h.Verify(h.dummy, password)
}

// NeedsRehash is true if the stored hash is weaker than the current configuration (SEC-HASH-004).
func (h *PasswordHasher) NeedsRehash(stored string) bool {
	p, ok := parsePHC(stored)
	if !ok {
		return true
	}
	return p.memory < h.params.MemoryKiB || p.iterations < h.params.Iterations || p.parallelism < h.params.Parallelism
}

// CheckPasswordPolicy enforces SEC-PWPOLICY-001…006 and returns PASSWORD_POLICY_VIOLATION.
func CheckPasswordPolicy(password any, cfg config.Password, email string) (string, *Error) {
	violation := func(issue string) (string, *Error) {
		return "", &Error{
			Code: PasswordPolicyViolation, Message: "Password does not meet the policy.",
			Details: []Detail{{Field: "password", Issue: issue}},
		}
	}
	s, ok := password.(string)
	if !ok {
		return violation("required")
	}
	normalized := NormalizePassword(s)
	length := utf8.RuneCountInString(normalized)
	if length < cfg.MinLength {
		return violation(fmt.Sprintf("min_length_%d", cfg.MinLength))
	}
	if length > cfg.MaxLength {
		return violation(fmt.Sprintf("max_length_%d", cfg.MaxLength))
	}
	lower := strings.ToLower(normalized)
	if cfg.RejectCommon {
		if _, common := commonPasswords[lower]; common {
			return violation("too_common")
		}
	}
	if email != "" && lower == strings.ToLower(email) {
		return violation("equals_email")
	}
	return s, nil
}
