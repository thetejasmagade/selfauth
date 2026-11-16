import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  caseFileSchema,
  verificationFileSchema,
  type ConformanceCase,
  type VerificationEntry,
} from "./schema.js";

export const CASES_DIR = fileURLToPath(new URL("../cases/", import.meta.url));
export const VERIFICATION_FILE = fileURLToPath(new URL("../verification.json", import.meta.url));

export interface LoadedCase extends ConformanceCase {
  /** File the case was loaded from (basename). */
  file: string;
}

/** Load and validate every `cases/*.json` file. Throws on schema violations. */
export async function loadCases(dir: string = CASES_DIR): Promise<LoadedCase[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const loaded: LoadedCase[] = [];
  for (const file of files) {
    const raw: unknown = JSON.parse(await readFile(join(dir, file), "utf8"));
    const parsed = caseFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${file}: invalid conformance case file\n${parsed.error.message}`);
    }
    loaded.push(...parsed.data.cases.map((c) => ({ ...c, file })));
  }
  return loaded;
}

/** Load and validate `verification.json`. */
export async function loadVerification(
  file: string = VERIFICATION_FILE,
): Promise<VerificationEntry[]> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  return verificationFileSchema.parse(raw).entries;
}
