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

## Example: Resend

[Resend](https://resend.com) has a plain HTTP API, so you don't need its SDK or any new dependency. Create an API key in your Resend dashboard, verify the domain you'll send from, and set two environment variables in production:

```ini
RESEND_API_KEY=re_...
MAIL_FROM=Acme <login@mail.acme.com>
```

`MAIL_FROM` has to be an address on a domain you've verified with Resend. Their docs explain the DNS records, and how their test sender works while you're getting set up.

I checked both versions below against a local fake server, to confirm the request they send (the URL path, the `Authorization` header and the JSON body) and that an error response becomes an error. I haven't called the real Resend API, so send yourself a test email before relying on it.

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  if (env.nodeEnv !== "production") return new DevConsoleMailer(env.nodeEnv);

  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Acme <login@mail.acme.com>"
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and MAIL_FROM are required in production");
  }

  return {
    async send(m) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // m.text already holds the sentence and the link.
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Resend rejected the email (HTTP ${response.status})`);
      }
    },
  };
}
```

```go [Go: internal/email/mailer.go]
// Package email provides the application's mailer.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/you/my-api/internal/auth"
	"github.com/you/my-api/internal/config"
)

var resendURL = "https://api.resend.com/emails"

type resendMailer struct {
	apiKey, from string
	client       *http.Client
}

func (m resendMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	// msg.Text already holds the sentence and the link.
	body, err := json.Marshal(map[string]any{
		"from": m.from, "to": []string{msg.To}, "subject": msg.Subject, "text": msg.Text,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach Resend") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("Resend rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	if !env.Production() {
		// Development: prints messages (including one-time links) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	apiKey, from := os.Getenv("RESEND_API_KEY"), os.Getenv("MAIL_FROM") // from: "Acme <login@mail.acme.com>"
	if apiKey == "" || from == "" {
		return nil, errors.New("RESEND_API_KEY and MAIL_FROM are required in production")
	}
	return resendMailer{apiKey: apiKey, from: from, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

Replace `github.com/you/my-api` with your module path. A few notes on what the code does:

- The mailer only runs in production. In development you still get emails printed in the terminal, so you can work without sending anything.
- It sends `m.text` as the plain-text body. That text already contains the link, so there's nothing to build.
- It stops waiting after 10 seconds, so a slow provider can't hold up registration.
- When Resend refuses an email, the error carries the status code only. The message, the link and Resend's response never reach your logs.
- If you'd rather use Resend's own SDK, the shape is the same: call its send function from inside `send`, and throw if it reports an error.

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
