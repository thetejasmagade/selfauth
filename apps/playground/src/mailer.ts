import { DevConsoleMailer, type Mailer } from "./auth/index.ts";
import type { Env } from "./env.ts";

/**
 * Email delivery for this application. Replace the production branch with
 * your provider (SMTP, SES, Resend, Postmark, …) by implementing `Mailer`.
 * Until you do, the server refuses to start in production rather than
 * silently dropping verification and password-reset emails.
 */
export function createMailer(env: Env): Mailer {
  if (env.nodeEnv === "production") {
    throw new Error(
      "No email provider configured: implement createMailer() in src/mailer.ts before running in production.",
    );
  }
  // Development: prints messages (including one-time links) to the console.
  return new DevConsoleMailer(env.nodeEnv);
}
