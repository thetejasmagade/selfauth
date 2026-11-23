import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INTEGRATIONS } from "@selfauth/cli";
import { parseConfig, SYSTEM_ROLES } from "@selfauth/spec";
import { describe, expect, it } from "vitest";

/**
 * The skill must be able to answer what people ask. Each sample question names the entry in
 * references/questions.md that answers it; the test follows that entry to the file with the
 * detail and checks the facts are really there. A question that cannot be answered from the
 * skill fails here, and so does an answer that drifts from the code.
 */
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SKILL = join(REPO, "skills", "selfauth");
const REFS = join(SKILL, "references");
const read = (path: string) => readFileSync(path, "utf8");
const questions = read(join(REFS, "questions.md"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** The Q&A entry whose question contains `fragment`: its text and the files it links to. */
function entry(fragment: string): { text: string; files: string[] } {
  const blocks = questions.split(/\n(?=\*\*)/);
  const block = blocks.find((b) =>
    b.split("\n")[0]!.toLowerCase().includes(fragment.toLowerCase()),
  );
  expect(block, `no entry in questions.md for "${fragment}"`).toBeDefined();
  const files = [...block!.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map((m) =>
    resolve(REFS, m[1]!),
  );
  return { text: block!, files };
}

interface Sample {
  /** What a person might ask. */
  ask: string;
  /** Text identifying the answering entry in questions.md. */
  entry: string;
  /** Facts the entry or the file it links to must state. */
  facts: RegExp[];
  /** A file the entry must lead to (relative to references/). */
  leadsTo?: string;
}

const SAMPLES: Sample[] = [
  {
    ask: "What is SelfAuth?",
    entry: "What is SelfAuth",
    facts: [/code generator/i, /owns the code|developer owns/i, /nothing calls SelfAuth/i],
  },
  {
    ask: "Do I install SelfAuth as a dependency?",
    entry: "Is it a library",
    facts: [/never on `@selfauth/i],
  },
  {
    ask: "Which frameworks does it support?",
    entry: "Which stacks",
    facts: [/Express 5/, /PostgreSQL/, /Vue or React/],
    leadsTo: "framework-support.md",
  },
  {
    ask: "Does it work with NestJS?",
    entry: "NestJS, Koa",
    facts: [/Not supported/i, /never port/i],
  },
  {
    ask: "Does it work with Next.js?",
    entry: "Does it work with Next.js",
    facts: [/--backend next/, /--frontend next/, /trustProxy/, /not supported by `selfauth add`/],
    leadsTo: "guides/conformance-next.md",
  },
  {
    ask: "Can users sign in with Google?",
    entry: "OAuth, social login",
    facts: [/Not generated/i, /opaque/i],
  },
  {
    ask: "Can I run the in-memory store in production?",
    entry: "in-memory store",
    facts: [/No\./, /refuses to start/i],
  },
  {
    ask: "How do I start a new project?",
    entry: "new project",
    facts: [/selfauth init/, /--dry-run/],
  },
  {
    ask: "How do I add it to my existing Express app?",
    entry: "existing Express app",
    facts: [/selfauth add/, /never edits existing files/i],
    leadsTo: "guides/existing-projects.md",
  },
  {
    ask: "My code is in server/, not src/",
    entry: "isn't in `src/`",
    facts: [/--src server/, /tsconfig/],
    leadsTo: "project-layouts.md",
  },
  {
    ask: "How do I use it in a monorepo?",
    entry: "monorepo",
    facts: [/inside the package/i],
    leadsTo: "project-layouts.md",
  },
  {
    ask: "My frontend lives in a different repo",
    entry: "another folder or repository",
    facts: [/add-frontend/, /Vue and React/, /no pages/i],
    leadsTo: "guides/existing-projects.md",
  },
  { ask: "I use Svelte", entry: "another frontend framework", facts: [/No generator/i] },
  {
    ask: "I already have Passport auth",
    entry: "already have authentication",
    facts: [/--allow-existing-auth/, /removes\s+nothing/i],
  },
  {
    ask: "Can I use it without the CLI?",
    entry: "without the CLI",
    facts: [/templates\//],
    leadsTo: "guides/manual-integration.md",
  },
  {
    ask: "How do I protect a route?",
    entry: "protect a route",
    facts: [/requirePermission/, /requireAuth/, /AUTHZ-CORE-004/],
    leadsTo: "guides/api/server.md",
  },
  {
    ask: "How do I add a permission?",
    entry: "role or permission",
    facts: [/selfauth\.config\.ts/, /db:seed/],
    leadsTo: "guides/customization.md",
  },
  {
    ask: "How do I make the first admin?",
    entry: "first administrator",
    facts: [/db:create-admin/],
  },
  {
    ask: "How do I send emails?",
    entry: "real emails",
    facts: [/createMailer/, /refuses to start/i],
  },
  {
    ask: "How are passwords hashed?",
    entry: "passwords stored",
    facts: [/Argon2id/],
    leadsTo: "security-rules.md",
  },
  {
    ask: "How do sessions work?",
    entry: "sessions work",
    facts: [/__Host-session/, /hash/i, /revoked/i],
  },
  {
    ask: "Do I need CSRF protection?",
    entry: "CSRF",
    facts: [/X-SelfAuth-CSRF: 1/, /SEC-CSRF-004/],
    leadsTo: "guides/frontend-deployment.md",
  },
  {
    ask: "Can someone find out which emails are registered?",
    entry: "reveal whether an email",
    facts: [/Not by default/i, /SEC-ENUM-004/],
  },
  {
    ask: "Is it audited?",
    entry: "audited",
    facts: [/No independent\s+security audit/i, /self-assessed/i],
    leadsTo: "guides/conformance.md",
  },
  {
    ask: "How do migrations work?",
    entry: "migrations work",
    facts: [/db plan/, /destructive/i, /Nothing migrates at app start-up/i],
    leadsTo: "guides/database.md",
  },
  {
    ask: "Will it break my tables?",
    entry: "touch my existing tables",
    facts: [/auth_\*/],
    leadsTo: "guides/database.md",
  },
  {
    ask: "Can I roll back?",
    entry: "roll back",
    facts: [/no down\s+migrations/i],
    leadsTo: "migration-rules.md",
  },
  {
    ask: "What happens when a user deletes their account?",
    entry: "account is deleted",
    facts: [/tombstone/i],
    leadsTo: "guides/data-retention.md",
  },
  {
    ask: "What do I need for production?",
    entry: "set in production",
    facts: [/DATABASE_URL/, /https/, /HSTS/],
    leadsTo: "guides/manual-integration.md",
  },
  {
    ask: "My POSTs return CSRF_FAILED",
    entry: "CSRF_FAILED",
    facts: [/trustedOrigins/, /SELFAUTH_APP_BASE_URL/],
  },
  {
    ask: "How do I upgrade?",
    entry: "How do I upgrade",
    facts: [/selfauth diff/, /\.selfauth-new/],
    leadsTo: "guides/upgrading.md",
  },
];

describe("sample questions", () => {
  it.each(SAMPLES)("$ask", ({ entry: fragment, facts, leadsTo }) => {
    const { text, files } = entry(fragment);
    for (const file of files)
      expect(existsSync(file), `${relative(REFS, file)} is missing`).toBe(true);
    if (leadsTo) {
      expect(
        files.map((f) => relative(REFS, f)),
        `entry "${fragment}" should lead to ${leadsTo}`,
      ).toContain(leadsTo);
    }
    const haystack = [text, ...files.map(read)].join("\n");
    for (const fact of facts) expect(haystack, `${fact}`).toMatch(fact);
  });

  it("cover every part of the skill's question map", () => {
    const asked = new Set(SAMPLES.map((s) => s.entry));
    const entries = questions.split(/\n(?=\*\*)/).filter((b) => b.startsWith("**"));
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(asked.size).toBeGreaterThanOrEqual(28);
  });
});

describe("the skill's files are reachable", () => {
  it("every reference is linked from SKILL.md or questions.md, directly or through a guide", () => {
    const start = [join(SKILL, "SKILL.md"), join(REFS, "questions.md")];
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) {
      const file = queue.pop()!;
      for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        if (/^[a-z]+:/i.test(target!)) continue;
        const dest = resolve(dirname(file), target!);
        if (existsSync(dest) && !seen.has(dest)) {
          seen.add(dest);
          queue.push(dest);
        }
      }
    }
    const orphans = walk(REFS)
      .filter((f) => f.endsWith(".md") && !seen.has(f))
      .map((f) => relative(SKILL, f));
    expect(orphans).toEqual([]);
  });

  it("every user guide is named in the question map", () => {
    const guides = walk(join(REFS, "guides")).map((f) => relative(REFS, f).split("\\").join("/"));
    // The API reference is reached through SKILL.md's guide link; the others are named here.
    for (const guide of guides.filter((g) => !g.startsWith("guides/api/")))
      expect(questions, guide).toContain(`(${guide}`);
  });
});

describe("the description", () => {
  const text = read(join(SKILL, "SKILL.md"));
  const description = /^description: (.*)$/m.exec(text)![1]!;

  it("says it also answers questions, and when to use the skill", () => {
    expect(description.length).toBeLessThanOrEqual(1024);
    for (const word of [
      "login",
      "RBAC",
      "existing app",
      "monorepo",
      "upgrade",
      "questions",
      "limits",
    ])
      expect(description.toLowerCase(), word).toContain(word.toLowerCase());
  });

  it("has an Answering questions section with the rules agents need", () => {
    const section = /## Answering questions([\s\S]*?)\n## /.exec(text)?.[1] ?? "";
    for (const rule of [
      /from this skill's files, not from memory/,
      /cite the\s+requirement ID/,
      /supported now.*planned.*not supported/s,
      /isn't\s+documented/,
      /`detect-project\.ts` first/,
      /no independent security audit/,
      /change nothing until they ask/,
    ])
      expect(section).toMatch(rule);
  });
});

describe("answers that quote the product stay true", () => {
  const config = parseConfig({
    adapter: { backend: "express", database: "postgresql", orm: "prisma" },
  });

  it("defaults match what questions.md and the guides say", () => {
    expect(config.authentication.sessions.cookie.name).toBe("__Host-session");
    expect(config.authentication.emailVerification.mode).toBe("required");
    expect(config.authentication.registration.revealExistingEmail).toBe(false);
    expect(config.authentication.registration.signInAfterRegistration).toBe(false);
    expect(config.authentication.password.minLength).toBe(8);
    expect(config.http.csrf.mode).toBe("header");
    expect(questions).toContain("__Host-session");
    expect(SYSTEM_ROLES).toEqual(["admin", "user"]);
  });

  it("the supported list matches `selfauth list`", () => {
    const supported = read(join(REFS, "framework-support.md"));
    for (const i of INTEGRATIONS) expect(supported).toContain(`\`${i.id}\``);
    // What the question map calls supported is exactly what the CLI offers.
    expect(INTEGRATIONS.map((i) => i.id).sort()).toEqual(
      [
        "express",
        "fastify",
        "flask",
        "gin",
        "memory",
        "mongodb",
        "mysql",
        "next",
        "next", // a backend and a frontend
        "none",
        "postgresql",
        "react",
        "sqlite",
        "vue",
      ].sort(),
    );
  });
});
