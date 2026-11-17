/* global console, process */
/* eslint-disable no-console -- build script output */
// Copies the normative specifications and the user guides into the skill's
// references/ so an installed skill (outside this repository) carries them and can
// answer questions from them. `--check` fails if the copies are stale; CI runs it
// through the skills test suite.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const specs = join(root, "packages", "spec", "specs");
const docs = join(root, "docs");
const out = join(root, "skills", "selfauth", "references");

/** Spec file → reference file. Specs not listed stay in the repository. */
export const REFERENCES = {
  "AUTHENTICATION_SPEC.md": "authentication-spec.md",
  "AUTHORIZATION_SPEC.md": "authorization-spec.md",
  "SECURITY_REQUIREMENTS.md": "security-rules.md",
  "CONFIGURATION_SPEC.md": "configuration.md",
  "ERRORS.md": "errors.md",
};

/**
 * User guides (docs/ → references/guides/, same layout). Maintainer-only pages (releasing),
 * the index and the ADRs stay in the repository.
 */
export const GUIDES = [
  "manual-integration.md",
  "existing-projects.md",
  "frontend-deployment.md",
  "customization.md",
  "database.md",
  "upgrading.md",
  "data-retention.md",
  "conformance.md",
  "conformance-fastify.md",
  "security-review.md",
  "api/README.md",
  "api/http.md",
  "api/server.md",
  "api/client.md",
];

/** Every generated reference, as paths relative to references/. */
export const GENERATED = [...Object.values(REFERENCES), ...GUIDES.map((g) => `guides/${g}`)];

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

/**
 * A guide for the skill: links to other guides and to specifications stay links (re-pointed
 * inside references/); anything else in the repository becomes a plain path, because the
 * installed skill has no repository next to it.
 */
export function renderGuide(guide, text) {
  const fromDir = posix.dirname(`guides/${guide}`);
  const linked = text.replace(
    /\[([^\]]+)\]\(([^)#\s]+)(#[^)]*)?\)/g,
    (all, label, target, hash) => {
      if (/^[a-z]+:/i.test(target)) return all; // absolute URL
      const resolved = posix.normalize(posix.join(posix.dirname(`docs/${guide}`), target));
      if (resolved.startsWith("docs/") && GUIDES.includes(resolved.slice("docs/".length))) {
        return `[${label}](${posix.relative(fromDir, `guides/${resolved.slice("docs/".length)}`)}${hash ?? ""})`;
      }
      const spec = /^packages\/spec\/specs\/(.+\.md)$/.exec(resolved)?.[1];
      if (spec && REFERENCES[spec]) {
        return `[${label}](${posix.relative(fromDir, REFERENCES[spec])}${hash ?? ""})`;
      }
      const plain = label.replaceAll("`", "");
      if (plain === target || plain === resolved)
        return `\`${resolved}\` (in the SelfAuth repository)`;
      return `${label} (\`${resolved}\` in the SelfAuth repository)`;
    },
  );
  return (
    `<!-- Generated from docs/${guide} by skills/scripts/sync-references.mjs. Do not edit; edit the guide. -->\n\n` +
    linked
  );
}

export function expected() {
  return [
    ...Object.entries(REFERENCES).map(([spec, ref]) => ({
      path: join(out, ref),
      content: render(spec, readFileSync(join(specs, spec), "utf8")),
    })),
    ...GUIDES.map((guide) => ({
      path: join(out, "guides", guide),
      content: renderGuide(guide, readFileSync(join(docs, guide), "utf8")),
    })),
  ];
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
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`wrote ${path}`);
    }
  }
  if (stale) {
    console.error("Run `pnpm --filter @selfauth/skills sync` to update the skill references.");
    process.exit(1);
  }
}
