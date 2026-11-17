const CONTROL_OR_SPACE = /[\s\p{Cc}\p{Cf}]/u;

/** IDENT-EMAIL-001: trim, NFC, lower-case. No provider-specific rules (IDENT-EMAIL-002). */
export function normalizeEmail(input: string): string {
  return input.trim().normalize("NFC").toLowerCase();
}

/** IDENT-EMAIL-004. Returns the trimmed address, or null when invalid. */
export function validateEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim();
  if (email.length === 0 || email.length > 254 || CONTROL_OR_SPACE.test(email)) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  if (email.indexOf("@") !== at) return null; // exactly one "@" (quoted local parts unsupported)
  return email;
}
