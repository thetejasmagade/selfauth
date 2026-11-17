import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { describeError, safeRedirect, useAuth } from "../../auth/index.ts";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
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
      void navigate(safeRedirect(params.get("redirect"), "/notes"), { replace: true });
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
        <Link to="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        No account? <Link to="/register">Create one</Link>
      </p>
    </>
  );
}
