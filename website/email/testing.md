---
title: Test your mailer
description: Write automated tests for your email provider code in a SelfAuth project, using a fake server so no real email is sent, for Express and Fastify (node:test), Gin (go test) and Flask (pytest), including a check that errors never contain the one-time link.
keywords: [test mailer, test email, fake server, node test, go test, httptest, mock fetch, resend, createMailer, NewMailer]
---

# Test your mailer

Your mailer is code that sends login links. A test makes sure nobody breaks it by accident, and costs no emails. The idea is the same for every provider:

1. Point the mailer at a **fake server** (Go and Python) or a **fake `fetch`** (TypeScript) that records the request and answers with a status you choose.
2. Send one message.
3. Check what the fake received: the URL, the key, and the fields.
4. Make the fake answer with an error, and check that the error doesn't contain the one-time link.

The examples use [Resend](./resend). For another provider, change the URL, the header and the fields in the checks to match its page.

## TypeScript (Express and Fastify)

Create `test/mailer.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DevConsoleMailer } from "../src/auth/index.ts";
import { loadEnv } from "../src/config/env.ts";
import { createMailer } from "../src/email/mailer.ts";

const production = loadEnv({
  NODE_ENV: "production",
  SELFAUTH_APP_BASE_URL: "https://notes.example.com",
});
const development = loadEnv({
  NODE_ENV: "development",
  SELFAUTH_APP_BASE_URL: "http://localhost:5173",
});

const message = {
  kind: "verification" as const,
  to: "maya@example.com",
  subject: "Verify your email",
  text: "Open this link: https://notes.example.com/verify-email#token=SECRET-TOKEN",
  link: "https://notes.example.com/verify-email#token=SECRET-TOKEN",
};

const realFetch = globalThis.fetch;
const requests: { url: string; init: RequestInit }[] = [];

/** Replaces fetch with a fake that records the request and answers with `status`. */
function fakeProvider(status: number) {
  requests.length = 0;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env["RESEND_API_KEY"];
  delete process.env["MAIL_FROM"];
});

describe("mailer", () => {
  it("sends the message to Resend", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["MAIL_FROM"] = "Notes <login@mail.example.com>";
    fakeProvider(200);

    await createMailer(production).send(message);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, "https://api.resend.com/emails");
    const headers = requests[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer re_test");
    assert.deepEqual(JSON.parse(requests[0]!.init.body as string), {
      from: "Notes <login@mail.example.com>",
      to: ["maya@example.com"],
      subject: "Verify your email",
      text: message.text,
    });
  });

  it("fails with the status, and without the one-time link", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    process.env["MAIL_FROM"] = "Notes <login@mail.example.com>";
    fakeProvider(403);

    await assert.rejects(createMailer(production).send(message), (error: Error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /SECRET-TOKEN/);
      return true;
    });
  });

  it("refuses to start in production without a key", () => {
    assert.throws(() => createMailer(production), /RESEND_API_KEY/);
  });

  it("prints emails in the terminal in development without a key", () => {
    assert.ok(createMailer(development) instanceof DevConsoleMailer);
  });
});
```

Run it:

```bash
npm test
```

```text
# tests 4
# suites 1
# pass 4
# fail 0
```

The fake `fetch` replaces the real one only while the test runs, and `afterEach` puts it back, so no test can send a real email or affect another. The checks on `url`, `headers` and `body` are the ones to change for another provider.

## Go (Gin)

Create `internal/email/mailer_test.go`:

```go
package email

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"notes-app/internal/auth"
	"notes-app/internal/config"
)

var verification = auth.EmailMessage{
	Kind:    auth.EmailVerification,
	To:      "maya@example.com",
	Subject: "Verify your email",
	Text:    "Open this link: https://notes.example.com/verify-email#token=SECRET-TOKEN",
}

var (
	production  = config.Env{NodeEnv: "production"}
	development = config.Env{NodeEnv: "development"}
)

// request is what the fake provider received.
type request struct {
	authorization string
	body          map[string]any
}

// fakeProvider starts a local server that stands in for Resend. It records the request
// and answers with status, and the mailer is pointed at it until the test ends.
func fakeProvider(t *testing.T, status int) *request {
	t.Helper()
	got := &request{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.authorization = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got.body)
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	previous := resendURL
	resendURL = server.URL
	t.Cleanup(func() { resendURL = previous })
	return got
}

// The tests below replace resendURL with the fake server, so check once that the real one is right.
func TestPointsAtResend(t *testing.T) {
	if resendURL != "https://api.resend.com/emails" {
		t.Fatalf("resendURL = %q", resendURL)
	}
}

func TestSendsTheMessageToResend(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("MAIL_FROM", "Notes <login@mail.example.com>")
	got := fakeProvider(t, http.StatusOK)

	mailer, err := NewMailer(production)
	if err != nil {
		t.Fatal(err)
	}
	if err := mailer.Send(context.Background(), verification); err != nil {
		t.Fatal(err)
	}

	if got.authorization != "Bearer re_test" {
		t.Errorf("authorization = %q", got.authorization)
	}
	if got.body["from"] != "Notes <login@mail.example.com>" || got.body["subject"] != "Verify your email" || got.body["text"] != verification.Text {
		t.Errorf("body = %v", got.body)
	}
	if to, _ := got.body["to"].([]any); len(to) != 1 || to[0] != "maya@example.com" {
		t.Errorf("to = %v", got.body["to"])
	}
}

func TestFailsWithTheStatusAndWithoutTheLink(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("MAIL_FROM", "Notes <login@mail.example.com>")
	fakeProvider(t, http.StatusForbidden)

	mailer, err := NewMailer(production)
	if err != nil {
		t.Fatal(err)
	}
	err = mailer.Send(context.Background(), verification)
	if err == nil || !strings.Contains(err.Error(), "HTTP 403") {
		t.Fatalf("got %v, want an error with the status", err)
	}
	if strings.Contains(err.Error(), "SECRET-TOKEN") {
		t.Fatal("the error must not contain the one-time link")
	}
}

func TestProductionNeedsAKey(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	if _, err := NewMailer(production); err == nil || !strings.Contains(err.Error(), "RESEND_API_KEY") {
		t.Fatalf("got %v, want an error naming RESEND_API_KEY", err)
	}
}

func TestDevelopmentPrintsEmails(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	mailer, err := NewMailer(development)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := mailer.(*auth.DevConsoleMailer); !ok {
		t.Fatalf("got %T, want the development mailer", mailer)
	}
}
```

Run it:

```bash
go test ./internal/email/ -v
```

```text
=== RUN   TestPointsAtResend
--- PASS: TestPointsAtResend (0.00s)
=== RUN   TestSendsTheMessageToResend
--- PASS: TestSendsTheMessageToResend (0.00s)
=== RUN   TestFailsWithTheStatusAndWithoutTheLink
--- PASS: TestFailsWithTheStatusAndWithoutTheLink (0.00s)
=== RUN   TestProductionNeedsAKey
--- PASS: TestProductionNeedsAKey (0.00s)
=== RUN   TestDevelopmentPrintsEmails
--- PASS: TestDevelopmentPrintsEmails (0.00s)
PASS
```

This is why every Go mailer keeps its URL in a variable such as `resendURL`: the test points it at the fake server, which `httptest` starts on a free local port. Because the other tests replace the URL, `TestPointsAtResend` checks the real one. `t.Setenv` sets the keys for one test and puts them back afterwards. For another provider, change the variable's name and the checks on the header and the body.

## Python (Flask)

Create `tests/test_mailer.py`. It starts a tiny local server with the standard library; no extra package is needed:

```python
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app import mailer
from app.auth.mailer import DevConsoleMailer, EmailMessage
from app.config import Env

MESSAGE = EmailMessage(
    kind="verification", to="maya@example.com", subject="Verify your email",
    text="Open this link: https://notes.example.com/verify-email#token=SECRET-TOKEN",
)
PRODUCTION = Env(app_env="production", app_base_url="https://notes.example.com")
DEVELOPMENT = Env(app_env="development", app_base_url="http://localhost:5173")


@pytest.fixture
def provider(monkeypatch):
    """A local server that stands in for Resend: it records the request and answers with `.status`."""
    seen: dict = {"status": 200}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            seen["authorization"] = self.headers["Authorization"]
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(seen["status"])
            self.end_headers()

        def log_message(self, *args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(mailer, "RESEND_URL", f"http://127.0.0.1:{server.server_port}/emails")
    yield seen
    server.shutdown()


def test_points_at_resend() -> None:
    # The other tests replace the URL, so check the real one once.
    assert mailer.RESEND_URL == "https://api.resend.com/emails"


def test_sends_the_message_to_resend(provider, monkeypatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("MAIL_FROM", "Notes <login@mail.example.com>")
    mailer.create_mailer(PRODUCTION).send(MESSAGE)
    assert provider["authorization"] == "Bearer re_test"
    assert provider["body"] == {
        "from": "Notes <login@mail.example.com>", "to": ["maya@example.com"],
        "subject": "Verify your email", "text": MESSAGE.text,
    }


def test_fails_with_the_status_and_without_the_link(provider, monkeypatch) -> None:
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("MAIL_FROM", "Notes <login@mail.example.com>")
    provider["status"] = 403
    with pytest.raises(RuntimeError) as error:
        mailer.create_mailer(PRODUCTION).send(MESSAGE)
    assert "HTTP 403" in str(error.value)
    assert "SECRET-TOKEN" not in str(error.value)


def test_production_needs_a_key(monkeypatch) -> None:
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        mailer.create_mailer(PRODUCTION)


def test_development_prints_emails(monkeypatch) -> None:
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert isinstance(mailer.create_mailer(DEVELOPMENT), DevConsoleMailer)
```

Run it:

```bash
pytest tests/test_mailer.py -v
```

The mailer keeps its URL in a module variable, `RESEND_URL`, so `monkeypatch.setattr` can point it at the fake server for one test. Because the other tests replace the URL, `test_points_at_resend` checks the real one. `monkeypatch.setenv` sets the keys for one test and puts them back afterwards.

## Check it worked

Break the mailer on purpose: change the URL in `mailer.ts`, `mailer.go` or `mailer.py` by one letter, and run the tests. The first test should fail. Put it back.

## If something went wrong

- **`Cannot read properties of undefined` (TypeScript).** The mailer didn't call `fetch`. A key is probably missing: both tests set `RESEND_API_KEY` and `MAIL_FROM` first.
- **The test tries to reach the real provider.** The fake isn't in place. In TypeScript, call `fakeProvider(...)` before `send`. In Go, call `fakeProvider(t, ...)` before `NewMailer` and `Send`.
- **`undefined: resendURL` (Go).** Your mailer file is for another provider. Use the name of the variable in your own file.
