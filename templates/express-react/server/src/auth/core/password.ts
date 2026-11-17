import { hash, verify, type Algorithm } from "@node-rs/argon2";

/** `Algorithm.Argon2id`; the library exports a const enum that erasable TypeScript cannot reference. */
const ARGON2ID = 2 as Algorithm;
import type { ErrorDetail, SelfAuthConfig } from "../types.ts";
import { COMMON_PASSWORDS } from "./common-passwords.ts";
import { AuthError } from "./errors.ts";

type PasswordConfig = SelfAuthConfig["authentication"]["password"];

/**
 * Password hashing with Argon2id via @node-rs/argon2 (ADR 0009, ADR 0014).
 * The library hashes on a worker thread (SEC-HASH-006) and emits PHC strings
 * (SEC-HASH-003) with a random 16-byte salt (SEC-HASH-002).
 */
export class PasswordHasher {
  private readonly options;
  private dummyHash: Promise<string> | undefined;

  constructor(config: PasswordConfig["hashing"]) {
    this.options = {
      algorithm: ARGON2ID,
      memoryCost: config.memoryKiB,
      timeCost: config.iterations,
      parallelism: config.parallelism,
    };
  }

  /** NFKC only; never trimmed, case-folded, or truncated (SEC-HASH-005). */
  static normalize(password: string): string {
    return password.normalize("NFKC");
  }

  hash(password: string): Promise<string> {
    return hash(PasswordHasher.normalize(password), this.options);
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, PasswordHasher.normalize(password));
    } catch {
      return false;
    }
  }

  /**
   * Burn comparable work when there is no real hash to check, so response
   * time does not reveal account existence (AUTHN-LOGIN-003, AUTHN-REG-010).
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash("selfauth-dummy-password-for-timing");
    await this.verify(await this.dummyHash, password);
  }

  /** SEC-HASH-004: true if the stored hash is weaker than the current configuration. */
  needsRehash(storedHash: string): boolean {
    const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
    if (!match) return true;
    const [m, t, p] = match.slice(1).map(Number) as [number, number, number];
    return m < this.options.memoryCost || t < this.options.timeCost || p < this.options.parallelism;
  }
}

/** Password policy (SEC-PWPOLICY-001…006). Throws PASSWORD_POLICY_VIOLATION. */
export function checkPasswordPolicy(
  password: unknown,
  config: PasswordConfig,
  email?: string,
): string {
  const fail = (issue: string): never => {
    const details: ErrorDetail[] = [{ field: "password", issue }];
    throw new AuthError("PASSWORD_POLICY_VIOLATION", "Password does not meet the policy.", {
      details,
    });
  };
  if (typeof password !== "string") fail("required");
  const normalized = PasswordHasher.normalize(password as string);
  const length = [...normalized].length;
  if (length < config.minLength) fail(`min_length_${config.minLength}`);
  if (length > config.maxLength) fail(`max_length_${config.maxLength}`);
  if (config.rejectCommon && COMMON_PASSWORDS.has(normalized.toLowerCase())) fail("too_common");
  if (email && normalized.toLowerCase() === email.toLowerCase()) fail("equals_email");
  return password as string;
}
