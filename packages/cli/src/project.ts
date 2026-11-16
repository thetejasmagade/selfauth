import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST_FILE, readManifest, type Manifest } from "@selfauth/migration";
import { parseConfig, type SelfAuthConfig } from "@selfauth/spec";
import { sha256 } from "./plan.js";

export interface FileDrift {
  modified: string[];
  missing: string[];
  unchanged: number;
}

export async function loadManifest(dir: string): Promise<Manifest | null> {
  const path = join(dir, MANIFEST_FILE);
  return existsSync(path) ? readManifest(path) : null;
}

/** Imports the project's src/selfauth.config.ts (Node ≥ 22.18 runs TypeScript directly) and validates it. */
export async function loadConfig(dir: string): Promise<{ config?: SelfAuthConfig; errors: string[] }> {
  const path = join(dir, "src", "selfauth.config.ts");
  if (!existsSync(path)) return { errors: ["src/selfauth.config.ts not found"] };
  try {
    const mod = (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as { config?: unknown };
    return { config: parseConfig(mod.config), errors: [] };
  } catch (error) {
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    return {
      errors: issues
        ? issues.map((i) => `config ${i.path.join(".")}: ${i.message}`)
        : [`could not load src/selfauth.config.ts: ${(error as Error).message}`],
    };
  }
}

/** Compares generated files with their recorded hashes (ADR 0004: ownership is metadata, not proof). */
export async function fileDrift(dir: string, manifest: Manifest): Promise<FileDrift> {
  const drift: FileDrift = { modified: [], missing: [], unchanged: 0 };
  for (const f of manifest.files ?? []) {
    if (f.path === MANIFEST_FILE) continue;
    const path = join(dir, f.path);
    if (!existsSync(path)) drift.missing.push(f.path);
    else if (sha256(await readFile(path, "utf8")) !== f.sha256) drift.modified.push(f.path);
    else drift.unchanged += 1;
  }
  return drift;
}

export function readEnvFile(dir: string, name: string): Promise<Record<string, string>> {
  const path = join(dir, name);
  if (!existsSync(path)) return Promise.resolve({});
  return readFile(path, "utf8").then((text) =>
    Object.fromEntries(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    ),
  );
}
