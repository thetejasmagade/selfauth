---
title: Use an email provider that isn't listed
description: Connect any other email provider to SelfAuth by filling in a template, with the five questions to answer from the provider's documentation, TypeScript and Go code, and what to do for providers that only offer an SDK.
keywords: [custom mailer, email provider, mailjet, mailersend, sparkpost, ses sdk, http api, sdk, createMailer, NewMailer, transactional email]
---

# Use an email provider that isn't listed

Every mailer in this section does the same thing: one HTTP request per email. If your provider has an HTTP API, you can write its mailer in about fifteen minutes by filling in a template. If it doesn't, there's still a way.

## Start from the right place

| Your provider offers | Do this |
| --- | --- |
| SMTP (almost all do) | Use the [SMTP page](./smtp). It's the least work, and it's the way to use Amazon SES. |
| An HTTP API that sends one email per request | Fill in the template below. |
| Only an SDK, a package for one language | Install it and call it from `send()`. See [When there's only an SDK](#when-there-s-only-an-sdk). |

## Five questions for the provider's docs

Open the provider's page for sending a single email, which is usually called "Send email" or "Send transactional email", and find:

1. **The URL** you send the request to, and whether it differs by region.
2. **The authentication**: usually an `Authorization: Bearer <key>` header, or a header with a name of the provider's choosing such as `api-key`, or HTTP basic authentication.
3. **The body format**: JSON or a web form.
4. **The field names** for the sender, the recipient, the subject and the plain-text body, and whether the recipient is a string, a list of strings or a list of objects.
5. **The success status**: `200`, `201` or `202`. The code treats any `2xx` as success, so you don't need the exact number.

Then, while you're in the docs, look for the setting that **turns off click tracking** for one message, and use it. [Why](./#turn-off-link-tracking).

## The template

Replace the parts marked `CHANGE`, and the name in the error messages. The rest stays as it is: it already keeps the message out of errors and gives up after 10 seconds.

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const apiKey = process.env["EXAMPLE_API_KEY"]; // CHANGE: the name of your key's variable
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("EXAMPLE_API_KEY and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when EXAMPLE_API_KEY is set");

  return {
    async send(m) {
      const response = await fetch("https://api.example.com/v1/send", { // CHANGE: question 1
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`, // CHANGE: question 2
          "Content-Type": "application/json", // CHANGE: question 3
        },
        body: JSON.stringify({
          // CHANGE: question 4. The field names your provider uses.
          from,
          to: m.to,
          subject: m.subject,
          text: m.text, // already holds the sentence and the link
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Example rejected the email (HTTP ${response.status})`);
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

// exampleURL is a variable so a test can point it at a fake server.
var exampleURL = "https://api.example.com/v1/send" // CHANGE: question 1

type exampleMailer struct {
	apiKey, from string
	client       *http.Client
}

func (m exampleMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	body, err := json.Marshal(map[string]any{
		// CHANGE: question 4. The field names your provider uses.
		"from":    m.from,
		"to":      msg.To,
		"subject": msg.Subject,
		"text":    msg.Text, // already holds the sentence and the link
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, exampleURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey) // CHANGE: question 2
	req.Header.Set("Content-Type", "application/json")  // CHANGE: question 3
	resp, err := m.client.Do(req)
	if err != nil {
		return errors.New("could not reach Example") // never include the request: it holds the link
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("example rejected the email (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	apiKey, from := os.Getenv("EXAMPLE_API_KEY"), os.Getenv("MAIL_FROM") // CHANGE: your key's variable
	if apiKey == "" {
		if env.Production() {
			return nil, errors.New("EXAMPLE_API_KEY and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	if from == "" {
		return nil, errors.New("MAIL_FROM is required when EXAMPLE_API_KEY is set")
	}
	return exampleMailer{apiKey: apiKey, from: from, client: &http.Client{Timeout: 10 * time.Second}}, nil
}
```

:::

In the Go code, replace `notes-app` in the two imports with your module name. It's whatever `go.mod` says on its first line.

### Worked example: JSON with objects

Some providers want the recipient as a list of objects, and the sender split into a name and an address. The [SendGrid](./sendgrid) and [Brevo](./brevo) pages do exactly that, and include a small function that splits `Notes <login@mail.example.com>` into its two parts. Copy it if you need it.

### Worked example: a web form

Mailgun takes a form, not JSON, and signs in with basic authentication. The [Mailgun page](./mailgun) shows both. In TypeScript, pass a `URLSearchParams` as the body. In Go, build a `url.Values` and call `req.SetBasicAuth`.

## When there's only an SDK

Some providers, or some of their features, are only available through a package for one language. That works too: install the package and call it from `send()`, in the same shape:

```ts
return {
  async send(m) {
    try {
      await client.emails.send({ from, to: m.to, subject: m.subject, text: m.text });
    } catch (error) {
      // Say what failed, not what you were sending.
      throw new Error(`Provider rejected the email (${(error as { name?: string }).name ?? "unknown"})`);
    }
  },
};
```

Three habits matter more than the details:

- **Keep the message out of errors and logs.** The text holds a one-time link. Many SDKs include the request in their error objects, so catch the error and rethrow your own, as above.
- **Set a time limit.** Some SDKs have none by default. Pass a timeout option, or wrap the call in `AbortSignal.timeout(10_000)` if it accepts a signal.
- **Turn off click tracking** for these messages, wherever the provider keeps that setting.

## Check it with a test

Once it works by hand, copy the test from [Test your mailer](./testing) and change the URL, header and body checks to match your provider. It takes five minutes and catches the day someone edits the file by accident.
