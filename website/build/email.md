---
title: Send real email
description: Replace the development console mailer with a real email provider. The Mailer interface, the five message kinds, SMTP examples for Node and Go, and why the server refuses to start in production without it.
keywords: [email, mailer, smtp, createMailer, NewMailer, verification email, password reset email, nodemailer, resend, ses]
---

# Send real email

SelfAuth writes the emails but doesn't send them. It has no way of knowing whether you use SMTP, Amazon SES, Resend or Postmark, so you supply one small piece of code, the mailer.

| Environment | What happens |
| --- | --- |
| Development | Emails are printed in the terminal. The default `DevConsoleMailer` does this. |
| Production | The server refuses to start until you replace the mailer. That's intentional, so verification and reset emails can't be silently dropped. |

## Where the mailer is

| Backend | File | Function |
| --- | --- | --- |
| Express, Fastify | `src/email/mailer.ts` | `createMailer(env)` |
| Gin | `internal/email/mailer.go` | `NewMailer(env)` |

## The interface

A mailer has a single method that sends a single message.

::: code-group

```ts [TypeScript]
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailMessage {
  kind: "verification" | "passwordReset" | "accountExists" | "passwordChanged" | "passwordResetCompleted";
  to: string;
  subject: string;
  text: string;
  link?: string; // present for messages that carry a link
}
```

```go [Go]
type Mailer interface {
	Send(ctx context.Context, m EmailMessage) error
}

type EmailMessage struct {
	Kind    EmailKind // "verification", "passwordReset", ...
	To      string
	Subject string
	Text    string
	Link    string // set for messages that carry a link
}
```

:::

The five kinds:

| `kind` | When it is sent |
| --- | --- |
| `verification` | After registering, or when the user asks to resend |
| `passwordReset` | After a reset request for an existing account |
| `accountExists` | Someone registers with an email that already has an account (so the owner learns about it, while the web response stays the same) |
| `passwordChanged` | After a password change |
| `passwordResetCompleted` | After a password reset finished |

`text` already holds the finished sentence including the link, so the simplest mailer just sends `subject` and `text` as they are.

## Example: SMTP in TypeScript

This is illustrative. It uses the `nodemailer` package, which you install yourself (`npm install nodemailer` and `npm install -D @types/nodemailer`). Replace the whole of `src/email/mailer.ts` with:

```ts
import nodemailer from "nodemailer";
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  if (env.nodeEnv !== "production") return new DevConsoleMailer(env.nodeEnv);

  const host = process.env["SMTP_HOST"];
  const from = process.env["SMTP_FROM"];
  if (!host || !from) throw new Error("SMTP_HOST and SMTP_FROM are required in production");

  const transport = nodemailer.createTransport({
    host,
    port: 587,
    auth: { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASSWORD"] },
  });

  return {
    async send(m) {
      // Never log m.text or m.link: they contain one-time tokens.
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}
```

Put the `SMTP_*` variables in your production environment, never in the repository.

## Example: SMTP in Go

This one compiles with the generated Go project (use your own module path in the imports) and only needs the standard library:

```go
package email

import (
	"context"
	"errors"
	"fmt"
	"net/smtp"
	"os"

	"github.com/you/my-api/internal/auth"
	"github.com/you/my-api/internal/config"
)

type smtpMailer struct {
	addr, from string
	auth       smtp.Auth
}

func (m smtpMailer) Send(_ context.Context, msg auth.EmailMessage) error {
	body := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n", m.from, msg.To, msg.Subject, msg.Text)
	return smtp.SendMail(m.addr, m.auth, m.from, []string{msg.To}, []byte(body))
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	if !env.Production() {
		// Development: prints messages (including one-time links) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	host, user, pass, from := os.Getenv("SMTP_HOST"), os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASSWORD"), os.Getenv("SMTP_FROM")
	if host == "" || from == "" {
		return nil, errors.New("SMTP_HOST and SMTP_FROM are required in production")
	}
	return smtpMailer{addr: host + ":587", from: from, auth: smtp.PlainAuth("", user, pass, host)}, nil
}
```

## Customize the wording

Branch on `m.kind` if you want your own subjects or an HTML template. Leave the link exactly as given: it carries the token in the URL fragment (after the `#`), which keeps it out of server logs and `Referer` headers.

```ts
const subject = m.kind === "verification" ? "Welcome! Please confirm your email" : m.subject;
```

## Rules

- Don't log messages, links or tokens. SelfAuth's logger redacts them, so make sure your mailer doesn't undo that.
- Put a timeout on your provider call. A slow provider will otherwise slow down registration.
- The links point at frontend pages built from `SELFAUTH_APP_BASE_URL`: `<app>/verify-email#token=…` and `<app>/reset-password#token=…`. Set it to your real `https://` address in production.
- The `accountExists` email is how SelfAuth keeps the web response identical for known and unknown addresses. Don't drop it.

## Test your mailer

In a staging environment, run the server with `NODE_ENV=production` (`APP_ENV=production` for Gin), register with an address you control, and check that the verification email arrives with a working link. `npx selfauth doctor` keeps warning until the placeholder is replaced.
