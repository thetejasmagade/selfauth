import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { describeError, takeTokenFromFragment, useAuth } from "../auth/index.ts";

export function VerifyEmailPage() {
  const auth = useAuth();
  const [status, setStatus] = useState<"working" | "verified" | "failed">("working");
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development; a token is single-use.
    started.current = true;
    // Token is read from the fragment and removed from the URL at once (SEC-TOKEN-005).
    const token = takeTokenFromFragment();
    if (!token) {
      setStatus("failed");
      setError("This link is invalid or has expired. Request a new one.");
      return;
    }
    auth.client.verifyEmail(token).then(
      () => setStatus("verified"),
      (e: unknown) => {
        setStatus("failed");
        setError(describeError(e));
      },
    );
  }, [auth.client]);

  return (
    <>
      <h1>Verify email</h1>
      {status === "working" && <p>Verifying…</p>}
      {status === "verified" && (
        <p className="notice" data-testid="verified">
          Your email address is verified. <Link to="/login">Sign in</Link>
        </p>
      )}
      {status === "failed" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
