import type { TestRouter } from "./router.ts";

/**
 * A small `request(app).post(path).set(...).send(...)` helper over the route handlers, so tests
 * read like HTTP and need no network port. The response has `status`, `headers` (set-cookie is
 * always an array), `text` and `body` (parsed JSON, or `{}`).
 */
export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined> & { "set-cookie"?: string[] };
  text: string;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

const ORIGIN = "https://app.example.test";

class PendingRequest implements PromiseLike<TestResponse> {
  private readonly headers: Record<string, string> = {};
  private payload: string | object | undefined;

  private readonly app: TestRouter;
  private readonly method: Method;
  private readonly url: string;

  constructor(app: TestRouter, method: Method, url: string) {
    this.app = app;
    this.method = method;
    this.url = url;
  }

  set(name: string | Record<string, string>, value?: string): this {
    if (typeof name === "string") this.headers[name] = value ?? "";
    else Object.assign(this.headers, name);
    return this;
  }

  send(body: string | object): this {
    this.payload = body;
    return this;
  }

  private async run(): Promise<TestResponse> {
    const headers = new Headers(this.headers);
    let body: string | undefined;
    if (this.payload !== undefined) {
      if (typeof this.payload === "string") body = this.payload;
      else {
        body = JSON.stringify(this.payload);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
    }
    const res = await this.app.fetch(
      new Request(`${ORIGIN}${this.url}`, {
        method: this.method,
        headers,
        ...(body !== undefined && this.method !== "GET" ? { body } : {}),
      }),
    );
    const out: TestResponse["headers"] = {};
    res.headers.forEach((value, name) => {
      if (name !== "set-cookie") out[name] = value;
    });
    const cookies = res.headers.getSetCookie();
    if (cookies.length > 0) out["set-cookie"] = cookies;
    const text = await res.text();
    let parsed: unknown = {};
    if ((res.headers.get("content-type") ?? "").includes("json") && text) parsed = JSON.parse(text);
    return { status: res.status, headers: out, text, body: parsed };
  }

  then<R1 = TestResponse, R2 = never>(
    onfulfilled?: ((value: TestResponse) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function request(app: TestRouter) {
  const make = (method: Method) => (url: string) => new PendingRequest(app, method, url);
  return {
    get: make("GET"),
    post: make("POST"),
    put: make("PUT"),
    patch: make("PATCH"),
    delete: make("DELETE"),
    options: make("OPTIONS"),
  };
}
