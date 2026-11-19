import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, info, ok, say, warn } from "./output.js";

/**
 * Where each agent discovers project skills (all use the Agent Skills SKILL.md format).
 * Cursor also reads .claude/skills, so one location can serve several agents.
 */
export const AGENT_SKILL_DIRS = {
  claude: ".claude/skills/selfauth",
  codex: ".agents/skills/selfauth",
  cursor: ".cursor/skills/selfauth",
} as const;
export type Agent = keyof typeof AGENT_SKILL_DIRS;

const BUNDLED = fileURLToPath(new URL("../skill/selfauth/", import.meta.url));
const REPOSITORY = fileURLToPath(new URL("../../../../skills/selfauth/", import.meta.url));

/** The skill shipped with this CLI (bundled), or the repository copy during development. */
export function skillRoot(): string {
  return existsSync(join(BUNDLED, "SKILL.md")) ? BUNDLED : REPOSITORY;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out.sort();
}

/** Skill files as { relative path → content }. */
export async function skillFiles(root = skillRoot()): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const f of await walk(root))
    files.set(relative(root, f).split("\\").join("/"), await readFile(f, "utf8"));
  return files;
}

export interface SkillInstallPlan {
  agent: Agent;
  target: string;
  create: string[];
  update: string[];
  unchanged: string[];
}

export async function planSkillInstall(dir: string, agents: Agent[]): Promise<SkillInstallPlan[]> {
  const files = await skillFiles();
  const plans: SkillInstallPlan[] = [];
  for (const agent of agents) {
    const target = AGENT_SKILL_DIRS[agent];
    const plan: SkillInstallPlan = { agent, target, create: [], update: [], unchanged: [] };
    for (const [rel, content] of files) {
      const path = join(dir, target, rel);
      if (!existsSync(path)) plan.create.push(rel);
      else if ((await readFile(path, "utf8")) === content) plan.unchanged.push(rel);
      else plan.update.push(rel);
    }
    plans.push(plan);
  }
  return plans;
}

export interface SkillOptions {
  agent?: string;
  dryRun?: boolean;
  update?: boolean;
  /** Install into the user's home folder, so every project gets the skill. */
  global?: boolean;
}

/**
 * `selfauth skill install [dir]`: copy the `selfauth` agent skill into the project, or with
 * `--global` into the user's home folder (`~/.claude/skills/…`, `~/.agents/skills/…`,
 * `~/.cursor/skills/…`), where each agent finds user-level skills.
 */
export async function skillInstall(
  dirArg: string | undefined,
  opts: SkillOptions,
): Promise<number> {
  if (opts.global && dirArg !== undefined) {
    fail("--global installs into your home folder; don't pass a project folder as well.");
    return 1;
  }
  const dir = opts.global ? homedir() : resolve(dirArg ?? ".");
  const requested = (opts.agent ?? "claude").split(",").map((a) => a.trim());
  const agents = (requested.includes("all") ? Object.keys(AGENT_SKILL_DIRS) : requested) as Agent[];
  const unknown = agents.filter((a) => !(a in AGENT_SKILL_DIRS));
  if (unknown.length) {
    fail(
      `Unknown agent '${unknown.join(", ")}'. Use: ${Object.keys(AGENT_SKILL_DIRS).join(", ")}, all.`,
    );
    return 1;
  }
  say(`SelfAuth skill install → ${dir}${opts.global ? "  (global: every project)" : ""}`);
  const plans = await planSkillInstall(dir, agents);
  const files = await skillFiles();
  let blocked = false;
  for (const p of plans) {
    say(`\n${p.agent}: ${p.target}/`);
    p.create.forEach((f) => say(`  + ${f}`));
    p.update.forEach((f) => say(`  ~ ${f}${opts.update ? "" : "  (differs; kept)"}`));
    if (p.unchanged.length) info(`${p.unchanged.length} file(s) already up to date`);
    if (p.update.length && !opts.update) blocked = true;
  }
  if (blocked) {
    warn("Some skill files differ from this CLI's version. Re-run with --update to replace them.");
  }
  if (opts.dryRun) {
    say("\nDry run: nothing written.");
    return 0;
  }
  for (const p of plans) {
    for (const rel of [...p.create, ...(opts.update ? p.update : [])]) {
      const path = join(dir, p.target, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, files.get(rel)!);
    }
  }
  ok(
    opts.global
      ? "Skill installed for your user account. Your agent will use it in every project; restart it to pick it up."
      : "Skill installed. Ask your agent to add authentication; it will use the `selfauth` skill.",
  );
  if (agents.includes("cursor") && agents.includes("claude"))
    info("Cursor also reads .claude/skills; one of the two copies is enough for Cursor.");
  return blocked ? 1 : 0;
}
