import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin topology (recommended): the browser talks only to this origin; /auth and /api are
 * forwarded to the backend, so the session cookie stays SameSite=Lax and no CORS is needed. See
 * docs/frontend-deployment.md. The backend's address is read when a request arrives, so one build
 * can run against any backend (SELFAUTH_API_TARGET).
 *
 * The backend sees this server, not the visitor, as its client, so the visitor's address travels in
 * X-Forwarded-For. It is worked out here and sent as the only entry, so whatever a visitor wrote to
 * the left of it never reaches the backend: SELFAUTH_PROXY_HOPS is how many proxies sit in front of
 * this server (default 1: a hosting platform or a reverse proxy), and the address is the entry that
 * many from the right. With 0 (nothing in front) the header is untrusted and dropped. Set the
 * backend's `http.trustProxy` to 1 (Gin: the address of this server) to read it.
 */
export function visitorAddress(forwarded: string | null, hops: number): string | null {
  if (hops < 1) return null;
  const entries = (forwarded ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const address = entries[Math.max(0, entries.length - hops)] ?? "";
  return isIP(address) === 0 ? null : address;
}

export function proxy(request: NextRequest) {
  const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
  const parsed = Number(process.env["SELFAUTH_PROXY_HOPS"] ?? "1");
  const hops = Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
  const headers = new Headers(request.headers);
  const address = visitorAddress(request.headers.get("x-forwarded-for"), hops);
  if (address) headers.set("x-forwarded-for", address);
  else headers.delete("x-forwarded-for");
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, target), { request: { headers } });
}

export const config = { matcher: ["/auth/:path*", "/api/:path*"] };
