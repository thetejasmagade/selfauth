/* global console, process */
/* eslint-disable no-console -- build script output */
// Copies the normative specifications into the skill's references/ so an
// installed skill (outside this repository) carries them. `--check` fails if
// the copies are stale; CI runs it through the skills test suite.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const specs = join(root, "packages", "spec", "specs");
const out = join(root, "skills", "selfauth", "references");

/** Spec file → reference file. Specs not listed stay in the repository. */
export const REFERENCES = {
  "AUTHENTICATION_SPEC.md": "authentication-spec.md",
  "AUTHORIZATION_SPEC.md": "authorization-spec.md",
  "SECURITY_REQUIREMENTS.md": "security-rules.md",
  "CONFIGURATION_SPEC.md": "configuration.md",
  "ERRORS.md": "errors.md",
};

export function render(specFile, text) {
  const linked = text.replace(
    /\[([^\]]+)\]\(([^)#\s]+)(#[^)]*)?\)/g,
    (all, label, target, hash) => {
      if (/^[a-z]+:/i.test(target)) return all; // absolute URL
      const mapped = REFERENCES[target];
      if (mapped) return `[${label}](${mapped}${hash ?? ""})`;
      return `${label} (\`packages/spec/specs/${target}\` in the SelfAuth repository)`;
    },
  );
  return (
    `<!-- Generated from packages/spec/specs/${specFile} by skills/scripts/sync-references.mjs. Do not edit; edit the spec. -->\n\n` +
    linked
  );
}

export function expected() {
  return Object.entries(REFERENCES).map(([spec, ref]) => ({
    path: join(out, ref),
    content: render(spec, readFileSync(join(specs, spec), "utf8")),
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { path, content } of expected()) {
    let current = null;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // missing
    }
    if (current === content) continue;
    if (check) {
      console.error(`stale: ${path}`);
      stale++;
    } else {
      writeFileSync(path, content);
      console.log(`wrote ${path}`);
    }
  }
  if (stale) {
    console.error("Run `pnpm --filter @selfauth/skills sync` to update the skill references.");
    process.exit(1);
  }
}
