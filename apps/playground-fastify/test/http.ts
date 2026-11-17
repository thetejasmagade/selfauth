import type { FastifyInstance } from "fastify";

/**
 * A small `request(app).post(path).set(...).send(...)` helper over Fastify's `inject`, so tests
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

class PendingRequest implements PromiseLike<TestResponse> {
  private readonly headers: Record<string, string> = {};
  private payload: string | object | undefined;

  private readonly app: FastifyInstance;
  private readonly method: Method;
  private readonly url: string;

  constructor(app: FastifyInstance, method: Method, url: string) {
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
    const res = await this.app.inject({
      method: this.method,
      url: this.url,
      headers: this.headers,
      ...(this.payload !== undefined ? { payload: this.payload as string } : {}),
    });
    const headers: TestResponse["headers"] = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = v as string;
    const cookie = res.headers["set-cookie"];
    if (cookie !== undefined) headers["set-cookie"] = Array.isArray(cookie) ? cookie : [cookie];
    let body: unknown = {};
    if (String(res.headers["content-type"] ?? "").includes("json") && res.body) {
      body = JSON.parse(res.body);
    }
    return { status: res.statusCode, headers, text: res.body, body };
  }

  then<R1 = TestResponse, R2 = never>(
    onfulfilled?: ((value: TestResponse) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function request(app: FastifyInstance) {
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
