/**
 * Startup configuration, validated before the app starts (SEC-SECRET-003).
 * Fails fast: an invalid environment prevents the server from starting.
 */
export interface Env {
  nodeEnv: "development" | "test" | "production";
  port: number;
  appBaseUrl: URL;
}

export class EnvError extends Error {
  override name = "EnvError";
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const problems: string[] = [];

  const nodeEnv = source["NODE_ENV"] ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    problems.push(`NODE_ENV must be development, test or production (got "${nodeEnv}")`);
  }

  const port = Number(source["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push("PORT must be an integer between 1 and 65535");
  }

  let appBaseUrl: URL | undefined;
  const rawBaseUrl = source["SELFAUTH_APP_BASE_URL"];
  if (!rawBaseUrl) {
    problems.push("SELFAUTH_APP_BASE_URL is required (used to build email links)");
  } else {
    try {
      appBaseUrl = new URL(rawBaseUrl);
      if (appBaseUrl.protocol !== "https:" && appBaseUrl.protocol !== "http:") {
        problems.push("SELFAUTH_APP_BASE_URL must be an http(s) URL");
      } else if (nodeEnv === "production" && appBaseUrl.protocol !== "https:") {
        problems.push("SELFAUTH_APP_BASE_URL must use https in production (SEC-HTTP-002)");
      }
    } catch {
      problems.push("SELFAUTH_APP_BASE_URL is not a valid URL");
    }
  }

  if (problems.length > 0 || !appBaseUrl) {
    throw new EnvError(`Invalid environment:\n  - ${problems.join("\n  - ")}`);
  }
  return { nodeEnv: nodeEnv as Env["nodeEnv"], port, appBaseUrl };
}
