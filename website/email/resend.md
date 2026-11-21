---
title: Send email with Resend
description: Connect Resend to a SelfAuth project, with working mailer code for Express, Fastify (TypeScript) and Gin (Go), the environment variables to set, how to try it locally and the errors people hit.
keywords: [resend, send email, resend api, mailer, createMailer, NewMailer, transactional email, express, fastify, gin]
---

# Send email with Resend

[Resend](https://resend.com) has a plain HTTP API, so you don't need its SDK or any new package. It's the quickest way to get real email working.

## Before you start

1. Create a Resend account.
2. Add your sending domain (use a subdomain like `mail.example.com`) and create the DNS records Resend shows you. Wait until the dashboard says the domain is verified. [Why this matters](./#verify-your-sending-domain).
3. Create an API key with permission to send.
4. In the dashboard, check that **click tracking** is off for the domain. [Why](./#turn-off-link-tracking).

## Environment

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | The key you created, starting with `re_` |
| `MAIL_FROM` | The sender, on your verified domain: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("RESEND_API_KEY and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when RESEND_API_KEY is set");

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

	"notes-app/internal/auth"
	"notes-app/internal/config"
)

// resendURL is a variable so a test can point it at a fake server.
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
		return fmt.Errorf("resend rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	apiKey, from := os.Getenv("RESEND_API_KEY"), os.Getenv("MAIL_FROM") // from: "Notes <login@mail.example.com>"
	if apiKey == "" {
		if env.Production() {
			return nil, errors.New("RESEND_API_KEY and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	if from == "" {
		return nil, errors.New("MAIL_FROM is required when RESEND_API_KEY is set")
	}
	return resendMailer{apiKey: apiKey, from: from, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

In the Go code, replace `notes-app` in the two imports with your module name. It's whatever `go.mod` says on its first line.

What the code does:

- **No key set:** in development it prints emails in the terminal, as before. In production the server refuses to start and says which variable is missing.
- **Key set:** it sends every message through Resend, in development as well, which is how you try it before deploying.
- **Failure:** if Resend answers with an error, the error says only the status. It never contains the message or its link.
- **Time limit:** a request that takes longer than 10 seconds is given up.

## Try it

Put your two settings where the server will see them, then register with an address you own.

::: code-group

```text [TypeScript: .env]
RESEND_API_KEY=re_your_key_here
MAIL_FROM=Notes <login@mail.example.com>
```

```bash [Go: terminal]
export RESEND_API_KEY=re_your_key_here
export MAIL_FROM="Notes <login@mail.example.com>"
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. If it doesn't, look at **Emails** in the Resend dashboard: it shows every message Resend received and what happened to it. Remove the two settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The code compiles in generated Express, Fastify and Gin projects, and it was run against a local fake server that checks the URL, the `Authorization` header and the JSON body described in Resend's API reference, and that an error response doesn't leak the message. I couldn't call the real Resend service, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `Resend rejected the email (HTTP 401)` | The key is wrong or was revoked. Check `RESEND_API_KEY` for stray spaces or quotes. |
| `Resend rejected the email (HTTP 403)` | The From address isn't on a domain you've verified. Check `MAIL_FROM` against the domain in the dashboard. |
| `Resend rejected the email (HTTP 422)` | The request was invalid. The usual cause is a `MAIL_FROM` that isn't in the form `Name <address@domain>` or `address@domain`. |
| `Resend rejected the email (HTTP 429)` | Too many requests too quickly. Resend limits requests per second. |
| `could not reach Resend` (Go), `fetch failed` (TypeScript) | No network route to `api.resend.com`: a firewall, or the host blocks outgoing requests. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
