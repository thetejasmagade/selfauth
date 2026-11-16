/**
 * Email delivery is application-provided (Phase 3 requirement: "email delivery
 * is an adapter/configuration concern"). Implement Mailer with your provider
 * (SMTP, SES, Resend, …).
 */
export type EmailKind =
  "verification" | "passwordReset" | "accountExists" | "passwordChanged" | "passwordResetCompleted";

export interface EmailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  /** Present for messages that carry a link. */
  link?: string;
  /** Raw one-time token, for test mailers only. Never log it. */
  token?: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/** Keeps messages in memory. For tests and conformance drivers. */
export class MemoryMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
  lastTo(address: string): EmailMessage | undefined {
    const target = address.trim().toLowerCase();
    return this.sent.findLast((m) => m.to.trim().toLowerCase() === target);
  }
}

/**
 * Development-only mailer that prints messages to stdout so links can be
 * clicked locally. Refuses to run in production because it prints one-time
 * links, which must never reach production logs (SEC-LOG-001).
 */
export class DevConsoleMailer implements Mailer {
  constructor(nodeEnv: string) {
    if (nodeEnv === "production") {
      throw new Error("DevConsoleMailer must not be used in production; configure a real Mailer.");
    }
  }
  async send(message: EmailMessage): Promise<void> {
    process.stdout.write(
      `\n[dev mail] to=${message.to} kind=${message.kind}\n${message.subject}\n${message.text}\n`,
    );
  }
}
