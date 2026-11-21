"""Passwords that are refused, whatever the length (SEC-PWPOLICY-003).

A public word list, the same as the TypeScript and Go cores use. Compared lower-cased."""

COMMON_PASSWORDS = frozenset(
    {
        "123456789012",
        "1234567890123",
        "12345678901234",
        "password1234",
        "password12345",
        "password123456",
        "qwertyuiop123",
        "qwerty123456",
        "iloveyou1234",
        "letmein12345",
        "administrator",
        "passwordpassword",
        "aaaaaaaaaaaa",
        "abcdefghijkl",
        "abc123abc123",
        "welcome12345",
        "changeme1234",
        "monkey123456",
        "football1234",
        "baseball1234",
        "superman1234",
        "trustno1trustno1",
        "qwertyqwerty",
        "asdfghjkl123",
        "zxcvbnm12345",
        "000000000000",
        "111111111111",
        "1q2w3e4r5t6y",
        "q1w2e3r4t5y6",
    }
)
