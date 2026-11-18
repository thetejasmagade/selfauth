import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/commands/init.js";
import {
  createPrompter,
  PromptCancelled,
  type Choice,
  type Prompter,
  type TextOptions,
} from "../src/prompt.js";

/** A terminal that is not a TTY: keys are written to `input`, what is shown is collected. */
function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (chunk: Buffer) => (shown += chunk.toString()));
  const waitFor = async (text: string) => {
    for (let i = 0; i < 200 && !shown.includes(text); i++)
      await new Promise((r) => setTimeout(r, 5));
    if (!shown.includes(text))
      throw new Error(`never showed ${JSON.stringify(text)}; got ${shown}`);
  };
  return { prompter: createPrompter(input, output), input, shown: () => shown, waitFor };
}

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const CTRL_C = "\x03";
const CHOICES: Choice<"a" | "b" | "c">[] = [
  { value: "a", label: "Alpha", hint: "first" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

describe("select", () => {
  it("moves with the arrow keys and returns the chosen value", async () => {
    const t = terminal();
    const answer = t.prompter.select("Pick one", CHOICES, "a");
    await t.waitFor("Pick one");
    t.input.write(DOWN);
    t.input.write(DOWN);
    t.input.write(UP);
    t.input.write(ENTER);
    expect(await answer).toBe("b");
    expect(t.shown()).toContain("✔ Pick one Beta");
  });

  it("starts on the default, wraps around, and accepts a number", async () => {
    const t = terminal();
    let answer = t.prompter.select("Pick", CHOICES, "c");
    await t.waitFor("Pick");
    t.input.write(ENTER);
    expect(await answer).toBe("c");

    answer = t.prompter.select("Again", CHOICES, "c");
    await t.waitFor("Again");
    t.input.write(DOWN); // wraps from the last to the first
    t.input.write(ENTER);
    expect(await answer).toBe("a");

    answer = t.prompter.select("Number", CHOICES, "a");
    await t.waitFor("Number");
    t.input.write("3");
    t.input.write(ENTER);
    expect(await answer).toBe("c");
  });

  it("cancels on Ctrl-C", async () => {
    const t = terminal();
    const answer = t.prompter.select("Pick", CHOICES, "a");
    await t.waitFor("Pick");
    t.input.write(CTRL_C);
    await expect(answer).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("prints no terminal control codes when the output is not a terminal", async () => {
    const t = terminal();
    const answer = t.prompter.select("Pick", CHOICES, "a");
    await t.waitFor("Pick");
    t.input.write(DOWN);
    t.input.write(ENTER);
    await answer;
    expect(t.shown()).not.toContain("\x1b");
  });
});

describe("text and confirm", () => {
  it("uses the default for an empty answer", async () => {
    const t = terminal();
    const answer = t.prompter.text("Folder", { default: "my-app" });
    await t.waitFor("(my-app)");
    t.input.write("\n");
    expect(await answer).toBe("my-app");
  });

  it("asks again, with the reason, until the answer is valid", async () => {
    const t = terminal();
    const answer = t.prompter.text("Permission", {
      validate: (a) => (a.includes(".") ? null : "needs a dot"),
    });
    await t.waitFor("Permission");
    t.input.write("orders\n");
    await t.waitFor("needs a dot");
    // A fresh question is shown; type a good answer once it is.
    await new Promise((r) => setTimeout(r, 20));
    t.input.write("orders.view\n");
    expect(await answer).toBe("orders.view");
  });

  it("confirm: Enter takes the default, n and y answer, anything else asks again", async () => {
    const t = terminal();
    let answer = t.prompter.confirm("Go?", true);
    await t.waitFor("Go?");
    t.input.write("\n");
    expect(await answer).toBe(true);

    answer = t.prompter.confirm("Really?", true);
    await t.waitFor("Really?");
    t.input.write("n\n");
    expect(await answer).toBe(false);

    answer = t.prompter.confirm("Maybe?", false);
    await t.waitFor("Maybe?");
    t.input.write("perhaps\n");
    await t.waitFor("Please answer y or n");
    await new Promise((r) => setTimeout(r, 20));
    t.input.write("yes\n");
    expect(await answer).toBe(true);
  });
});

/** Scripted answers in order; records every question. */
function scripted(answers: unknown[]) {
  const asked: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    if (!answers.length) throw new Error(`unexpected question: ${question}`);
    return answers.shift();
  };
  const prompter: Prompter = {
    select: async <T extends string>(question: string, _c: Choice<T>[], _i: T) =>
      next(question) as T,
    text: async (question: string, options?: TextOptions) => {
      const answer = next(question) as string;
      const problem = await options?.validate?.(answer);
      if (problem) throw new Error(`invalid answer to "${question}": ${problem}`);
      return answer;
    },
    confirm: async (question: string) => next(question) as boolean,
  };
  return { prompter, asked };
}

describe("selfauth init questions", () => {
  afterEach(() => vi.restoreAllMocks());

  async function run(dir: string | undefined, options: Parameters<typeof init>[1]) {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    const code = await init(dir, options);
    return { code, out: lines.join("\n") };
  }
  const empty = async () => join(await mkdtemp(join(tmpdir(), "selfauth-wizard-")), "app");

  it("asks everything no flag answered, in order, and builds the project from the answers", async () => {
    const dir = await empty();
    const { prompter, asked } = scripted([
      "fastify",
      "memory",
      "vue",
      "orders.view,orders.create",
      false, // npm install
    ]);
    const { code, out } = await run(dir, { dryRun: true, prompter });
    expect(code).toBe(0);
    expect(asked).toEqual([
      "Which backend?",
      "Which database?",
      "Which frontend?",
      "Application permissions, comma-separated (e.g. orders.view,orders.create; Enter for none)",
      "Run npm install after creating the files?",
    ]); // a dry run stops before the final confirmation
    expect(out).toContain("Fastify + in-memory store + vue in client/");
  });

  it("does not ask what a flag already answered", async () => {
    const dir = await empty();
    const { prompter, asked } = scripted(["none", "", "http://localhost:3000", false]);
    const { out } = await run(dir, {
      dryRun: true,
      prompter,
      backend: "express",
      database: "postgresql",
    });
    expect(asked[0]).toBe("Which frontend?");
    expect(asked).not.toContain("Which backend?");
    expect(asked).not.toContain("Which database?");
    // API only: the frontend address is asked, because there is no dev server to point at.
    expect(asked).toContain("Where will your frontend run? (used in email links)");
    expect(out).toContain("Express + PostgreSQL/Prisma");
  });

  it("asks for the project folder when none is given", async () => {
    const parent = await mkdtemp(join(tmpdir(), "selfauth-wizard-"));
    const { prompter, asked } = scripted([
      "demo",
      "express",
      "memory",
      "none",
      "",
      "http://localhost:5173",
      false,
    ]);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(parent);
    const { code } = await run(undefined, { dryRun: true, prompter });
    cwd.mockRestore();
    expect(code).toBe(0);
    expect(asked[0]).toBe("Project folder (. for the current folder)");
  });

  it("refuses a folder that already has a package.json, and a name with odd characters", async () => {
    const parent = await mkdtemp(join(tmpdir(), "selfauth-wizard-"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(parent, "existing"));
    await writeFile(join(parent, "existing/package.json"), "{}");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(parent);
    for (const answer of ["existing", "my app!", "../outside"]) {
      const { prompter } = scripted([answer]);
      await expect(run(undefined, { dryRun: true, prompter })).rejects.toThrow(
        /invalid answer to "Project folder/,
      );
    }
    cwd.mockRestore();
  });

  it("stops with exit code 130 and writes nothing when the person cancels", async () => {
    const dir = await empty();
    const prompter: Prompter = {
      select: async () => {
        throw new PromptCancelled();
      },
      text: async () => "",
      confirm: async () => true,
    };
    const { code, out } = await run(dir, { prompter });
    expect(code).toBe(130);
    expect(out).toContain("Cancelled. Nothing written.");
    await expect(readdir(dir)).rejects.toThrow(); // the folder was never created
  });

  it("declining the final confirmation writes nothing", async () => {
    const dir = await empty();
    const { prompter } = scripted([
      "express",
      "memory",
      "none",
      "",
      "http://localhost:5173",
      false,
      false,
    ]);
    const { code, out } = await run(dir, { prompter });
    expect(code).toBe(1);
    expect(out).toContain("Cancelled. Nothing written.");
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("rejects a bad flag before asking anything", async () => {
    const { prompter, asked } = scripted([]);
    const { code, out } = await run(await empty(), { prompter, backend: "koa" });
    expect(code).toBe(1);
    expect(out).toContain("Unsupported backend 'koa'");
    expect(asked).toEqual([]);
  });

  it("an app base URL with a newline or spaces is refused (it is written into .env)", async () => {
    for (const bad of ["http://a.test\nEVIL=1", "http://a.test b", "ftp://a.test", "not a url"]) {
      const { prompter, asked } = scripted([]);
      const { code, out } = await run(await empty(), { prompter, appBaseUrl: bad });
      expect(code, bad).toBe(1);
      expect(out, bad).toMatch(/address|web address|http/);
      expect(asked).toEqual([]);
    }
  });

  it("a bad permission flag fails before asking, with the reason", async () => {
    const { prompter, asked } = scripted([]);
    const { code, out } = await run(await empty(), { prompter, permissions: "Orders View" });
    expect(code).toBe(1);
    expect(out).toContain("invalid permission");
    expect(asked).toEqual([]);
  });
});
