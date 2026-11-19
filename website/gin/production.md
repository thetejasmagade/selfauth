---
title: "11. Get ready for production"
description: Take a Gin (Go) SelfAuth project to production. Connect a real email provider, pick a production database, set the environment, run migrations as a deploy step, build and start the server, and check the result.
keywords: [production, deploy, go build, email provider, resend, NewMailer, APP_ENV, https, migrations, doctor, gin]
---

# 11. Get ready for production

In production, SelfAuth is strict on purpose. The server refuses to start rather than run in an unsafe state: without a real email provider, without a database, or with an `http://` address. This chapter goes through each of those.

Start by asking SelfAuth what's missing:

```bash
npx selfauth doctor
```

```text
  ⚠ no email provider yet: implement NewMailer in internal/email/mailer.go before production
  • you changed 2 generated file(s): internal/routes/routes.go, selfauth.config.json

0 error(s), 1 warning(s).
```

## 1. Send real email

In development, emails are printed in the terminal. In production nobody reads that terminal, so verification and password reset emails would be lost. That's why the server won't start until you connect a provider:

```text
no email provider configured: implement NewMailer in internal/email/mailer.go before running in production
```

Open `internal/email/mailer.go`. A mailer has one method that sends one message. Here's one for [Resend](https://resend.com), using only Go's standard library. Any provider with an HTTP API looks much the same. Replace the whole file with:

```go
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

`MAIL_FROM` must be on a domain you've verified with Resend. Send yourself a test email before real users depend on it.

## 2. Use a production database

SQLite is a single file on a single machine. That's fine for learning, but in production you'll usually want PostgreSQL (or MySQL, or MongoDB): it survives the server being replaced, and several copies of your app can share it. To switch, create a new project with `--database postgresql` and move your code across: `internal/routes/` works as it is once you change the placeholders to `$1, $2…`, and your migrations need the PostgreSQL types from [chapter 6](./add-a-table).

Whatever you choose, **back up the database before every migration.** There's no undo, as [chapter 8](./change-a-table) explained.

## 3. Set the environment

Set these on your hosting platform, not in a file in your repository:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production`. This turns on the strict checks and the secure cookie. |
| `DATABASE_URL` | Your production database |
| `SELFAUTH_APP_BASE_URL` | Your site's public address, starting with `https://`. Email links point here. |
| `PORT` | Whatever your host expects. Many set it for you. |
| `RESEND_API_KEY`, `MAIL_FROM` | Your email provider |
| `SELFAUTH_CONFIG` | Only if `selfauth.config.json` isn't in the folder the server starts in |

Two more things in `selfauth.config.json`:

- **Behind a proxy or load balancer?** Almost every host puts one in front of you. Set `http.trustProxy` to `1`, so rate limits see your visitors' real addresses instead of the proxy's.
- **Frontend on a different domain from the API?** Read [Frontend deployment](/reference/frontend-deployment) first. The same-domain setup is simpler and safer.

## 4. Deploy

Build the server once:

```bash
go build -o bin/server ./cmd/server
```

Then each deploy runs these steps, in this order:

```bash
go run ./cmd/migrate up        # apply new migrations
go run ./cmd/seed              # write roles and permissions
APP_ENV=production ./bin/server
```

Copy `selfauth.config.json` and `db/migrations/` to the server along with the binary: the server reads the first, and the migration step reads the second.

`go run ./cmd/migrate up` applies migrations without the safety review, so do the review *before* deploying: run `npx selfauth db plan` against a copy of the production database, or as a step in your CI. Never let the server migrate itself on start. SelfAuth's code never does, and yours shouldn't either.

After the first deploy, register your own account, verify it, and make yourself an admin with `go run ./cmd/create-admin you@example.com` on the server.

## 5. Check it worked

```bash
curl -i https://notes.example.com/health        # 200 {"status":"ok"}
curl -i https://notes.example.com/api/notes     # 401 UNAUTHENTICATED
```

Then, in a browser:

1. Register with a real address and check that the email arrives.
2. Sign in, and in the developer tools check the cookie: it should be called `__Host-session`, and be `Secure` and `HttpOnly`.
3. Save a note, sign in as another user and confirm you can't see it.

## Startup errors you might meet

| Message | Fix |
| --- | --- |
| `no email provider configured` | Step 1 |
| `DATABASE_URL is required in production` | Set `DATABASE_URL` |
| `SELFAUTH_APP_BASE_URL must use https in production` | Use the `https://` address |
| `role "user" is missing in the database` | Run `go run ./cmd/seed` |
| `could not start on port 3000: … address already in use` | Something else is using the port. Set `PORT`, or stop the other program. |
| `open selfauth.config.json: no such file or directory` | Start the server in the folder that has it, or set `SELFAUTH_CONFIG` |

## Before real users arrive

- Have someone you trust review the code: your routes especially, and the generated code if you can. SelfAuth hasn't had an independent audit yet.
- Watch for security fixes. `npx selfauth@latest diff` shows what a newer version would change, and `npx selfauth@latest upgrade` applies it without touching the files you've changed. See [upgrade](/reference/cli/upgrade).
- Keep `.env` out of git. It's already in `.gitignore`, along with `bin/` and your SQLite files.

That's the guide. You've built and tested a small Go app with sign-in, permissions, an admin view and its own table. From here, the [reference](/reference/cli/) has every command, setting and error code, and [Troubleshooting](/help/troubleshooting) has the error messages people run into most.
