import { AuthError } from "../src/auth/core/errors.ts";
import type { Auth } from "../src/auth/index.ts";
import type { NextRouteContext, RouteHandler } from "../src/auth/next/index.ts";

type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

interface Entry {
  verb: Verb;
  segments: string[];
  handler: RouteHandler;
}

/**
 * Stands in for Next.js's file router in tests: authentication routes go to `auth.handler`
 * (the folder app/auth/[[...path]]), the routes a test adds go to the handlers it gives, and
 * everything else is the not-found handler that app/api/[[...path]] provides. No server, no
 * network port: the handlers are called with real Request objects.
 */
export class TestRouter {
  readonly #entries: Entry[] = [];
  readonly #auth: Auth;
  readonly #basePath: string[];
  readonly #notFound: RouteHandler;

  constructor(auth: Auth, basePath: string) {
    this.#auth = auth;
    this.#basePath = basePath.split("/").filter(Boolean);
    this.#notFound = auth.route(() => {
      throw new AuthError("NOT_FOUND", "Not found.");
    });
  }

  on(verb: Verb, path: string, handler: RouteHandler): this {
    this.#entries.push({ verb, segments: path.split("/").filter(Boolean), handler });
    return this;
  }
  get = (path: string, handler: RouteHandler) => this.on("GET", path, handler);
  post = (path: string, handler: RouteHandler) => this.on("POST", path, handler);

  async fetch(req: Request): Promise<Response> {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const underBase = this.#basePath.every((segment, i) => parts[i] === segment);
    if (underBase) return this.#auth.handler(req, { params: Promise.resolve({}) });
    for (const entry of this.#entries) {
      if (entry.verb !== req.method || entry.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const matches = entry.segments.every((segment, i) => {
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = parts[i]!;
          return true;
        }
        return segment === parts[i];
      });
      if (matches) {
        const ctx: NextRouteContext = { params: Promise.resolve(params) };
        return entry.handler(req, ctx);
      }
    }
    return this.#notFound(req, { params: Promise.resolve({}) });
  }
}
