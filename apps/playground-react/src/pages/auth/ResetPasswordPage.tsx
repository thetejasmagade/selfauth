import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { describeError, takeTokenFromFragment, useAuth } from "../../auth/index.ts";

export function ResetPasswordPage() {
  const auth = useAuth();
  // Kept in memory only; removed from the URL immediately (SEC-TOKEN-005).
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const taken = useRef(false);

  useEffect(() => {
    // Read once: StrictMode re-runs effects in development, and reading strips the fragment.
    if (taken.current) return;
    taken.current = true;
    setToken(takeTokenFromFragment());
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError("");
    try {
      await auth.client.resetPassword({ token, newPassword: password });
      setToken(null);
      setDone(true);
      auth.store.markSignedOut(); // all sessions were revoked (AUTHN-RESET-010)
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPassword("");
    }
  }

  return (
    <>
      <h1>Choose a new password</h1>
      {done ? (
        <p data-testid="reset-done">
          Your password was changed and every device was signed out.{" "}
          <Link to="/login">Sign in</Link>
        </p>
      ) : token ? (
        <form onSubmit={(e) => void submit(e)}>
          <label>
            New password{" "}
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit">Change password</button>
        </form>
      ) : token === null ? (
        <p role="alert">
          This link is invalid or has expired. Request a new one.{" "}
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      ) : null}
    </>
  );
}
