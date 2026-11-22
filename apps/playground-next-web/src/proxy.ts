import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin topology (recommended): the browser talks only to this origin; /auth and /api are
 * forwarded to the backend, so the session cookie stays SameSite=Lax and no CORS is needed. See
 * docs/frontend-deployment.md. The backend's address is read when a request arrives, so one build
 * can run against any backend (SELFAUTH_API_TARGET).
 */
export function proxy(request: NextRequest) {
  const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, target));
}

export const config = { matcher: ["/auth/:path*", "/api/:path*"] };
