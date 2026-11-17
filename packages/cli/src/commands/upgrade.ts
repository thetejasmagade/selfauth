import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  applyUpgrade,
  planUpgrade,
  PROPOSAL_SUFFIX,
  type UpgradeItem,
  type UpgradePlan,
} from "../upgrade.js";
import { applyReorganize, planReorganize } from "../reorganize.js";
import { fail, info, ok, say, warn } from "./output.js";

const LABEL: Record<UpgradeItem["status"], string> = {
  update: "update  (you never edited it)",
  add: "add     (new template file)",
  conflict: `conflict (proposal → ${PROPOSAL_SUFFIX})`,
  kept: "kept    (your edit; template unchanged)",
  deleted: "deleted (you removed it; stays removed)",
  removed: "removed upstream (left in place)",
  unchanged: "unchanged",
};

function summarize(plan: UpgradePlan, showDiffs: boolean) {
  say(`Templates ${plan.fromVersion} → ${plan.toVersion}\n`);
  const shown = plan.items.filter((i) => i.status !== "unchanged");
  if (shown.length === 0) {
    ok(`All ${plan.items.length} template files are up to date.`);
    return;
  }
  for (const i of shown) {
    const line = `${LABEL[i.status]}  ${i.path}`;
    if (i.status === "conflict") warn(line);
    else info(line);
  }
  say(`\n${plan.items.filter((i) => i.status === "unchanged").length} file(s) unchanged.`);
  if (showDiffs) {
    for (const i of shown.filter((x) => x.diff)) say(`\n${i.diff}`);
  }
  if (shown.some((i) => i.status === "add" && i.path.includes("prisma/migrations/"))) {
    warn(
      "New database migrations: review them with `selfauth db plan` before `selfauth db migrate`.",
    );
  }
}

/** `selfauth diff`: what an upgrade would change, with diffs. Writes nothing. */
export async function diffCommand(dirArg: string | undefined): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  try {
    summarize(await planUpgrade(dir), true);
    return 0;
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}

/** `selfauth upgrade --reorganize`: move a flat-layout project (SelfAuth ≤ 0.3) into the grouped layout. */
async function reorganize(
  dir: string,
  options: { yes?: boolean; dryRun?: boolean },
): Promise<number> {
  let plan;
  try {
    plan = await planReorganize(dir);
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
  if (plan.problems.length) {
    plan.problems.forEach(fail);
    say("\nNothing was changed.");
    return 1;
  }
  say("Reorganize: move the app files into folders by responsibility.\n");
  for (const m of plan.moves) info(`move  ${m.from} → ${m.to}`);
  say(
    `\n${plan.rewrites.length} file(s) get updated import paths (only the paths change): ${plan.rewrites.join(", ")}`,
  );
  if (options.dryRun) {
    say("\nDry run: nothing written.");
    return 0;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      fail("Refusing to write without confirmation; pass --yes.");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "\nMove these files? Commit first so you can review the diff. (y/N) ",
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      say("Cancelled. Nothing written.");
      return 1;
    }
  }
  await applyReorganize(dir, plan);
  ok(`Moved ${plan.moves.length} file(s) and updated imports in ${plan.rewrites.length}.`);
  say("\nThen run your typecheck and tests, and `selfauth upgrade` to pick up newer templates.");
  return 0;
}

/** `selfauth upgrade`: apply safe updates; never overwrite your edits. */
export async function upgrade(
  dirArg: string | undefined,
  options: { yes?: boolean; dryRun?: boolean; reorganize?: boolean },
): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  if (options.reorganize) return reorganize(dir, options);
  let plan: UpgradePlan;
  try {
    plan = await planUpgrade(dir);
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
  summarize(plan, false);
  const actionable = plan.items.filter((i) => ["update", "add", "conflict"].includes(i.status));
  if (options.dryRun || actionable.length === 0) {
    if (options.dryRun) say("\nDry run: nothing written. Use `selfauth diff` to see the changes.");
    return 0;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      fail("Refusing to write without confirmation; pass --yes.");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("\nApply? Edited files are never overwritten. (y/N) ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      say("Cancelled. Nothing written.");
      return 1;
    }
  }
  const result = await applyUpgrade(dir, plan);
  ok(`Updated or added ${result.written.length} file(s); selfauth.manifest.json updated.`);
  if (result.proposals.length) {
    warn(
      `${result.proposals.length} conflict(s): merge each proposal into your file, then delete the proposal:`,
    );
    for (const p of result.proposals) say(`    ${p}`);
  }
  if (result.skipped.length)
    warn(
      `Skipped (changed during upgrade, or a proposal already exists): ${result.skipped.join(", ")}`,
    );
  say("\nThen run your tests and `selfauth validate`.");
  return 0;
}
