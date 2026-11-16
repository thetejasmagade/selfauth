// Shared by the skill scripts: finds and runs the SelfAuth CLI. No dependencies, so it runs
// with plain `node` (Node.js >= 22.18 strips the type annotations).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** $SELFAUTH_CLI (a local build) → the project's installed CLI → npx. */
export function cliCommand(projectDir: string): string[] {
  const override = process.env["SELFAUTH_CLI"];
  if (override) return [process.execPath, override];
  const local = join(projectDir, "node_modules", "@selfauth", "cli", "dist", "bin.js");
  if (existsSync(local)) return [process.execPath, local];
  return ["npx", "--yes", "@selfauth/cli"];
}

export function run(command: string[], cwd: string, timeoutMs = 600_000): Run {
  const r = spawnSync(command[0]!, command.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, FORCE_COLOR: "0" },
    shell: process.platform === "win32",
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? String(r.error) : ""),
  };
}

export function runCli(projectDir: string, args: string[]): Run {
  return run([...cliCommand(projectDir), ...args], projectDir);
}

/** Parses the JSON a `--json` command printed, or explains why it could not. */
export function parseJson<T>(r: Run, what: string): T {
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new Error(
      `${what} did not return JSON (exit ${r.status}). Is the SelfAuth CLI available? ` +
        `Set SELFAUTH_CLI to its bin.js, or install @selfauth/cli.\n${r.stderr || r.stdout}`.trim(),
    );
  }
}

export function readPackageJson(dir: string): {
  scripts?: Record<string, string>;
} | null {
  const file = join(dir, "package.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> })
    : null;
}

/** `npm run` / `pnpm run` / … for the project's package manager. */
export function runScript(dir: string, script: string): string[] {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return ["pnpm", "run", "--silent", script];
  if (existsSync(join(dir, "yarn.lock"))) return ["yarn", "run", "--silent", script];
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb")))
    return ["bun", "run", script];
  return ["npm", "run", "--silent", script];
}

export function positional(argv: string[], flagsWithValue: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (flagsWithValue.includes(a)) i++;
    else if (!a.startsWith("--")) out.push(a);
  }
  return out;
}

export function flagValues(argv: string[], flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && argv[i + 1]) out.push(argv[i + 1]!);
    else if (a.startsWith(`${flag}=`)) out.push(a.slice(flag.length + 1));
  });
  return out;
}
