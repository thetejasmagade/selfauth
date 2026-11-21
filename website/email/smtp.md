---
title: Send email over SMTP (Amazon SES, Google Workspace and more)
description: Connect any SMTP server to a SelfAuth project, including Amazon SES, Google Workspace and your host's mail server, with working mailer code for Express, Fastify (TypeScript, with nodemailer) and Gin (Go, standard library), and the errors people hit.
keywords: [smtp, amazon ses, ses smtp, nodemailer, gmail, google workspace, send email, mailer, createMailer, NewMailer, starttls, express, fastify, gin]
---

# Send email over SMTP

SMTP is the oldest way to send email, and almost every mail service supports it. Use this page when your provider has no page of its own here, and in particular for **Amazon SES**. SES is cheap and popular, but its own API needs every request signed with your AWS keys, which takes an SDK. Its SMTP interface works with the code below instead.

## Common SMTP servers

| Service | Host | Port | User and password |
| --- | --- | --- | --- |
| Amazon SES | `email-smtp.<region>.amazonaws.com`, for example `email-smtp.eu-west-1.amazonaws.com` | `587` | SMTP credentials made in the SES console (they're not your normal AWS access keys) |
| Google Workspace or Gmail | `smtp.gmail.com` | `587` | Your address and an **app password**. Fine for trying things out, but Google limits how many messages you can send. |
| Mailtrap (a fake inbox for testing) | See your Mailtrap inbox's *SMTP Settings* | `2525` or `587` | Shown on the same page |
| Your hosting provider or company mail server | Ask them | `587` | Ask them |

Check the host and port in your provider's own documentation. These change from time to time.

Port `587` is the standard for sending. The connection starts unencrypted and is upgraded with `STARTTLS` before the password is sent. Port `465` encrypts from the first byte. Port `25` is for servers talking to each other, and many hosts block it, so don't use it.

## Before you start

1. Create the SMTP credentials at your provider.
2. Verify your sending domain, as the provider requires. With Amazon SES, create an **identity** for your domain and add the DNS records. A new SES account starts in the *sandbox* and can only send to addresses you've verified, until you ask AWS for production access. [Why verifying matters](./#verify-your-sending-domain).
3. Check that the provider doesn't track clicks. A plain SMTP connection leaves the links alone, but some services add tracking at the account level. [Why it matters](./#turn-off-link-tracking).

## Environment

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | The server's host name |
| `SMTP_PORT` | `587` (the default if you leave it out) or `465` |
| `SMTP_USER` | The SMTP user name |
| `SMTP_PASS` | The SMTP password |
| `MAIL_FROM` | The sender, on your verified domain: `Notes <login@mail.example.com>` |

## The code

Replace the whole mailer file with this. For the file's location, see [where the mailer lives](./#where-the-mailer-lives).

The TypeScript version uses [nodemailer](https://nodemailer.com), the standard Node.js package for SMTP. Install it first:

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

The Go version needs nothing new: it uses Go's own `net/smtp`.

::: warning Go: replace YOUR_MODULE first
The Go code imports `YOUR_MODULE/internal/auth` and `YOUR_MODULE/internal/config`. `YOUR_MODULE` is a placeholder: change it, in both imports, to your own module name, which is the first line of `go.mod` (`module …`). With a frontend that file is `server/go.mod`. Skipping this gives `package YOUR_MODULE/internal/auth is not in std`.
:::

::: code-group

```ts [TypeScript: src/email/mailer.ts]
import nodemailer from "nodemailer";
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const host = process.env["SMTP_HOST"];
  if (!host) {
    if (env.nodeEnv === "production") {
      throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!user || !pass || !from) {
    throw new Error("SMTP_USER, SMTP_PASS and MAIL_FROM are required when SMTP_HOST is set");
  }
  const port = Number(process.env["SMTP_PORT"] ?? "587");

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // port 465 is encrypted from the first byte; the others upgrade with STARTTLS
    requireTLS: port !== 465, // never send the password over an unencrypted connection
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async send(m) {
      let result;
      try {
        result = await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
      } catch (error) {
        // The error code only (EAUTH, ECONNECTION, ...): never the message, the link or the reply.
        throw new Error(`SMTP server rejected the email (${(error as { code?: string }).code ?? "unknown"})`);
      }
      if (result.rejected.length > 0) throw new Error("SMTP server rejected the recipient");
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
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"

	"YOUR_MODULE/internal/auth"
	"YOUR_MODULE/internal/config"
)

// smtpTLS is a variable so a test can trust a throwaway certificate.
var smtpTLS = func(host string) *tls.Config {
	return &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
}

type smtpMailer struct {
	host, port, user, pass string
	from                   mail.Address
}

func (m smtpMailer) Send(ctx context.Context, msg auth.EmailMessage) error {
	to, err := mail.ParseAddress(msg.To)
	if err != nil || strings.ContainsAny(msg.Subject, "\r\n") {
		return errors.New("refusing to send: invalid recipient or subject")
	}

	// Connect. Port 465 is encrypted from the first byte; the others upgrade with STARTTLS.
	addr := net.JoinHostPort(m.host, m.port)
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	if m.port == "465" {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, smtpTLS(m.host))
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return errors.New("could not reach the SMTP server")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))

	c, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return fmt.Errorf("smtp greeting: %w", err)
	}
	defer c.Close()
	if m.port != "465" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("the SMTP server does not offer STARTTLS: refusing to send the password unencrypted")
		}
		if err := c.StartTLS(smtpTLS(m.host)); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}

	// Send. Errors carry the server's reply (for example a 535 for a wrong password), never the message.
	if err := c.Auth(smtp.PlainAuth("", m.user, m.pass, m.host)); err != nil {
		return fmt.Errorf("smtp login: %w", err)
	}
	if err := c.Mail(m.from.Address); err != nil {
		return fmt.Errorf("smtp sender: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("smtp recipient: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(m.message(to, msg)); err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	return c.Quit()
}

// message builds the email: headers, then the text (which already holds the sentence and the link).
func (m smtpMailer) message(to *mail.Address, msg auth.EmailMessage) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\n", m.from.String())
	fmt.Fprintf(&b, "To: %s\r\n", to.String())
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
	body := quotedprintable.NewWriter(&b)
	_, _ = body.Write([]byte(msg.Text))
	_ = body.Close()
	return b.Bytes()
}

// NewMailer returns the mailer for env.
func NewMailer(env config.Env) (auth.Mailer, error) {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		if env.Production() {
			return nil, errors.New("SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM are required in production")
		}
		// Development: print messages (one-time links included) to the console.
		return auth.NewDevConsoleMailer(false)
	}
	user, pass, port := os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASS"), os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}
	from, err := mail.ParseAddress(os.Getenv("MAIL_FROM")) // "Notes <login@mail.example.com>"
	if err != nil || user == "" || pass == "" {
		return nil, errors.New(`SMTP_USER, SMTP_PASS and a MAIL_FROM like "Notes <login@mail.example.com>" are required when SMTP_HOST is set`)
	}
	return smtpMailer{host: host, port: port, user: user, pass: pass, from: *from}, nil
}
```

:::

In the Go code, replace `YOUR_MODULE` in the two imports with your module name. It's whatever `go.mod` says on its first line (`server/go.mod` with a frontend).

What the code does:

- **No host set:** in development it prints emails in the terminal. In production the server refuses to start and says which variables are missing.
- **Host set:** it sends every message through your SMTP server, in development as well, which is how you try it before deploying.
- **Encryption is required.** The password is only sent after the connection is encrypted. If the server doesn't offer encryption, the code refuses to send rather than send your password in the clear.
- **Failure:** the error carries the server's reply code (such as `535` for a wrong password) or a short reason, never the message or its link.
- **Time limits:** connecting gives up after 10 seconds, and the whole conversation after 30.

## Try it

Put your settings where the server will see them, then register with an address you own. This example uses Amazon SES in Ireland:

::: code-group

```text [TypeScript: .env]
SMTP_HOST=email-smtp.eu-west-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
MAIL_FROM=Notes <login@mail.example.com>
```

```bash [Go: terminal]
export SMTP_HOST=email-smtp.eu-west-1.amazonaws.com
export SMTP_PORT=587
export SMTP_USER=your-smtp-user
export SMTP_PASS=your-smtp-password
export MAIL_FROM="Notes <login@mail.example.com>"
```

:::

Start the server, then register:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"you@your-own-address.com","password":"correct horse battery staple"}'
```

An email titled "Verify your email" should arrive within a few seconds. With Amazon SES in the sandbox, the address you register with must be a verified identity. Remove the settings again when you're done, so development goes back to printing emails in the terminal.

## How this was checked

The TypeScript code compiles in generated Express and Fastify projects, and the Go code in a generated Gin project. Both were run against a local fake SMTP server that requires encryption and a login, and checked for the sender, the recipient, the subject and the message text, that the port 465 and `STARTTLS` paths both work, and that a refused login doesn't leak the message. I couldn't connect to a real provider, so send yourself a test email before real users depend on it.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `SMTP server rejected the email (EAUTH)` (TypeScript), `smtp login: 535 …` (Go) | The user name or password is wrong. With Amazon SES, use SMTP credentials, not AWS access keys. With Gmail, use an app password. |
| `ECONNECTION`, `ETIMEDOUT` or `could not reach the SMTP server` | The host or port is wrong, or a firewall blocks the port. Many hosts block port `25`: use `587`. |
| `the SMTP server does not offer STARTTLS` (Go), `ESOCKET` with a certificate or TLS message (TypeScript) | The port and encryption don't match. Use `587` for STARTTLS, or `465` for encryption from the start. |
| `smtp sender: 554 …` or `smtp recipient: 554 …` | The provider refused the From or To address. Check that the From domain is verified, and with Amazon SES, that you're out of the sandbox or the recipient is verified. |
| `SMTP server rejected the recipient` (TypeScript) | The server took the message but refused the address. |
| The email arrives in spam | The domain's DNS records aren't all in place yet. See [What every provider needs](./#what-every-provider-needs). |
