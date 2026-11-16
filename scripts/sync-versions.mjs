/* global console, process */
/* eslint-disable no-console -- release script output */
// After `changeset version`: copies the new CLI version into the places that
// must match it, i.e. the skill's metadata.version and the manual templates
// (whose manifests record templateVersion). Run by `pnpm version-packages`,
// after a build.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(repo, "packages/cli/package.json"), "utf8")).version;

const skill = join(repo, "skills/selfauth/SKILL.md");
const text = readFileSync(skill, "utf8");
const updated = text.replace(/^( {2}version: )"[^"]*"$/m, `$1"${version}"`);
if (updated === text && !text.includes(`version: "${version}"`))
  throw new Error("SKILL.md metadata.version not found");
writeFileSync(skill, updated);
console.log(`skill metadata.version → ${version}`);

execFileSync(process.execPath, [join(repo, "scripts/sync-templates.mjs")], { stdio: "inherit" });
