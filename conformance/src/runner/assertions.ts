import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/**
 * Assertion vocabulary used by `expect.assert` in conformance cases
 * (CONFORMANCE.md). Each assertion key is either a special key handled here or
 * a dotted path into the step's result view, compared with a matcher.
 */
export type View = Record<string, unknown>;

const show = (v: unknown) => JSON.stringify(v);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Value matchers: `{ sha256Of }`, `{ notNull }`, `{ contains }`, … or deep equality. */
function match(actual: unknown, expected: unknown): string | null {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const entries = Object.entries(expected);
    if (entries.length === 1) {
      const [op, arg] = entries[0]!;
      switch (op) {
        case "sha256Of":
          return typeof actual === "string" && actual === sha256(String(arg))
            ? null
            : `expected SHA-256 of the given value, got ${show(actual)}`;
        case "notNull":
          return (actual !== null && actual !== undefined) === arg
            ? null
            : `expected notNull=${show(arg)}, got ${show(actual)}`;
        case "present":
          return (actual !== undefined) === arg
            ? null
            : `expected present=${show(arg)}, got ${show(actual)}`;
        case "contains":
          return typeof actual === "string" && actual.includes(String(arg))
            ? null
            : `expected ${show(actual)} to contain ${show(arg)}`;
        case "notEqual":
          return !isDeepStrictEqual(actual, arg) ? null : `expected value other than ${show(arg)}`;
        case "sameMembers": {
          const a = Array.isArray(actual) ? [...actual].map(String).sort() : null;
          const e = [...(arg as unknown[])].map(String).sort();
          return a && isDeepStrictEqual(a, e)
            ? null
            : `expected members ${show(e)}, got ${show(actual)}`;
        }
        case "oneOf": {
          const allowed = arg as unknown[];
          const values = Array.isArray(actual) ? actual : [actual];
          const bad = values.filter((v) => !allowed.some((a) => isDeepStrictEqual(a, v)));
          return values.length > 0 && bad.length === 0
            ? null
            : `expected each of ${show(actual)} in ${show(allowed)}`;
        }
      }
    }
  }
  const normalizedActual = actual === undefined && expected === null ? null : actual;
  return isDeepStrictEqual(normalizedActual, expected)
    ? null
    : `expected ${show(expected)}, got ${show(actual)}`;
}

/** Resolves a dotted path; `name[]` maps the rest of the path over an array. */
export function resolvePath(root: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.endsWith("[]")) {
      const list = (current as Record<string, unknown> | undefined)?.[part.slice(0, -2)];
      if (!Array.isArray(list)) return undefined;
      const rest = parts.slice(i + 1).join(".");
      return rest ? list.map((item) => resolvePath(item, rest)) : list;
    }
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function hasKeyDeep(value: unknown, keys: ReadonlySet<string>): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = hasKeyDeep(v, keys);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (keys.has(k)) return k;
      const found = hasKeyDeep(v, keys);
      if (found) return found;
    }
  }
  return undefined;
}

function parsePhc(
  hash: unknown,
): { algorithm: string; m: number; t: number; p: number; saltBytes: number } | null {
  if (typeof hash !== "string") return null;
  const m = /^\$([a-z0-9]+)\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$/.exec(hash);
  if (!m) return null;
  return {
    algorithm: m[1]!,
    m: Number(m[2]),
    t: Number(m[3]),
    p: Number(m[4]),
    saltBytes: Buffer.from(m[5]!, "base64").length,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns failure messages (empty when every assertion holds). */
export function checkAssertions(view: View, assertions: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const fail = (key: string, message: string) => failures.push(`assert ${key}: ${message}`);
  const body = view["body"];
  const bodyText = JSON.stringify(body ?? null);

  for (const [key, expected] of Object.entries(assertions)) {
    const list = (Array.isArray(expected) ? expected : [expected]) as unknown[];
    switch (key) {
      case "bodyHasPath":
        for (const p of list)
          if (resolvePath(body, String(p)) === undefined) fail(key, `missing ${p}`);
        continue;
      case "bodyLacksPath":
        for (const p of list)
          if (resolvePath(body, String(p)) !== undefined) fail(key, `unexpected ${p}`);
        continue;
      case "bodyExcludesKeys": {
        const found = hasKeyDeep(body, new Set(list.map(String)));
        if (found) fail(key, `body contains key '${found}'`);
        continue;
      }
      case "bodyExcludesCookieValue": {
        const value = view["sessionCookieValue"];
        if (
          expected === true &&
          typeof value === "string" &&
          value.length > 0 &&
          bodyText.includes(value)
        ) {
          fail(key, "body contains the session token");
        }
        continue;
      }
      case "bodyExcludesPatterns":
        for (const p of list)
          if (new RegExp(String(p)).test(bodyText)) fail(key, `body matches /${p}/`);
        continue;
      case "cookieValueMinBytes": {
        const value = view["cookieValue"];
        const bytes = typeof value === "string" ? Buffer.from(value, "base64url").length : 0;
        if (bytes < Number(expected)) fail(key, `cookie value has ${bytes} bytes`);
        continue;
      }
      case "cookieMaxAgeAtMostSeconds": {
        const maxAge = resolvePath(view, "cookie.maxAge");
        if (typeof maxAge !== "number" || maxAge > Number(expected))
          fail(key, `Max-Age is ${show(maxAge)}`);
        continue;
      }
      case "cookieCleared":
        if ((view["cookieCleared"] === true) !== expected)
          fail(key, `cookieCleared=${show(view["cookieCleared"])}`);
        continue;
      case "linkStartsWith": {
        const link = view["link"];
        if (typeof link !== "string" || !link.startsWith(String(expected)))
          fail(key, `link ${show(link)}`);
        continue;
      }
      case "noOccurrenceOf": {
        const text = JSON.stringify(view["lines"] ?? view["records"] ?? view);
        for (const v of list)
          if (typeof v === "string" && v.length > 0 && text.includes(v))
            fail(key, `found ${show(v)}`);
        continue;
      }
      case "noFieldContaining": {
        const text = JSON.stringify(view["records"] ?? view);
        for (const v of list)
          if (typeof v === "string" && v.length > 0 && text.includes(v))
            fail(key, `found ${show(v)}`);
        continue;
      }
      case "countAtLeast":
        if (Number(view["count"]) < Number(expected)) fail(key, `count is ${show(view["count"])}`);
        continue;
      case "ids.opaque": {
        const ids = (view["ids"] as unknown[]) ?? [];
        const bad = ids.filter(
          (id) =>
            typeof id !== "string" || !(UUID.test(id) || (id.length >= 22 && !/^\d+$/.test(id))),
        );
        if ((bad.length === 0) !== expected) fail(key, `non-opaque ids ${show(bad)}`);
        continue;
      }
      case "ids.notSequential": {
        const ids = ((view["ids"] as unknown[]) ?? []).map(String);
        const numeric = ids.every((id) => /^\d+$/.test(id));
        const sequential =
          numeric && ids.map(Number).every((n, i, a) => i === 0 || n === a[i - 1]! + 1);
        if (!sequential !== expected) fail(key, `ids ${show(ids)}`);
        continue;
      }
    }

    if (key.endsWith(".hasNoKeys")) {
      const target = resolvePath(view, key.slice(0, -".hasNoKeys".length));
      const found = hasKeyDeep(target, new Set(list.map(String)));
      if (found) fail(key, `has key '${found}'`);
      continue;
    }
    if (key.endsWith(".hasFields")) {
      const target = resolvePath(view, key.slice(0, -".hasFields".length)) as
        Record<string, unknown> | undefined;
      for (const f of list)
        if (target?.[String(f)] === null || target?.[String(f)] === undefined)
          fail(key, `missing ${f}`);
      continue;
    }
    const phcKey = /^(.*)\.(phcAlgorithm|argon2MinParams|saltMinBytes)$/.exec(key);
    if (phcKey) {
      const phc = parsePhc(resolvePath(view, phcKey[1]!));
      if (!phc) {
        fail(key, "not a PHC string");
      } else if (phcKey[2] === "phcAlgorithm") {
        if (phc.algorithm !== expected) fail(key, `algorithm ${phc.algorithm}`);
      } else if (phcKey[2] === "saltMinBytes") {
        if (phc.saltBytes < Number(expected)) fail(key, `salt ${phc.saltBytes} bytes`);
      } else {
        const floors = list as { m: number; t: number; p: number }[];
        if (!floors.some((f) => phc.m >= f.m && phc.t >= f.t && phc.p >= f.p)) {
          fail(key, `params m=${phc.m},t=${phc.t},p=${phc.p} below every floor`);
        }
      }
      continue;
    }
    if (key.endsWith("Not")) {
      const actual = resolvePath(view, key.slice(0, -3));
      if (isDeepStrictEqual(actual, expected))
        fail(key, `expected value other than ${show(expected)}`);
      continue;
    }
    const message = match(resolvePath(view, key), expected);
    if (message) fail(key, message);
  }
  return failures;
}
