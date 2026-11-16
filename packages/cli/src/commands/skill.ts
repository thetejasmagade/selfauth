import { existsSync } from "node:fs";
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
}

/** `selfauth skill install [dir]`: copy the `selfauth` agent skill into the project. */
export async function skillInstall(
  dirArg: string | undefined,
  opts: SkillOptions,
): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  const requested = (opts.agent ?? "claude").split(",").map((a) => a.trim());
  const agents = (requested.includes("all") ? Object.keys(AGENT_SKILL_DIRS) : requested) as Agent[];
  const unknown = agents.filter((a) => !(a in AGENT_SKILL_DIRS));
  if (unknown.length) {
    fail(
      `Unknown agent '${unknown.join(", ")}'. Use: ${Object.keys(AGENT_SKILL_DIRS).join(", ")}, all.`,
    );
    return 1;
  }
  say(`SelfAuth skill install → ${dir}`);
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
  ok("Skill installed. Ask your agent to add authentication; it will use the `selfauth` skill.");
  if (agents.includes("cursor") && agents.includes("claude"))
    info("Cursor also reads .claude/skills; one of the two copies is enough for Cursor.");
  return blocked ? 1 : 0;
}
