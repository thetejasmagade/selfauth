import type { Driver, DriverFactory, HttpRequest } from "@selfauth/conformance";
import { send } from "./harness.ts";

/** Conformance driver for the Gin reference application (Go). See test/harness/main.go. */
export function ginDriver(port: number): DriverFactory {
  return async ({ config, environment, given }) => {
    const control = async (method: string, path: string, body?: unknown) => {
      const res = await send(
        port,
        method,
        `/__control${path}`,
        body === undefined ? {} : { "content-type": "application/json" },
        body === undefined ? undefined : JSON.stringify(body),
      );
      const parsed = res.text ? (JSON.parse(res.text) as unknown) : null;
      if (res.status >= 400) {
        throw new Error(`harness ${method} ${path}: ${res.status} ${res.text}`);
      }
      return parsed;
    };

    const created = (await control("POST", "/instances", { config, environment, given })) as {
      id: string;
      fixtures: Record<string, { id: string }>;
    };
    const base = `/__control/instances/${created.id}`;
    const instance = (path: string) => `/instances/${created.id}${path}`;
    let lastListFiltered: boolean | undefined;

    const driver: Driver = {
      fixtures: created.fixtures,
      async request(req: HttpRequest) {
        const method = req.method.toUpperCase();
        const hasBody = req.body !== undefined && method !== "GET" && method !== "OPTIONS";
        const body =
          !hasBody ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        const res = await send(
          port,
          method,
          `/i/${created.id}${req.path}`,
          body === undefined ? req.headers : { ...req.headers, "content-length": String(Buffer.byteLength(body)) },
          body,
        );
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) headers[k.toLowerCase()] = v;
        }
        const setCookie = res.headers["set-cookie"];
        headers["set-cookie"] = setCookie === undefined ? [] : setCookie;
        const isJson = String(res.headers["content-type"] ?? "").includes("json");
        const parsed = isJson && res.text ? (JSON.parse(res.text) as unknown) : null;
        if (/\/__conformance\/list\//.test(req.path)) {
          const state = (await control("GET", instance("/list-filtered"))) as {
            filtered: boolean | null;
          };
          lastListFiltered = state.filtered ?? undefined;
        }
        return { status: res.status, headers, body: parsed };
      },
      async advanceClock(ms) {
        await control("POST", instance("/advance"), { ms });
      },
      async lastEmail(to) {
        const mail = (await control("GET", instance(`/email?to=${encodeURIComponent(to)}`))) as {
          kind: string;
          token?: string;
          link?: string;
        } | null;
        return mail ? { kind: mail.kind, token: mail.token, link: mail.link } : null;
      },
      async inspectStorage(entity) {
        return (await control(
          "GET",
          instance(`/storage?entity=${encodeURIComponent(entity)}`),
        )) as Record<string, unknown>[];
      },
      async mutateStorage(entity, where, set) {
        await control("POST", instance("/mutate"), { entity, where, set });
      },
      async events() {
        return (await control("GET", instance("/events"))) as Record<string, unknown>[];
      },
      async logs() {
        return (await control("GET", instance("/logs"))) as string[];
      },
      lastListQueryFiltered: () => lastListFiltered,
      async close() {
        await control("DELETE", instance(""));
      },
    };
    void base;
    return driver;
  };
}
