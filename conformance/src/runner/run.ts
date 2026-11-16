import { isDeepStrictEqual } from "node:util";
import { parseConfig, type SelfAuthConfig } from "@selfauth/spec";
import type { ConformanceCase, Expectation, Step } from "../schema.js";
import { checkAssertions, resolvePath, type View } from "./assertions.js";
import type { Driver, DriverFactory, HttpRequest, HttpResponse } from "./driver.js";

/** Base configuration every case starts from before applying `case.config`. */
export const BASE_CONFIG = {
  adapter: { backend: "express", database: "postgresql", orm: "prisma" },
} as const;

export const APP_BASE_URL = "https://app.example.test";
const HARNESS = "/__conformance";

interface Client {
  cookies: Map<string, string>;
  csrfToken?: string;
}

interface StepResult {
  outcome: "success" | "error";
  code?: string;
  view: View;
  /** Comparable form for `indistinguishableFrom`. */
  comparable?: unknown;
  sessionCreated?: boolean;
}

export class ConformanceFailure extends Error {
  override name = "ConformanceFailure";
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const existing = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing)
        ? deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** Normalizes Dates and other values the way a JSON API would expose them. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface SetCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
}

function parseSetCookie(header: string): SetCookie {
  const [pair = "", ...attrs] = header.split(";").map((p) => p.trim());
  const eq = pair.indexOf("=");
  const attributes: Record<string, string | true> = {};
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    if (i < 0) attributes[attr.toLowerCase()] = true;
    else attributes[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1);
  }
  return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)), attributes };
}

function isClearing(c: SetCookie): boolean {
  return c.value === "" || c.attributes["max-age"] === "0";
}

/** Runs one conformance case; throws ConformanceFailure describing the first failed step. */
export async function runCase(
  testCase: ConformanceCase,
  createDriver: DriverFactory,
): Promise<void> {
  const config: SelfAuthConfig = parseConfig(deepMerge(BASE_CONFIG, testCase.config ?? {}));
  const driver = await createDriver({
    config,
    environment: testCase.environment ?? "development",
    given: testCase.given,
    appBaseUrl: APP_BASE_URL,
  });
  try {
    await new Runner(testCase, config, driver).run();
  } finally {
    await driver.close?.();
  }
}

class Runner {
  private readonly clients = new Map<string, Client>();
  private readonly saved = new Map<string, unknown>();
  private readonly cookieName: string;
  private readonly csrfHeader: string;
  private readonly base: string;

  constructor(
    private readonly testCase: ConformanceCase,
    private readonly config: SelfAuthConfig,
    private readonly driver: Driver,
  ) {
    this.cookieName = config.authentication.sessions.cookie.name;
    this.csrfHeader = config.http.csrf.headerName.toLowerCase();
    this.base = config.http.basePath;
  }

  async run(): Promise<void> {
    for (const [index, step] of this.testCase.steps.entries()) {
      const label = `${this.testCase.id} step ${index + 1} (${step.op}${step.note ? `: ${step.note}` : ""})`;
      let result: StepResult;
      try {
        result = await this.execute(step);
      } catch (error) {
        throw new ConformanceFailure(`${label}: ${(error as Error).message}`);
      }
      const failures = this.verify(step.expect, result);
      if (failures.length > 0) {
        throw new ConformanceFailure(
          `${label}:\n  - ${failures.join("\n  - ")}\n  view: ${JSON.stringify(result.view).slice(0, 600)}`,
        );
      }
      if (step.save) this.saved.set(step.save, result);
    }
  }

  private client(name = "default"): Client {
    let client = this.clients.get(name);
    if (!client) {
      client = { cookies: new Map() };
      this.clients.set(name, client);
    }
    return client;
  }

  /** Replaces `"$name.path"` strings with saved results, fixtures, or `$config` values. */
  private resolve<T>(value: T): T {
    if (typeof value === "string" && value.startsWith("$")) {
      const [name = "", ...rest] = value.slice(1).split(".");
      const path = rest.join(".");
      let root: unknown;
      if (name === "config") {
        root = {
          appBaseUrl: APP_BASE_URL,
          sessionCookieName: this.cookieName,
          csrfHeaderName: this.config.http.csrf.headerName,
        };
      } else if (this.saved.has(name)) {
        root = (this.saved.get(name) as StepResult).view;
      } else if (name in this.driver.fixtures) {
        root = this.driver.fixtures[name];
      } else {
        throw new Error(`unresolved reference ${value}`);
      }
      return (path ? resolvePath(root, path) : root) as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.resolve(v)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.resolve(v)])) as T;
    }
    return value;
  }

  private verify(expect: Expectation | undefined, result: StepResult): string[] {
    if (!expect) return [];
    const failures: string[] = [];
    if (result.outcome !== expect.outcome) {
      failures.push(
        `expected ${expect.outcome}${expect.code ? ` ${expect.code}` : ""}, got ${result.outcome}${result.code ? ` ${result.code}` : ""}`,
      );
    }
    if (expect.code && result.code !== expect.code)
      failures.push(`expected code ${expect.code}, got ${result.code}`);
    if (expect.codeOneOf && !expect.codeOneOf.includes(result.code as never)) {
      failures.push(`expected one of ${expect.codeOneOf.join(", ")}, got ${result.code}`);
    }
    if (expect.sessionCreated !== undefined && result.sessionCreated !== expect.sessionCreated) {
      failures.push(
        `expected sessionCreated=${expect.sessionCreated}, got ${result.sessionCreated}`,
      );
    }
    if (expect.successCount !== undefined && result.view["successCount"] !== expect.successCount) {
      failures.push(
        `expected ${expect.successCount} successes, got ${String(result.view["successCount"])}`,
      );
    }
    if (expect.indistinguishableFrom) {
      const other = this.saved.get(expect.indistinguishableFrom) as StepResult | undefined;
      if (!other || !isDeepStrictEqual(other.comparable, result.comparable)) {
        failures.push(
          `response differs from '${expect.indistinguishableFrom}':\n    ${JSON.stringify(other?.comparable)}\n    ${JSON.stringify(result.comparable)}`,
        );
      }
    }
    if (expect.assert) failures.push(...checkAssertions(result.view, this.resolve(expect.assert)));
    return failures;
  }

  private ok(view: View): StepResult {
    return { outcome: "success", view };
  }

  private async execute(step: Step): Promise<StepResult> {
    const input = this.resolve(step.input ?? {}) as Record<string, unknown>;
    const { driver } = this;
    switch (step.op) {
      case "advanceClock":
        await driver.advanceClock(Number(input["minutes"]) * 60_000);
        return this.ok({});
      case "readLastEmail": {
        const mail = await driver.lastEmail(String(input["to"]));
        return this.ok(
          mail
            ? { ...mail, none: false, hasToken: Boolean(mail.token) }
            : { none: true, hasToken: false },
        );
      }
      case "inspectStorage":
        return this.ok(
          this.records(plain(await driver.inspectStorage(String(input["entity"]))), input["where"]),
        );
      case "inspectEvents": {
        const type = String(input["type"] ?? "*");
        const events = plain(await driver.events()).filter(
          (e) => type === "*" || e["type"] === type,
        );
        return this.ok(this.records(events, input["where"]));
      }
      case "inspectLogs":
        return this.ok({ lines: await driver.logs() });
      case "mutateStorage":
        await driver.mutateStorage(
          String(input["entity"]),
          (input["where"] ?? {}) as Record<string, unknown>,
          (input["set"] ?? {}) as Record<string, unknown>,
        );
        return this.ok({});
      case "concurrent": {
        const steps = (step.input?.["steps"] ?? []) as Step[];
        const results = await Promise.all(steps.map((s) => this.execute(s)));
        return this.ok({ successCount: results.filter((r) => r.outcome === "success").length });
      }
      case "rawRequest":
        return this.raw(step, input);
      default:
        return this.http(step.as, this.operationRequest(step.op, input), {});
    }
  }

  private records(records: Record<string, unknown>[], where: unknown): View {
    const filters = (where ?? {}) as Record<string, unknown>;
    const matching = records.filter((r) =>
      Object.entries(filters).every(([k, v]) => isDeepStrictEqual(r[k] ?? null, v)),
    );
    return {
      count: matching.length,
      first: matching[0],
      last: matching.at(-1),
      records: matching,
      ids: matching.map((r) => r["id"]),
    };
  }

  /** Maps a spec operation to the HTTP binding (AUTHENTICATION_SPEC §11). */
  private operationRequest(
    op: string,
    input: Record<string, unknown>,
  ): HttpRequest & { query?: Record<string, string> } {
    const b = this.base;
    const req = (method: string, path: string, body?: unknown): HttpRequest => ({
      method,
      path,
      headers: {},
      body,
    });
    const { user, ...rest } = input;
    switch (op) {
      case "register":
        return req("POST", `${b}/register`, input);
      case "login":
        return req("POST", `${b}/login`, input);
      case "logout":
        return req("POST", `${b}/logout`);
      case "logoutAll":
        return req("POST", `${b}/logout-all`);
      case "getCurrentUser":
        return req("GET", `${b}/me`);
      case "listSessions":
        return req("GET", `${b}/sessions`);
      case "revokeSession":
        return req("DELETE", `${b}/sessions/${encodeURIComponent(String(input["id"]))}`);
      case "requestEmailVerification":
        return req("POST", `${b}/email/verification`, input);
      case "verifyEmail":
        return req("POST", `${b}/email/verify`, input);
      case "changePassword":
        return req("POST", `${b}/password/change`, input);
      case "requestPasswordReset":
        return req("POST", `${b}/password/reset-request`, input);
      case "resetPassword":
        return req("POST", `${b}/password/reset`, input);
      case "deleteAccount":
        return req("POST", `${b}/account/delete`, input);
      case "setAccountState":
        return req("POST", `${b}/admin/users/${encodeURIComponent(String(user))}/state`, rest);
      case "assignRole":
        return req("POST", `${b}/admin/users/${encodeURIComponent(String(user))}/roles`, rest);
      case "removeRole":
        return req(
          "DELETE",
          `${b}/admin/users/${encodeURIComponent(String(user))}/roles/${encodeURIComponent(String(input["role"]))}`,
        );
      case "callProtected": {
        const resource = input["resource"] as { type: string; id: string } | undefined;
        const permission = encodeURIComponent(String(input["permission"] ?? ""));
        const path =
          input["route"] === "unconfigured"
            ? `${HARNESS}/unconfigured`
            : resource
              ? `${HARNESS}/resource/${permission}/${encodeURIComponent(resource.type)}/${encodeURIComponent(resource.id)}`
              : `${HARNESS}/permission/${permission}`;
        const query = input["query"] as Record<string, string> | undefined;
        return {
          ...req(
            "POST",
            query ? `${path}?${new URLSearchParams(query)}` : path,
            input["body"] ?? {},
          ),
          headers: (input["headers"] as Record<string, string>) ?? {},
        };
      }
      case "listOwned":
        return req("GET", `${HARNESS}/list/${encodeURIComponent(String(input["type"]))}`);
      case "driverFaultRoute":
        return req("GET", `${HARNESS}/fault`);
      default:
        throw new Error(`operation '${op}' has no HTTP mapping`);
    }
  }

  private async raw(step: Step, input: Record<string, unknown>): Promise<StepResult> {
    const client = this.client(step.as);
    const plant = input["setCookie"] as { name: string; value: string } | undefined;
    if (plant) client.cookies.set(plant.name, plant.value);
    if (!input["operation"]) return this.ok({});

    const operation = String(input["operation"]);
    const request = this.operationRequest(
      operation,
      (input["body"] ?? {}) as Record<string, unknown>,
    );
    if (input["method"]) request.method = String(input["method"]);
    if (input["body"] !== undefined) request.body = input["body"];
    if (input["bodySizeBytes"] !== undefined) {
      request.body = JSON.stringify({ padding: "x".repeat(Number(input["bodySizeBytes"])) });
    }
    return this.http(step.as, request, {
      headers: input["headers"] as Record<string, string> | undefined,
      omitHeaders: input["omitHeaders"] as string[] | undefined,
      cookie: input["cookie"] as string | undefined,
      csrfToken: input["csrfToken"] as string | undefined,
      omitCsrfToken: input["omitCsrfToken"] === true,
    });
  }

  private async http(
    clientName: string | undefined,
    request: HttpRequest,
    overrides: {
      headers?: Record<string, string> | undefined;
      omitHeaders?: string[] | undefined;
      cookie?: string | undefined;
      csrfToken?: string | undefined;
      omitCsrfToken?: boolean;
    },
  ): Promise<StepResult> {
    const client = this.client(clientName);
    // Defaults model a same-origin browser request from this client.
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "selfauth-conformance/0.1",
      "sec-fetch-site": "same-origin",
      [this.csrfHeader]: client.csrfToken ?? "1",
    };
    const jar =
      overrides.cookie !== undefined
        ? new Map([[this.cookieName, overrides.cookie]])
        : client.cookies;
    if (jar.size > 0)
      headers["cookie"] = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    for (const [k, v] of Object.entries({ ...request.headers, ...overrides.headers }))
      headers[k.toLowerCase()] = v;
    if (overrides.csrfToken !== undefined) headers[this.csrfHeader] = overrides.csrfToken;
    if (overrides.omitCsrfToken) delete headers[this.csrfHeader];
    for (const h of overrides.omitHeaders ?? []) delete headers[h.toLowerCase()];

    const response = await this.driver.request({ ...request, headers });
    return this.toResult(client, response, overrides.cookie === undefined);
  }

  private toResult(client: Client, response: HttpResponse, updateJar: boolean): StepResult {
    const setCookies = ((response.headers["set-cookie"] as string[] | undefined) ?? []).map(
      parseSetCookie,
    );
    const session = setCookies.findLast((c) => c.name === this.cookieName);
    const sessionCreated = session !== undefined && !isClearing(session);
    if (updateJar && session) {
      if (isClearing(session)) client.cookies.delete(this.cookieName);
      else client.cookies.set(this.cookieName, session.value);
    }
    const body = response.body as Record<string, unknown> | null;
    const csrfToken =
      typeof body?.["csrfToken"] === "string" ? (body["csrfToken"] as string) : undefined;
    if (csrfToken && updateJar) client.csrfToken = csrfToken;
    if (session && isClearing(session) && updateJar) delete client.csrfToken;

    const header: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers))
      header[k] = Array.isArray(v) ? v.join(", ") : v;
    const code = (body?.["error"] as { code?: string } | undefined)?.code;

    const view: View = {
      status: response.status,
      body,
      header,
      cookieValue: sessionCreated ? session.value : undefined,
      sessionCookieValue: sessionCreated ? session.value : client.cookies.get(this.cookieName),
      cookieCleared: session !== undefined && isClearing(session),
      csrfToken,
      cookie: session
        ? {
            name: session.name,
            httpOnly: session.attributes["httponly"] === true,
            secure: session.attributes["secure"] === true,
            sameSite: session.attributes["samesite"] ?? null,
            path: session.attributes["path"] ?? null,
            domain: session.attributes["domain"] ?? null,
            maxAge:
              session.attributes["max-age"] !== undefined
                ? Number(session.attributes["max-age"])
                : null,
          }
        : undefined,
    };
    if (Array.isArray(body?.["ids"])) {
      view["ids"] = body["ids"];
      view["driver"] = { queryFiltered: this.driver.lastListQueryFiltered() };
    }

    // Request IDs and dates legitimately differ between otherwise identical responses.
    const comparableBody = plain(body);
    if (comparableBody && typeof comparableBody === "object") {
      delete (comparableBody["error"] as Record<string, unknown> | undefined)?.["requestId"];
    }
    const comparableHeaders = Object.fromEntries(
      Object.entries(header).filter(([k]) => !["date", "x-request-id", "etag"].includes(k)),
    );
    return {
      outcome: response.status < 400 ? "success" : "error",
      ...(code ? { code } : {}),
      view,
      comparable: { status: response.status, body: comparableBody, headers: comparableHeaders },
      sessionCreated,
    };
  }
}
