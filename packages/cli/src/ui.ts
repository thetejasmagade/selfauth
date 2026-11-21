/**
 * Terminal look and feel without a dependency: colour, a banner, boxes and a grouped file list.
 * Everything falls back to plain text when output is not a terminal, when NO_COLOR is set, or in
 * CI-style pipes, so logs, tests and scripts see exactly the plain messages.
 */

/** Whether to colour output: a terminal, NO_COLOR unset, and not TERM=dumb. FORCE_COLOR overrides. */
export function colorEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean | undefined = process.stdout.isTTY,
): boolean {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "0") return true;
  return Boolean(isTTY) && env["TERM"] !== "dumb";
}

const wrap = (open: number, close: number) => (text: string) =>
  colorEnabled() ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);

// eslint-disable-next-line no-control-regex -- stripping the colour codes written above
const ANSI = /\x1b\[[0-9;]*m/g;

/** The printed width of `text`, ignoring colour codes. */
export const visibleWidth = (text: string): number => text.replace(ANSI, "").length;

/** True when we are talking to a person at a terminal (not a pipe, a file or CI). */
export const interactive = (): boolean => colorEnabled();

/** The startup banner: a shield with the name and one line of what the tool does. */
export function banner(version: string): string {
  if (!colorEnabled()) return `SelfAuth ${version}`;
  return [
    "",
    `  ${cyan("╭─────╮")}`,
    `  ${cyan("│")} ${bold(green("✔"))} ${cyan("│")}   ${bold("SelfAuth")} ${dim(`v${version}`)}`,
    `  ${cyan("╰──┬──╯")}   ${dim("Authentication that lives in your repo.")}`,
    `  ${cyan("   ╵")}`,
    "",
  ].join("\n");
}

/** A rounded box around `lines`, with an optional title in the top edge. Plain text when no colour. */
export function box(lines: string[], title = ""): string {
  if (!colorEnabled()) return [title, ...lines].filter((l) => l !== "").join("\n");
  const width = Math.max(visibleWidth(title) + 2, ...lines.map(visibleWidth)) + 2;
  const top = title
    ? `╭─ ${bold(title)} ${"─".repeat(Math.max(0, width - visibleWidth(title) - 3))}╮`
    : `╭${"─".repeat(width)}╮`;
  const body = lines.map((l) => `│ ${l}${" ".repeat(width - visibleWidth(l) - 1)}│`);
  return [
    dim(top),
    ...body.map((l) => dim(l[0]!) + l.slice(1, -1) + dim(l.at(-1)!)),
    dim(`╰${"─".repeat(width)}╯`),
  ].join("\n");
}

/** A numbered step heading, for example "Step 2 of 5 · Database". */
export function step(index: number, total: number, title: string): string {
  return colorEnabled()
    ? `${dim(`Step ${index} of ${total} ·`)} ${bold(title)}`
    : `Step ${index} of ${total}: ${title}`;
}

/**
 * Summarizes a list of file paths by top-level folder, for example `app/  34 files`. Files at the
 * root are listed by name. Used on a terminal, where printing 100 paths is noise; `--dry-run`
 * and pipes still get every path.
 */
export function groupFiles(paths: string[]): string[] {
  const folders = new Map<string, number>();
  const root: string[] = [];
  for (const path of paths) {
    const slash = path.indexOf("/");
    if (slash === -1) root.push(path);
    else {
      const folder = path.slice(0, slash + 1);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
  }
  const width = Math.max(0, ...[...folders.keys()].map((f) => f.length));
  return [
    ...[...folders].map(
      ([folder, count]) =>
        `${green("+")} ${cyan(folder.padEnd(width))} ${dim(`${count} file${count === 1 ? "" : "s"}`)}`,
    ),
    ...root.map((file) => `${green("+")} ${file}`),
  ];
}

/** Highlights a command in "next steps": the part before a `#` comment is bold, the comment dim. */
export function command(line: string): string {
  const hash = line.indexOf("   #");
  if (hash === -1) return `${dim("$")} ${bold(line)}`;
  return `${dim("$")} ${bold(line.slice(0, hash))}${dim(line.slice(hash))}`;
}
