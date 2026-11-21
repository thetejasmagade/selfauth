---
title: Send email with Brevo
description: Connect Brevo (formerly Sendinblue) to a SelfAuth project, with working mailer code for Express, Fastify (TypeScript) and Gin (Go), the environment variables to set, how to try it locally and the errors people hit.
keywords: [brevo, sendinblue, send email, brevo api, mailer, createMailer, NewMailer, transactional email, express, fastify, gin]
---

# Send email with Brevo

[Brevo](https://www.brevo.com), which used to be called Sendinblue, handles transactional email and newsletters in one account. It has a plain HTTP API, so you don't need its SDK or any new package.

## Before you start

1. Create a Brevo account.
2. Add and authenticate your sending domain (use a subdomain like `mail.example.com`) under *Senders, Domains & Dedicated IPs*, and create the DNS records Brevo shows you. [Why this matters](./#verify-your-sending-domain).
3. Add the sender address you'll use, such as `login@mail.example.com`. Brevo only sends from senders it has validated.
4. Create an API key under *SMTP & API*. Use an **API key** (v3), not an SMTP key.
5. If you've turned on *Authorized IPs* for your account, add your server's address, or Brevo will refuse the requests.

## Environment

| Variable | Value |
| --- | --- |
| `BREVO_API_KEY` | The API key you created |
| `MAIL_FROM` | The validated sender: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

Brevo wants the sender as a name and an address in separate fields, so the code splits `MAIL_FROM` for you.

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
  const apiKey = process.env["BREVO_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("BREVO_API_KEY and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when BREVO_API_KEY is set");
  const sender = parseAddress(from);

  return {
    async send(m) {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email: m.to }],
          subject: m.subject,
          textContent: m.text, // already holds the sentence and the link
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Brevo rejected the email (HTTP ${response.status})`);
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

	"notes-app/internal/auth"
	"notes-app/internal/config"
)

// brevoURL is a variable so a test can point it at a fake server.
var brevoURL = "https://api.brevo.com/v3/smtp/email"

type brevoMailer struct {
	apiKey string
	from   mail.Address
	client *http.Client
}

func (m brevoMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	sender := map[string]string{"email": m.from.Address}
	if m.from.Name != "" {
		sender["name"] = m.from.Name
	}
	body, err := json.Marshal(map[string]any{
		"sender":      sender,
		"to":          []any{map[string]string{"email": msg.To}},
		"subject":     msg.Subject,
		"textContent": msg.Text, // already holds the sentence and the link
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, brevoURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", m.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach Brevo") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("brevo rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	apiKey, from := os.Getenv("BREVO_API_KEY"), os.Getenv("MAIL_FROM") // from: "Notes <login@mail.example.com>"
	if apiKey == "" {
		if env.Production() {
			return nil, errors.New("BREVO_API_KEY and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return nil, errors.New(`MAIL_FROM must look like "Notes <login@mail.example.com>"`)
	}
	return brevoMailer{apiKey: apiKey, from: *sender, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

In the Go code, replace `notes-app` in the two imports with your module name. It's whatever `go.mod` says on its first line.

What the code does:

- **No key set:** in development it prints emails in the terminal. In production the server refuses to start and says which variable is missing.
- **Key set:** it sends every message through Brevo, in development as well, which is how you try it before deploying.
- **Failure:** if Brevo answers with an error, the error says only the status, never the message or its link. Brevo answers `201 Created` when it has taken the message.
- **Time limit:** a request that takes longer than 10 seconds is given up.

Brevo can rewrite links to track clicks in marketing campaigns. Transactional emails sent through this API aren't campaigns, but check your account's tracking settings once, so [your one-time links](./#turn-off-link-tracking) go out untouched.

## Try it

Put your two settings where the server will see them, then register with an address you own.

::: code-group

```text [TypeScript: .env]
BREVO_API_KEY=your-api-key
MAIL_FROM=Notes <login@mail.example.com>
```

```bash [Go: terminal]
export BREVO_API_KEY=your-api-key
export MAIL_FROM="Notes <login@mail.example.com>"
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. If it doesn't, open **Transactional → Logs** in the Brevo dashboard: it shows every message Brevo received and what happened to it. Remove the two settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The code compiles in generated Express, Fastify and Gin projects, and it was run against a local fake server that checks the URL, the `api-key` header and the JSON body described in Brevo's API reference, and that an error response doesn't leak the message. I couldn't call the real Brevo service, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `Brevo rejected the email (HTTP 401)` | The key is wrong, or you used an SMTP key instead of an API key, or *Authorized IPs* is on and your server's address isn't listed. |
| `Brevo rejected the email (HTTP 400)` | The request was invalid. The usual cause is a sender that Brevo hasn't validated: add and validate the address in *Senders*. Also check that `MAIL_FROM` has the form `Name <address@domain>`. |
| `Brevo rejected the email (HTTP 429)` | Too many requests too quickly, or your plan's sending limit was reached. |
| `could not reach Brevo` (Go), `fetch failed` (TypeScript) | No network route to `api.brevo.com`: a firewall, or the host blocks outgoing requests. |
| `MAIL_FROM must look like …` when the server starts (Go) | `MAIL_FROM` isn't a valid address. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
