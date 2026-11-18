import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { DATABASE_INFO, type Database } from "./templates.js";

/**
 * Where `DATABASE_URL` comes from for `selfauth db`: the environment, or the project's `.env`.
 * The CLI reads `.env` itself and hands the value to Prisma, instead of relying on
 * `prisma.config.ts` to load it, and says exactly what it found when there is none.
 */
export interface DatabaseEnv {
  /** The connection string to use, when there is one. */
  url: string | undefined;
  /** Where it came from. */
  source: "environment" | ".env" | null;
  /** What the lookup found, for the message when there is no usable value. */
  environment: "not set" | "set but empty" | "set";
  envFile: "missing" | "has no DATABASE_URL" | "DATABASE_URL is empty" | "ok";
  path: string;
}

export async function readDatabaseEnv(
  dir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DatabaseEnv> {
  const path = join(dir, ".env");
  let fromFile: string | undefined;
  let envFile: DatabaseEnv["envFile"] = "missing";
  try {
    // A byte-order mark (some Windows editors write one) would otherwise stick to the first key.
    const text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
    fromFile = parseEnv(text)["DATABASE_URL"];
    envFile =
      fromFile === undefined
        ? "has no DATABASE_URL"
        : fromFile.trim() === ""
          ? "DATABASE_URL is empty"
          : "ok";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const fromEnv = environment["DATABASE_URL"];
  const env: DatabaseEnv["environment"] =
    fromEnv === undefined ? "not set" : fromEnv.trim() === "" ? "set but empty" : "set";
  // An empty variable in the environment must not hide the value in .env.
  if (env === "set")
    return { url: fromEnv, source: "environment", environment: env, envFile, path };
  if (envFile === "ok") return { url: fromFile, source: ".env", environment: env, envFile, path };
  return { url: undefined, source: null, environment: env, envFile, path };
}

/** The value `.env.example` ships with for PostgreSQL: a placeholder, not a database. */
export const EXAMPLE_DATABASE_URL = DATABASE_INFO.postgresql.urlExample;

/** Problems with a connection string that Prisma would report badly (or not at all). */
export function databaseUrlProblems(url: string, database: Database = "postgresql"): string[] {
  const problems: string[] = [];
  const info = DATABASE_INFO[database];
  if (!info.urlPrefixes.some((prefix) => url.startsWith(prefix))) problems.push(info.urlHint);
  if (url.trim() === info.urlExample && database === "postgresql")
    problems.push("it is still the placeholder from .env.example; put your real connection string");
  if (/^["'].*["']$/.test(url.trim()))
    problems.push("it is wrapped in quotes that are part of the value");
  return problems;
}
