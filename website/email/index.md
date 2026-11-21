---
title: Send real email
description: How SelfAuth sends verification and password reset emails, how to connect a provider such as Resend, Postmark, SendGrid, Mailgun, Brevo or any SMTP server (including Amazon SES), and what every provider setup needs.
keywords: [send email, mailer, email provider, resend, postmark, sendgrid, mailgun, brevo, smtp, amazon ses, verification email, password reset email, createMailer, NewMailer]
---

# Send real email

SelfAuth writes the emails (verify your address, reset your password) but doesn't send them. It has no way of knowing whether you use Resend, Amazon SES or your own mail server, so you plug in one small piece of code: the **mailer**.

| Environment | What happens |
| --- | --- |
| Development | Emails are printed in the server's terminal, one-time links included. Nothing is sent. |
| Production | The server refuses to start until a real mailer is connected. That's on purpose: otherwise sign-up would work and nobody would ever receive a verification email. |

This section has a ready-made mailer for each of the common providers, in TypeScript (Express and Fastify) and in Go (Gin). Flask (Python) has a ready-made mailer for [Resend](./resend) and a [template](./other-providers) for every other provider; the other pages' TypeScript tabs give the URL, headers and fields to put in it. Pick one, copy the code, set two or three environment variables, and you're done.

## Pick a provider

| Provider | A good fit if | How it's called |
| --- | --- | --- |
| [Resend](./resend) | You want the quickest setup with a clean API | HTTP API |
| [Postmark](./postmark) | You only send transactional email, like this | HTTP API |
| [SendGrid](./sendgrid) | Your company already has an account | HTTP API |
| [Mailgun](./mailgun) | You want US or EU hosting, or already use it | HTTP API |
| [Brevo](./brevo) | You also send newsletters from the same account | HTTP API |
| [Any SMTP server](./smtp) | You use Amazon SES, Google Workspace, your host's mail server, or anything else with SMTP | SMTP |
| [Something else](./other-providers) | Your provider isn't listed | A template to fill in |

All of them do the same job, and switching later means replacing one file. If you don't have a favourite, start with Resend or Postmark. Both take about ten minutes.

## What a mailer is

A mailer has one method that sends one message. SelfAuth calls it whenever it needs an email sent.

::: code-group

```ts [TypeScript]
interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

interface EmailMessage {
  kind: "verification" | "passwordReset" | "accountExists" | "passwordChanged" | "passwordResetCompleted";
  to: string;
  subject: string;
  text: string; // the finished sentence, link included
  link?: string; // set for messages that carry a link
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
	Text    string // the finished sentence, link included
	Link    string // set for messages that carry a link
}
```

:::

`text` already holds the whole message with the link in it, so the simplest mailer sends `subject` and `text` exactly as they are. That's what every page here does. The five kinds:

| `kind` | When it's sent |
| --- | --- |
| `verification` | After registering, or when the user asks for a new link |
| `passwordReset` | After a reset request for an existing account |
| `accountExists` | Someone registers with an email that already has an account. The owner learns about it, while the answer to the web request stays the same |
| `passwordChanged` | After a password change |
| `passwordResetCompleted` | After a reset finished |

## Where the mailer lives

| Backend | File | Function |
| --- | --- | --- |
| Express, Fastify | `src/email/mailer.ts` | `createMailer(env)` |
| Gin | `internal/email/mailer.go` | `NewMailer(env)` |
| Flask | `app/mailer.py` | `create_mailer(env)` |

In a project with a frontend, the Express, Fastify, Gin and Flask paths are under `server/`. Replace the whole file with the code from your provider's page.

## How every page works

Each provider page follows the same steps, so once you've done one, the others are familiar:

1. **Before you start:** what to set up in the provider's dashboard.
2. **Environment:** the variables the code reads.
3. **The code:** one tab for TypeScript, one for Go (Resend and the template also have Python).
4. **Try it:** send yourself a real email from your own machine.
5. **If something went wrong:** the errors people hit most.

The code reads its keys from environment variables and never from a file in your repository. In a TypeScript project you can put them in `.env` while you try things locally. In a Go project, export them in your terminal, because the Go server doesn't read `.env` by itself. In production, set them in your hosting platform.

If the key isn't set, development falls back to printing emails in the terminal. In production a missing key stops the server from starting, with a message naming the variable.

## What every provider needs

These apply whichever provider you pick, and they cause most of the "my emails don't arrive" problems.

### Verify your sending domain

Mail from an address the sender doesn't control is treated as forged, so providers only send from a domain you've proven is yours. In the provider's dashboard you add your domain, and it shows you a few DNS records to create at your domain registrar. They're called SPF and DKIM, and they tell receiving mail servers that the provider is allowed to send for you. Wait for the dashboard to show the domain as verified before you send anything.

Use a subdomain such as `mail.example.com` rather than your main domain. Your sign-up emails then build their own reputation, and a mistake can't affect the email your company sends from `example.com`.

Your `MAIL_FROM` address must be on that domain, for example `Notes <login@mail.example.com>`.

Also add a **DMARC** record for the domain (`_dmarc.example.com`, type TXT, value `v=DMARC1; p=none`). It's a one-line record that tells receivers what to do with mail that fails the checks, and Gmail and Yahoo expect it from anyone sending in volume.

### Turn off link tracking

Many providers can rewrite every link in an email so they can count clicks. Your verification and reset links carry a one-time token. You don't want that token passing through a tracking redirect on another company's server, and rewritten links sometimes break. Leave click tracking off. The pages here turn it off in the request where the provider allows it, and say where to check the dashboard for the rest.

### Send from a verified, real address

Use an address that exists in your domain's mail setup, such as `login@mail.example.com`, or `noreply@…` if you don't want replies. Receivers are more suspicious of obviously made-up senders.

### Never log the message

The `text` and `link` of a message are one-time login material. The mailers here keep them out of errors: if the provider rejects a message, the error says only the provider's name and the HTTP status. Don't add logging that prints the message or the provider's response.

### Time out

Every request has a 10-second limit, so a provider that's down doesn't leave your sign-up page hanging forever.

## When the provider fails

If the mailer throws, SelfAuth doesn't pretend the email went out. The sign-up or reset request answers `500`, with the standard error format, and the details go to your server log. The account may already exist, so a user who sees the error can ask for a fresh link:

```text
POST /auth/email/verification
```

Watch your server log for these errors in production. A burst of "rejected the email (HTTP 403)" usually means a key or sender setting changed.

## Test before real users arrive

1. Try the provider locally, as each page's "Try it" section shows.
2. Register with an address you own, at a different provider than the one you're testing (Gmail, for example). Check the inbox *and* the spam folder.
3. Open the email's "show original" view and check that SPF, DKIM and DMARC all say `PASS`.
4. Keep an automated test for your mailer so a later change can't break it silently: see [Test your mailer](./testing).

## Something went wrong, in general

- **The server won't start in production, naming a variable.** That variable isn't set where the server runs.
- **No email arrives, no error.** The domain isn't verified yet, or the message is in spam. Check the provider's dashboard: every provider has a log of what it received and what happened to it.
- **`401` or `403` from the provider.** The key is wrong or revoked, or the From address isn't on a verified domain.
