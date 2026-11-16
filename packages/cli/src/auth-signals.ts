import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/** A place in the application's own source that looks like authentication code. */
export interface AuthSignal {
  file: string;
  line: number;
  kind: string;
  text: string;
}

/**
 * Heuristics for hand-written authentication (plan §7: "detect existing authentication").
 * Package names alone miss code that uses `jsonwebtoken` through a wrapper or rolls its own
 * sessions, so agents get file:line evidence to show the developer before changing anything.
 */
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "passport strategy", re: /\bpassport\.(use|authenticate|session)\s*\(/ },
  { kind: "JWT sign/verify", re: /\bjwt\.(sign|verify|decode)\s*\(/ },
  {
    kind: "password hashing",
    re: /\b(bcrypt|bcryptjs|argon2|scrypt)\b[\w.]*\.(hash|compare|verify)\w*\s*\(/,
  },
  { kind: "server session", re: /\breq\.session\b/ },
  { kind: "bearer token", re: /Bearer\s/ },
  {
    kind: "auth route",
    re: /\.(get|post|put|all|use)\s*\(\s*["'`][^"'`]*\/(login|logout|signin|sign-in|signup|sign-up|register|auth)\b/i,
  },
];

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "generated",
  "selfauth", // SelfAuth's own files (src/selfauth/ after `selfauth add`)
]);
const MAX_FILES = 2000;
const MAX_BYTES = 512 * 1024;
const MAX_SIGNALS = 50;

async function sourceFiles(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) await sourceFiles(full, out);
    } else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
}

/** Files SelfAuth generated, from the manifest (they are SelfAuth's auth, not the app's). */
async function generatedFiles(dir: string): Promise<Set<string>> {
  const manifest = join(dir, "selfauth.manifest.json");
  if (!existsSync(manifest)) return new Set();
  try {
    const m = JSON.parse(await readFile(manifest, "utf8")) as { files?: { path: string }[] };
    return new Set((m.files ?? []).map((f) => f.path));
  } catch {
    return new Set();
  }
}

/** Scans the project's own source (not dependencies, builds or SelfAuth's files). Reads only. */
export async function findAuthSignals(dir: string): Promise<AuthSignal[]> {
  const files: string[] = [];
  await sourceFiles(dir, files).catch(() => {});
  const generated = await generatedFiles(dir);
  const signals: AuthSignal[] = [];
  for (const file of files) {
    if (generated.has(relative(dir, file).split("\\").join("/"))) continue;
    if ((await stat(file)).size > MAX_BYTES) continue;
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((text, i) => {
      for (const { kind, re } of PATTERNS) {
        if (signals.length < MAX_SIGNALS && re.test(text)) {
          signals.push({
            file: relative(dir, file).split("\\").join("/"),
            line: i + 1,
            kind,
            text: text.trim().slice(0, 160),
          });
          break;
        }
      }
    });
  }
  return signals;
}
