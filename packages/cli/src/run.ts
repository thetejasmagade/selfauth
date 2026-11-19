import { spawnSync } from "node:child_process";

/** Quotes one argument for cmd.exe, where `^`, `&`, `|` and spaces are special outside quotes. */
export function quoteForWindows(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

export interface RunResult {
  ok: boolean;
  /** Why the command could not start or exited non-zero. */
  reason?: string;
}

/**
 * Runs a package-manager command in `cwd`, showing its output. On Windows `npm`, `pnpm` and `yarn` are
 * `.cmd` scripts, which Node cannot start without a shell (the call fails before the tool runs), so
 * there the command goes through the shell with every argument quoted.
 */
export function runCommand(
  cmd: string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): RunResult {
  const [file, ...args] = cmd;
  const result =
    platform === "win32"
      ? spawnSync(file!, args.map(quoteForWindows), { cwd, stdio: "inherit", shell: true })
      : spawnSync(file!, args, { cwd, stdio: "inherit" });
  if (result.error)
    return { ok: false, reason: `could not start "${file}": ${result.error.message}` };
  if (result.status !== 0)
    return { ok: false, reason: `${file} exited with code ${result.status}` };
  return { ok: true };
}
