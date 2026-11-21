---
title: Send email with Postmark
description: Connect Postmark to a SelfAuth project, with working mailer code for Express, Fastify (TypeScript) and Gin (Go), the environment variables to set, how to try it locally and the errors people hit.
keywords: [postmark, send email, postmark api, mailer, createMailer, NewMailer, transactional email, express, fastify, gin]
---

# Send email with Postmark

[Postmark](https://postmarkapp.com) only sends transactional email, the kind a sign-up or a password reset produces, and keeps it apart from newsletters. It has a plain HTTP API, so you don't need its SDK or any new package.

## Before you start

1. Create a Postmark account and a **server**. A server is a bucket for one app's mail, with its own token.
2. Add your sending domain (use a subdomain like `mail.example.com`) as a **sender signature**, and create the DNS records Postmark shows you. Wait until it shows as verified. [Why this matters](./#verify-your-sending-domain).
3. Copy the **server API token** from the server's *API Tokens* tab. It sends through the `outbound` message stream, which every server has.
4. New accounts may be limited until Postmark approves them: you might only be able to send to addresses on your own domain at first. The dashboard says if that applies.

## Environment

| Variable | Value |
| --- | --- |
| `POSTMARK_SERVER_TOKEN` | The server's API token |
| `MAIL_FROM` | The sender, on your verified domain: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const token = process.env["POSTMARK_SERVER_TOKEN"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!token) {
    if (env.nodeEnv === "production") {
      throw new Error("POSTMARK_SERVER_TOKEN and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when POSTMARK_SERVER_TOKEN is set");

  return {
    async send(m) {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": token,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: from,
          To: m.to,
          Subject: m.subject,
          TextBody: m.text, // already holds the sentence and the link
          MessageStream: "outbound",
          TrackLinks: "None", // the links hold one-time tokens: no click tracking
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Postmark rejected the email (HTTP ${response.status})`);
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

// postmarkURL is a variable so a test can point it at a fake server.
var postmarkURL = "https://api.postmarkapp.com/email"

type postmarkMailer struct {
	token, from string
	client      *http.Client
}

func (m postmarkMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	body, err := json.Marshal(map[string]any{
		"From":          m.from,
		"To":            msg.To,
		"Subject":       msg.Subject,
		"TextBody":      msg.Text, // already holds the sentence and the link
		"MessageStream": "outbound",
		"TrackLinks":    "None", // the links hold one-time tokens: no click tracking
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, postmarkURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-Postmark-Server-Token", m.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach Postmark") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("postmark rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	token, from := os.Getenv("POSTMARK_SERVER_TOKEN"), os.Getenv("MAIL_FROM") // from: "Notes <login@mail.example.com>"
	if token == "" {
		if env.Production() {
			return nil, errors.New("POSTMARK_SERVER_TOKEN and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	if from == "" {
		return nil, errors.New("MAIL_FROM is required when POSTMARK_SERVER_TOKEN is set")
	}
	return postmarkMailer{token: token, from: from, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

In the Go code, replace `notes-app` in the two imports with your module name. It's whatever `go.mod` says on its first line.

What the code does:

- **No token set:** in development it prints emails in the terminal. In production the server refuses to start and says which variable is missing.
- **Token set:** it sends every message through Postmark, in development as well, which is how you try it before deploying.
- **Link tracking off:** `TrackLinks: "None"` keeps Postmark from rewriting your verification and reset links.
- **Failure:** if Postmark answers with an error, the error says only the status, never the message or its link.
- **Time limit:** a request that takes longer than 10 seconds is given up.

## Try it

Put your two settings where the server will see them, then register with an address you own.

::: code-group

```text [TypeScript: .env]
POSTMARK_SERVER_TOKEN=your-server-token
MAIL_FROM=Notes <login@mail.example.com>
```

```bash [Go: terminal]
export POSTMARK_SERVER_TOKEN=your-server-token
export MAIL_FROM="Notes <login@mail.example.com>"
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. If it doesn't, open the server's **Activity** in the Postmark dashboard: it shows every message Postmark received and what happened to it. Remove the two settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The code compiles in generated Express, Fastify and Gin projects, and it was run against a local fake server that checks the URL, the `X-Postmark-Server-Token` header and the JSON body described in Postmark's API reference, and that an error response doesn't leak the message. I couldn't call the real Postmark service, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `Postmark rejected the email (HTTP 401)` | The server token is wrong. Use the server's token, not the account token, and check for stray spaces or quotes. |
| `Postmark rejected the email (HTTP 422)` | Postmark refused the request. The usual cause is a `MAIL_FROM` that isn't a confirmed sender signature or on a verified domain. The Activity page and the API's error message in the dashboard say which. |
| `Postmark rejected the email (HTTP 429)` | Too many requests too quickly. |
| The email is rejected for the recipient | A new account may only be able to send to addresses on your own domain until Postmark approves it. |
| `could not reach Postmark` (Go), `fetch failed` (TypeScript) | No network route to `api.postmarkapp.com`: a firewall, or the host blocks outgoing requests. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
