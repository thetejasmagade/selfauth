"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { describeError, safeRedirect, useAuth } from "../../auth-client/index.ts";

export function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.store.login(email, password);
      // Only same-origin paths are accepted from the URL (SEC-REDIRECT-001).
      router.replace(safeRedirect(params.get("redirect"), "/account"));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <>
      <h1>Sign in</h1>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Email{" "}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password{" "}
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy} type="submit">
          Sign in
        </button>
      </form>
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        No account? <Link href="/register">Create one</Link>
      </p>
    </>
  );
}
