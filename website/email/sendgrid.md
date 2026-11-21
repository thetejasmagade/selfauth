---
title: Send email with SendGrid
description: Connect SendGrid to a SelfAuth project, with working mailer code for Express, Fastify (TypeScript) and Gin (Go), the environment variables to set, how to try it locally and the errors people hit.
keywords: [sendgrid, send email, sendgrid api, mail send, mailer, createMailer, NewMailer, transactional email, express, fastify, gin]
---

# Send email with SendGrid

[SendGrid](https://sendgrid.com) is one of the biggest email providers, so there's a good chance your company already has an account. It has a plain HTTP API, so you don't need its SDK or any new package.

## Before you start

1. Create a SendGrid account, or ask your team for access to the existing one.
2. Verify the address or domain you'll send from. For a real product, authenticate your domain (use a subdomain like `mail.example.com`) and create the DNS records SendGrid shows you. SendGrid also offers *single sender verification* for quick tests, which verifies one address by email. [Why this matters](./#verify-your-sending-domain).
3. Create an API key under *Settings → API Keys*, with the **Mail Send** permission.
4. The code turns click tracking off for each email. That's separate from the account-wide setting, so you don't need to change anything, but it's worth knowing that SendGrid enables click tracking by default. [Why it matters](./#turn-off-link-tracking).

## Environment

| Variable | Value |
| --- | --- |
| `SENDGRID_API_KEY` | The key you created, starting with `SG.` |
| `MAIL_FROM` | The sender, on your verified domain or the verified single sender: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

SendGrid wants the sender as a name and an address in separate fields, so the code splits `MAIL_FROM` for you.

::: warning Go: replace YOUR_MODULE first
The Go code imports `YOUR_MODULE/internal/auth` and `YOUR_MODULE/internal/config`. `YOUR_MODULE` is a placeholder: change it, in both imports, to your own module name, which is the first line of `go.mod` (`module …`). With a frontend that file is `server/go.mod`. Skipping this gives `package YOUR_MODULE/internal/auth is not in std`.
:::

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

/** "Notes <login@mail.example.com>" becomes { name: "Notes", email: "login@mail.example.com" }. */
function parseAddress(value: string): { email: string; name?: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1]?.trim();
  return name ? { email: match[2]!.trim(), name } : { email: match[2]!.trim() };
}

export function createMailer(env: Env): Mailer {
  const apiKey = process.env["SENDGRID_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("SENDGRID_API_KEY and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when SENDGRID_API_KEY is set");
  const sender = parseAddress(from);

  return {
    async send(m) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: m.to }] }],
          from: sender,
          subject: m.subject,
          content: [{ type: "text/plain", value: m.text }], // already holds the sentence and the link
          // The links hold one-time tokens: keep them out of SendGrid's click tracking.
          tracking_settings: { click_tracking: { enable: false, enable_text: false } },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`SendGrid rejected the email (HTTP ${response.status})`);
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
	"net/mail"
	"os"
	"time"

	"YOUR_MODULE/internal/auth"
	"YOUR_MODULE/internal/config"
)

// sendgridURL is a variable so a test can point it at a fake server.
var sendgridURL = "https://api.sendgrid.com/v3/mail/send"

type sendgridMailer struct {
	apiKey string
	from   mail.Address
	client *http.Client
}

func (m sendgridMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	sender := map[string]string{"email": m.from.Address}
	if m.from.Name != "" {
		sender["name"] = m.from.Name
	}
	body, err := json.Marshal(map[string]any{
		"personalizations": []any{map[string]any{"to": []any{map[string]string{"email": msg.To}}}},
		"from":             sender,
		"subject":          msg.Subject,
		"content":          []any{map[string]string{"type": "text/plain", "value": msg.Text}}, // holds the sentence and the link
		// The links hold one-time tokens: keep them out of SendGrid's click tracking.
		"tracking_settings": map[string]any{
			"click_tracking": map[string]bool{"enable": false, "enable_text": false},
		},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sendgridURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach SendGrid") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("sendgrid rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	apiKey, from := os.Getenv("SENDGRID_API_KEY"), os.Getenv("MAIL_FROM") // from: "Notes <login@mail.example.com>"
	if apiKey == "" {
		if env.Production() {
			return nil, errors.New("SENDGRID_API_KEY and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return nil, errors.New(`MAIL_FROM must look like "Notes <login@mail.example.com>"`)
	}
	return sendgridMailer{apiKey: apiKey, from: *sender, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

In the Go code, replace `YOUR_MODULE` in the two imports with your module name. It's whatever `go.mod` says on its first line (`server/go.mod` with a frontend).

What the code does:

- **No key set:** in development it prints emails in the terminal. In production the server refuses to start and says which variable is missing.
- **Key set:** it sends every message through SendGrid, in development as well, which is how you try it before deploying.
- **Link tracking off:** each message carries `click_tracking` switched off, so SendGrid doesn't rewrite your verification and reset links.
- **Failure:** if SendGrid answers with an error, the error says only the status, never the message or its link. SendGrid answers `202 Accepted` when it has taken the message.
- **Time limit:** a request that takes longer than 10 seconds is given up.

## Try it

Put your two settings where the server will see them, then register with an address you own.

::: code-group

```text [TypeScript: .env]
SENDGRID_API_KEY=SG.your_key_here
MAIL_FROM=Notes <login@mail.example.com>
```

```bash [Go: terminal]
export SENDGRID_API_KEY=SG.your_key_here
export MAIL_FROM="Notes <login@mail.example.com>"
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. If it doesn't, open **Activity** in the SendGrid dashboard: it shows every message SendGrid received and whether it was delivered, deferred or dropped. Remove the two settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The code compiles in generated Express, Fastify and Gin projects, and it was run against a local fake server that checks the URL, the `Authorization` header and the JSON body described in SendGrid's Mail Send reference, and that an error response doesn't leak the message. I couldn't call the real SendGrid service, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `SendGrid rejected the email (HTTP 401)` | The key is wrong or was deleted. Check `SENDGRID_API_KEY` for stray spaces or quotes. |
| `SendGrid rejected the email (HTTP 403)` | The key can't send mail (it needs the **Mail Send** permission), or the From address isn't a verified single sender or on an authenticated domain. SendGrid's error message in the Activity page says which. |
| `SendGrid rejected the email (HTTP 400)` | The request was invalid. Check that `MAIL_FROM` has the form `Name <address@domain>`. |
| `SendGrid rejected the email (HTTP 429)` | Too many requests too quickly, or the account's sending limit was reached. |
| `could not reach SendGrid` (Go), `fetch failed` (TypeScript) | No network route to `api.sendgrid.com`: a firewall, or the host blocks outgoing requests. |
| `MAIL_FROM must look like …` when the server starts (Go) | `MAIL_FROM` isn't a valid address. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
