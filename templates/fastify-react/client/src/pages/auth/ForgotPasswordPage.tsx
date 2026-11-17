import { useState, type FormEvent } from "react";
import { describeError, useAuth } from "../../auth/index.ts";

export function ForgotPasswordPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await auth.client.requestPasswordReset(email);
      setSent(true); // Same message for every address (AUTHN-RESET-001).
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <>
      <h1>Reset password</h1>
      {sent ? (
        <p data-testid="reset-sent">
          If an account exists for that address, we have sent a link to reset the password.
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
          {error && (
            <p role="alert">
              {error}
            </p>
          )}
          <button type="submit">Send reset link</button>
        </form>
      )}
    </>
  );
}
