"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { describeError, useAuth, type SessionSummary } from "../auth-client/index.ts";

export function AccountScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadSessions = useCallback(
    async () => setSessions(await auth.client.listSessions()),
    [auth.client],
  );
  useEffect(() => {
    loadSessions().catch((e: unknown) => setError(describeError(e)));
  }, [loadSessions]);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      await auth.client.changePassword({ currentPassword, newPassword });
      setMessage("Password changed. Your other devices were signed out.");
      await Promise.all([auth.store.refresh(), loadSessions()]);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setCurrentPassword("");
      setNewPassword("");
    }
  }

  async function revoke(id: string) {
    await auth.client.revokeSession(id);
    await loadSessions();
  }

  async function logoutEverywhere() {
    await auth.store.logoutAll();
    router.push("/login");
  }

  return (
    <>
      <h1>Account</h1>
      <section>
        <p>
          <strong>{auth.user?.email}</strong>
          <br />
          Roles: {auth.user?.roles.join(", ") || "none"}
        </p>
      </section>
      <section>
        <h2>Change password</h2>
        <form onSubmit={(e) => void changePassword(e)}>
          <label>
            Current password{" "}
            <input
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password{" "}
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <button type="submit">Change password</button>
        </form>
      </section>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
      <section>
        <h2>Signed-in devices</h2>
        <ul data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.id}>
              {s.userAgent ?? "Unknown device"} — since {new Date(s.createdAt).toLocaleString()}{" "}
              {s.current ? (
                <strong>(this device)</strong>
              ) : (
                <button onClick={() => void revoke(s.id)}>Sign out</button>
              )}
            </li>
          ))}
        </ul>
        <button data-testid="logout-all" onClick={() => void logoutEverywhere()}>
          Sign out everywhere
        </button>
      </section>
    </>
  );
}
