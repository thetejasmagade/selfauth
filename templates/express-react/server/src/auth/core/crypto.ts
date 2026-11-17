import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit CSPRNG token, base64url (SEC-TOKEN-001). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest; only token hashes are stored (SEC-TOKEN-002). */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
