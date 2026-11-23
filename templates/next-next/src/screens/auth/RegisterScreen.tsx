"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { describeError, useAuth } from "../../auth-client/index.ts";

export function RegisterScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await auth.client.register({ email, password });
      if (result.signedIn) {
        await auth.store.refresh();
        router.replace("/account");
      } else {
        setDone(true); // Same message whether or not the email was new (AUTHN-REG-005).
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <>
      <h1>Create account</h1>
      {done ? (
        <p data-testid="register-done">
          Check your inbox. If this address can be used, we have sent a link to finish setting up
          your account.
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <label>
            Email{" "}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <small>At least 8 characters. A few unrelated words work well.</small>
          </label>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} type="submit">
            Create account
          </button>
        </form>
      )}
    </>
  );
}
