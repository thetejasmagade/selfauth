import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseRequirements, type Requirement } from "./requirements.js";

/** Normative specification documents, in reading order. */
export const SPEC_FILES = [
  "AUTHENTICATION_SPEC.md",
  "AUTHORIZATION_SPEC.md",
  "SECURITY_REQUIREMENTS.md",
  "DATA_MODEL.md",
  "ERRORS.md",
  "CONFIGURATION_SPEC.md",
  "CONFORMANCE.md",
  "OPTIONAL_CAPABILITIES.md",
] as const;

/** Absolute path of the bundled `specs/` directory. */
export const SPEC_DIR = fileURLToPath(new URL("../specs/", import.meta.url));

export async function readSpecFile(name: (typeof SPEC_FILES)[number]): Promise<string> {
  return readFile(new URL(`../specs/${name}`, import.meta.url), "utf8");
}

/** Parse every requirement defined in the bundled specification. */
export async function loadRequirements(): Promise<Requirement[]> {
  const all = await Promise.all(
    SPEC_FILES.map(async (name) => parseRequirements(await readSpecFile(name), name)),
  );
  return all.flat();
}
