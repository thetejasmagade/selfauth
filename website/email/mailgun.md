---
title: Send email with Mailgun
description: Connect Mailgun to a SelfAuth project, with working mailer code for Express, Fastify (TypeScript) and Gin (Go), the environment variables to set, US and EU regions, how to try it locally and the errors people hit.
keywords: [mailgun, send email, mailgun api, mailer, createMailer, NewMailer, transactional email, eu region, express, fastify, gin]
---

# Send email with Mailgun

[Mailgun](https://www.mailgun.com) has a plain HTTP API, so you don't need its SDK or any new package. Accounts live in one of two regions, US or EU, and the code lets you choose.

## Before you start

1. Create a Mailgun account and add your sending domain (use a subdomain like `mail.example.com`). Create the DNS records Mailgun shows you and wait until the domain shows as verified. [Why this matters](./#verify-your-sending-domain).
2. Create an API key. A **domain sending key** is the safest, because it can only send for one domain.
3. Note your **region**. If you chose the EU region when you created the domain, you need the EU address in `MAILGUN_BASE_URL` below. Using the wrong region is the most common Mailgun mistake.
4. Mailgun gives every account a *sandbox* domain for testing. It only sends to addresses you've added as authorized recipients, so use your own domain for anything real.

## Environment

| Variable | Value |
| --- | --- |
| `MAILGUN_API_KEY` | The key you created |
| `MAILGUN_DOMAIN` | The sending domain you verified: `mail.example.com` |
| `MAILGUN_BASE_URL` | Only for EU accounts: `https://api.eu.mailgun.net`. Leave it out for the US region. |
| `MAIL_FROM` | The sender, on that domain: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

Unlike the other providers, Mailgun takes a web form, not JSON, and signs in with HTTP basic authentication: the user name is always `api` and the password is your key.

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const apiKey = process.env["MAILGUN_API_KEY"];
  const domain = process.env["MAILGUN_DOMAIN"]; // the domain you verified, for example "mail.example.com"
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  const baseUrl = process.env["MAILGUN_BASE_URL"] ?? "https://api.mailgun.net"; // EU: https://api.eu.mailgun.net
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("MAILGUN_API_KEY, MAILGUN_DOMAIN and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!domain || !from) {
    throw new Error("MAILGUN_DOMAIN and MAIL_FROM are required when MAILGUN_API_KEY is set");
  }
  const authorization = `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`;

  return {
    async send(m) {
      const response = await fetch(`${baseUrl}/v3/${encodeURIComponent(domain)}/messages`, {
        method: "POST",
        headers: { Authorization: authorization },
        body: new URLSearchParams({
          from,
          to: m.to,
          subject: m.subject,
          text: m.text, // already holds the sentence and the link
          "o:tracking-clicks": "no", // the links hold one-time tokens: no click tracking
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Mailgun rejected the email (HTTP ${response.status})`);
      }
    },
  };
}
```

```go [Go: internal/email/mailer.go]
// Package email provides the application's mailer.
package email

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"notes-app/internal/auth"
	"notes-app/internal/config"
)

type mailgunMailer struct {
	// endpoint is the full messages URL, for example https://api.mailgun.net/v3/mail.example.com/messages.
	endpoint, apiKey, from string
	client                 *http.Client
}

func (m mailgunMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	form := url.Values{}
	form.Set("from", m.from)
	form.Set("to", msg.To)
	form.Set("subject", msg.Subject)
	form.Set("text", msg.Text)          // already holds the sentence and the link
	form.Set("o:tracking-clicks", "no") // the links hold one-time tokens: no click tracking
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth("api", m.apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach Mailgun") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("mailgun rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	apiKey, domain, from := os.Getenv("MAILGUN_API_KEY"), os.Getenv("MAILGUN_DOMAIN"), os.Getenv("MAIL_FROM")
	baseURL := os.Getenv("MAILGUN_BASE_URL") // EU accounts: https://api.eu.mailgun.net
	if baseURL == "" {
		baseURL = "https://api.mailgun.net"
	}
	if apiKey == "" {
		if env.Production() {
			return nil, errors.New("MAILGUN_API_KEY, MAILGUN_DOMAIN and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	if domain == "" || from == "" {
		return nil, errors.New("MAILGUN_DOMAIN and MAIL_FROM are required when MAILGUN_API_KEY is set")
	}
	return mailgunMailer{
		endpoint: strings.TrimRight(baseURL, "/") + "/v3/" + url.PathEscape(domain) + "/messages",
		apiKey:   apiKey,
		from:     from,
		client:   &http.Client{Timeout: 10 * time.Second},
	}, nil
}
```

:::

In the Go code, replace `notes-app` in the two imports with your module name. It's whatever `go.mod` says on its first line.

What the code does:

- **No key set:** in development it prints emails in the terminal. In production the server refuses to start and says which variable is missing.
- **Key set:** it sends every message through Mailgun, in development as well, which is how you try it before deploying.
- **Link tracking off:** `o:tracking-clicks` is set to `no`, so Mailgun doesn't rewrite your verification and reset links.
- **Failure:** if Mailgun answers with an error, the error says only the status, never the message or its link.
- **Time limit:** a request that takes longer than 10 seconds is given up.

## Try it

Put your settings where the server will see them, then register with an address you own.

::: code-group

```text [TypeScript: .env]
MAILGUN_API_KEY=your-key
MAILGUN_DOMAIN=mail.example.com
MAIL_FROM=Notes <login@mail.example.com>
# EU region only:
# MAILGUN_BASE_URL=https://api.eu.mailgun.net
```

```bash [Go: terminal]
export MAILGUN_API_KEY=your-key
export MAILGUN_DOMAIN=mail.example.com
export MAIL_FROM="Notes <login@mail.example.com>"
# EU region only:
# export MAILGUN_BASE_URL=https://api.eu.mailgun.net
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. If it doesn't, open **Logs** in the Mailgun dashboard: it shows every message Mailgun received and what happened to it. Remove the settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The code compiles in generated Express, Fastify and Gin projects, and it was run against a local fake server that checks the URL, the basic-authentication header and the form fields described in Mailgun's API reference, and that an error response doesn't leak the message. I couldn't call the real Mailgun service, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `Mailgun rejected the email (HTTP 401)` | The API key is wrong. Check `MAILGUN_API_KEY` for stray spaces or quotes. |
| `Mailgun rejected the email (HTTP 404)` | The domain isn't found in this region. Check `MAILGUN_DOMAIN`, and set `MAILGUN_BASE_URL` to the EU address if your domain was created in the EU region. |
| `Mailgun rejected the email (HTTP 403)` | The domain isn't verified yet, or you're using the sandbox domain and the recipient isn't an authorized recipient. |
| `Mailgun rejected the email (HTTP 400)` | A field is missing or invalid. Check that `MAIL_FROM` is on your domain. |
| `could not reach Mailgun` (Go), `fetch failed` (TypeScript) | No network route to Mailgun: a firewall, or the host blocks outgoing requests. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
