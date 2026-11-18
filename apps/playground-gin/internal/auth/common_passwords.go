package auth

// commonPasswords is a small offline starter list of very common passwords
// (SEC-PWPOLICY-004). Replace it with a larger list (for example a top-100k
// breached list) bundled with the application; it is never fetched at runtime.
// Entries shorter than the minimum length are omitted since the length rule
// already rejects them.
var commonPasswords = map[string]struct{}{
	"123456789012":     {},
	"1234567890123":    {},
	"12345678901234":   {},
	"password1234":     {},
	"password12345":    {},
	"password123456":   {},
	"qwertyuiop123":    {},
	"qwerty123456":     {},
	"iloveyou1234":     {},
	"letmein12345":     {},
	"administrator":    {},
	"passwordpassword": {},
	"aaaaaaaaaaaa":     {},
	"abcdefghijkl":     {},
	"abc123abc123":     {},
	"welcome12345":     {},
	"changeme1234":     {},
	"monkey123456":     {},
	"football1234":     {},
	"baseball1234":     {},
	"superman1234":     {},
	"trustno1trustno1": {},
	"qwertyqwerty":     {},
	"asdfghjkl123":     {},
	"zxcvbnm12345":     {},
	"000000000000":     {},
	"111111111111":     {},
	"1q2w3e4r5t6y":     {},
	"q1w2e3r4t5y6":     {},
}
