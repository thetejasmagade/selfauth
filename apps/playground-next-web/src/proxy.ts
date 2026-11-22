import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin topology (recommended): the browser talks only to this origin; /auth and /api are
 * forwarded to the backend, so the session cookie stays SameSite=Lax and no CORS is needed. See
 * docs/frontend-deployment.md. The backend's address is read when a request arrives, so one build
 * can run against any backend (SELFAUTH_API_TARGET).
 *
 * The backend sees this server, not the visitor, as its client. The visitor's address travels in
 * X-Forwarded-For (kept as it arrived, or set to the connecting address when there was none), so
 * set the backend's `http.trustProxy` to match: 1 for Express, Fastify and Flask, the address of
 * this server for Gin. Without it every visitor shares one per-address rate-limit bucket.
 */
export function proxy(request: NextRequest) {
  const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, target));
}

export const config = { matcher: ["/auth/:path*", "/api/:path*"] };
