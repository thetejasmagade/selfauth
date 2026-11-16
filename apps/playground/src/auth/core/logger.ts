/**
 * Structured logger with mandatory redaction (SEC-LOG-001).
 */
export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface LogSink {
  write(line: string): void;
}

const REDACTED_KEYS = new Set([
  "password",
  "currentpassword",
  "newpassword",
  "token",
  "csrftoken",
  "cookie",
  "set-cookie",
  "authorization",
  "secret",
  "secrethash",
  "passwordhash",
  "tokenhash",
]);

/** 32+ char base64url/hex runs look like tokens or hashes; never log them. */
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (typeof value === "string") return value.replace(TOKEN_LIKE, "[redacted]");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message, depth + 1),
      stack: redact(value.stack, depth + 1),
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        REDACTED_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
}

export function createLogger(
  sink: LogSink = { write: (l) => process.stdout.write(`${l}\n`) },
): Logger {
  return {
    log(level, message, fields = {}) {
      sink.write(
        JSON.stringify({
          level,
          time: new Date().toISOString(),
          message,
          ...(redact(fields) as object),
        }),
      );
    },
  };
}

/** Collects lines in memory (tests, conformance `inspectLogs`). */
export class MemoryLogSink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}
