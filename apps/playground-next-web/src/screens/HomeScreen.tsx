"use client";

import Link from "next/link";
import { useAuth } from "../auth-client/index.ts";

export function HomeScreen() {
  const auth = useAuth();
  return (
    <>
      <h1>SelfAuth Next.js playground</h1>
      {auth.isAuthenticated ? (
        <p>
          Signed in. Go to your <Link href="/notes">notes</Link>.
        </p>
      ) : (
        <p>
          <Link href="/login">Sign in</Link> or <Link href="/register">create an account</Link>.
        </p>
      )}
    </>
  );
}
