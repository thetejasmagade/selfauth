"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth-client/index.ts";

export function Header() {
  const auth = useAuth();
  const router = useRouter();
  const logout = async () => {
    await auth.store.logout();
    router.push("/login");
  };
  return (
    <header>
      <Link href="/">
        <strong>SelfAuth</strong>
      </Link>
      {auth.isAuthenticated && (
        <Link href="/account">Account</Link>
      )}
      {auth.status === "loading" ? (
        <span>Loading…</span>
      ) : auth.isAuthenticated ? (
        <>
          <span data-testid="current-email">{auth.user?.email}</span>
          <button data-testid="logout" onClick={() => void logout()}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create account</Link>
        </>
      )}
    </header>
  );
}
