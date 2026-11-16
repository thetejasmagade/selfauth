import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_VERSION, INTEGRATIONS, PLANNED, skillFiles, skillRoot } from "@selfauth/cli";
import { loadRequirements, SPEC_VERSION } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs build script without type declarations
import { expected as expectedReferences, REFERENCES } from "../scripts/sync-references.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SKILL = join(REPO, "skills", "selfauth");
const BIN = join(REPO, "packages", "cli", "dist", "bin.js");
const GENERATED = new Set(Object.values(REFERENCES as Record<string, string>));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Markdown an agent reads: the skill and the integration guides. */
const docs = [
  ...walk(SKILL),
  ...walk(join(REPO, "integrations")),
  join(REPO, "skills", "README.md"),
].filter((f) => f.endsWith(".md"));
/** Hand-written docs (generated references are checked against the spec by sync instead). */
const handWritten = docs.filter((f) => !GENERATED.has(relative(join(SKILL, "references"), f)));
const read = (f: string) => readFileSync(f, "utf8");

function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const out: Record<string, string> = {};
  let parent = "";
  for (const line of block.split("\n")) {
    const m = /^(\s*)([a-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, indent, key, value] = m as unknown as [string, string, string, string];
    if (!indent) parent = key;
    out[indent ? `${parent}.${key}` : key] = value.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

describe("SKILL.md", () => {
  const text = read(join(SKILL, "SKILL.md"));
  const meta = frontmatter(text);

  it("has valid Agent Skills frontmatter", () => {
    expect(meta["name"]).toBe("selfauth"); // must equal the directory name
    expect(meta["name"]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta["description"]!.length).toBeGreaterThan(50);
    expect(meta["description"]!.length).toBeLessThanOrEqual(1024);
    expect((meta["compatibility"] ?? "").length).toBeLessThanOrEqual(500);
    expect(meta["license"]).toBe("MIT");
  });

  it("is versioned with the CLI and the specification it describes", () => {
    expect(meta["metadata.version"]).toBe(CLI_VERSION);
    expect(meta["metadata.spec"]).toBe(SPEC_VERSION);
  });

  it("stays short enough to load (Agent Skills: under 500 lines)", () => {
    expect(text.split("\n").length).toBeLessThan(500);
  });

  it("states every agent safety rule from the plan (§7)", () => {
    for (const rule of [
      /Never hand-write security code/,
      /Never invent adapters/,
      /Never bypass the CLI/,
      /Never replace or remove existing authentication without approval/,
      /Never run destructive migrations without explicit approval/,
      /Never expose secrets/,
      /Never claim completion without passing validation/,
      /Report what is manual or unsupported/,
    ])
      expect(text).toMatch(rule);
  });
});

describe("references", () => {
  it("carry the current specification (run `pnpm --filter @selfauth/skills sync`)", () => {
    for (const { path, content } of expectedReferences() as { path: string; content: string }[])
      expect(existsSync(path) ? read(path) : "", path).toBe(content);
  });

  it("contain every file the plan's skill structure names", () => {
    for (const f of [
      "references/architecture.md",
      "references/authentication-spec.md",
      "references/authorization-spec.md",
      "references/security-rules.md",
      "references/framework-support.md",
      "references/migration-rules.md",
      "scripts/detect-project.ts",
      "scripts/validate-auth.ts",
    ])
      expect(existsSync(join(SKILL, f)), f).toBe(true);
    expect(readdirSync(join(SKILL, "examples")).length).toBeGreaterThan(0);
  });

  it("framework-support matches what the CLI can generate (`selfauth list --json`)", () => {
    const text = read(join(SKILL, "references", "framework-support.md"));
    const rows = [
      ...text.matchAll(
        /^\| (backend|database|frontend) \| `([a-z]+)` \|[^|]*\| ([^|]*) \| ([^|]*) \|$/gm,
      ),
    ].map((m) => ({
      kind: m[1],
      id: m[2],
      init: m[3]!.trim() === "✓",
      add: m[4]!.trim().startsWith("✓"),
    }));
    expect(rows).toEqual(
      INTEGRATIONS.map((i) => ({ kind: i.kind, id: i.id, init: true, add: i.add })),
    );
    for (const p of PLANNED) expect(text).toContain(p);
  });
});

describe("every reference in the skill is real", () => {
  it("cites only requirement IDs the specification defines", async () => {
    const ids = new Set((await loadRequirements()).map((r) => r.id));
    for (const file of handWritten) {
      for (const [id] of read(file).matchAll(/\b[A-Z]+(?:-[A-Z]+)+-\d{3}\b/g))
        expect(ids.has(id), `${relative(REPO, file)} cites ${id}`).toBe(true);
    }
  });

  it("links only to files and headings that exist", () => {
    const slug = (h: string) =>
      h
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s/g, "-");
    for (const file of docs) {
      for (const [, target] of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(target!)) continue;
        const [path, anchor] = target!.split("#") as [string, string | undefined];
        const dest = path ? resolve(dirname(file), path) : file;
        expect(existsSync(dest), `${relative(REPO, file)} → ${target}`).toBe(true);
        if (anchor && dest.endsWith(".md")) {
          const headings = [...read(dest).matchAll(/^#+\s+(.*)$/gm)].map((m) => slug(m[1]!));
          expect(headings, `${relative(REPO, file)} → ${target}`).toContain(anchor);
        }
      }
    }
  });

  it("uses only CLI commands and flags that exist", () => {
    const help = new Map<string, string>();
    const helpOf = (args: string[]) => {
      const key = args.join(" ");
      if (!help.has(key)) {
        const r = spawnSync(process.execPath, [BIN, ...args, "--help"], { encoding: "utf8" });
        help.set(key, r.status === 0 ? r.stdout : "");
      }
      return help.get(key)!;
    };
    const commandsOf = (h: string) =>
      new Set([...(h.split("Commands:")[1] ?? "").matchAll(/^ {2}([a-z-]+)/gm)].map((m) => m[1]!));
    const top = commandsOf(helpOf([]));
    let checked = 0;
    for (const file of handWritten) {
      const mentions = read(file).matchAll(
        /(?:npx @selfauth\/cli|(?<![\w/@.-])selfauth)[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?([^`\n]*)/g,
      );
      for (const [, cmd, sub, rest] of mentions) {
        const where = `${relative(REPO, file)}: selfauth ${cmd} ${sub ?? ""}`;
        expect(top.has(cmd!), where).toBe(true);
        // "`selfauth db …`" in prose names the command group only.
        const args = (cmd === "db" || cmd === "skill") && sub ? [cmd, sub] : [cmd!];
        if (args.length === 2) expect(commandsOf(helpOf([cmd!])).has(sub!), where).toBe(true);
        const h = helpOf(args);
        for (const [flag] of (rest ?? "").matchAll(/--[a-z][a-z-]*/g))
          expect(h, `${where} ${flag}`).toContain(flag);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("the bundled skill", () => {
  it("is the repository skill, byte for byte (what `selfauth skill install` writes)", async () => {
    expect(skillRoot()).toContain(join("dist", "skill"));
    const bundled = await skillFiles();
    const repo = await skillFiles(SKILL);
    expect([...bundled.keys()]).toEqual([...repo.keys()]);
    for (const [path, content] of repo) expect(bundled.get(path), path).toBe(content);
  });
});
