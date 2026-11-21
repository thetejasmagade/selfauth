import { createInterface, emitKeypressEvents, type Key } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** Thrown when the person presses Ctrl-C or closes the input during a question. */
export class PromptCancelled extends Error {
  override name = "PromptCancelled";
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A few words shown after the label. */
  hint?: string;
}

export interface TextOptions {
  /** Used when the answer is empty; shown in parentheses. */
  default?: string;
  /** Returns a message when the answer is not acceptable; the question is then asked again. */
  validate?: (answer: string) => string | null | Promise<string | null>;
}

/** The questions `selfauth init` asks. Tests supply their own implementation. */
export interface Prompter {
  /** Optional: prints a "Step n of m" heading before a question (terminals only). */
  section?(index: number, total: number, title: string): void;
  select<T extends string>(question: string, choices: Choice<T>[], initial: T): Promise<T>;
  text(question: string, options?: TextOptions): Promise<string>;
  confirm(question: string, initial?: boolean): Promise<boolean>;
}

type Input = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
type Output = Writable & { isTTY?: boolean };

/**
 * Terminal prompts without a dependency: an arrow-key menu (or 1-9, or j/k), text questions that
 * are asked again on a bad answer, and yes/no. Output stays readable when it is not a terminal
 * (no cursor movement, no colour).
 */
export function createPrompter(
  input: Input = process.stdin,
  output: Output = process.stdout,
): Prompter {
  const tty = Boolean(output.isTTY);
  const dim = (text: string) => (tty ? `\x1b[2m${text}\x1b[22m` : text);
  const bold = (text: string) => (tty ? `\x1b[1m${text}\x1b[22m` : text);
  const green = (text: string) => (tty ? `\x1b[32m${text}\x1b[39m` : text);
  const cyan = (text: string) => (tty ? `\x1b[36m${text}\x1b[39m` : text);

  function select<T extends string>(
    question: string,
    choices: Choice<T>[],
    initial: T,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let index = Math.max(
        0,
        choices.findIndex((c) => c.value === initial),
      );
      let drawn = 0;
      const lines = () => [
        `${green("?")} ${bold(question)} ${dim("(↑/↓ and Enter, or a number)")}`,
        ...choices.map((c, i) => {
          const line = `${i === index ? green("❯") : " "} ${i + 1}. ${c.label}${c.hint ? `  ${dim(c.hint)}` : ""}`;
          return i === index ? bold(line) : line;
        }),
      ];
      const erase = () => {
        if (tty && drawn) output.write(`\x1b[${drawn}A\x1b[0J`);
      };
      const render = () => {
        erase();
        const text = lines();
        output.write(`${text.join("\n")}\n`);
        drawn = text.length;
      };
      const done = (finish: () => void) => {
        input.off("keypress", onKey);
        input.setRawMode?.(false);
        input.pause();
        finish();
      };
      const onKey = (sequence: string | undefined, key: Key | undefined) => {
        if (!key) return;
        if ((key.ctrl && (key.name === "c" || key.name === "d")) || key.name === "escape") {
          erase();
          return done(() => reject(new PromptCancelled()));
        }
        if (key.name === "up" || key.name === "k") {
          index = (index - 1 + choices.length) % choices.length;
          return render();
        }
        if (key.name === "down" || key.name === "j" || key.name === "tab") {
          index = (index + 1) % choices.length;
          return render();
        }
        const digit = Number(sequence);
        if (Number.isInteger(digit) && digit >= 1 && digit <= choices.length) {
          index = digit - 1;
          return render();
        }
        if (key.name === "return" || key.name === "enter") {
          erase();
          const chosen = choices[index]!;
          output.write(`${green("✔")} ${bold(question)} ${chosen.label}\n`);
          return done(() => resolve(chosen.value));
        }
      };
      emitKeypressEvents(input);
      input.setRawMode?.(true);
      input.resume();
      input.on("keypress", onKey);
      render();
    });
  }

  async function line(prompt: string): Promise<string> {
    const rl = createInterface({ input, output });
    try {
      return await new Promise<string>((resolve, reject) => {
        rl.once("close", () => reject(new PromptCancelled()));
        rl.once("SIGINT", () => reject(new PromptCancelled()));
        rl.question(prompt, resolve);
      });
    } finally {
      rl.close();
    }
  }

  async function text(question: string, options: TextOptions = {}): Promise<string> {
    const fallback = options.default ?? "";
    for (;;) {
      const raw = await line(
        `${green("?")} ${bold(question)}${fallback ? ` ${dim(`(${fallback})`)}` : ""} `,
      );
      const answer = raw.trim() || fallback;
      const problem = options.validate ? await options.validate(answer) : null;
      if (problem === null) return answer;
      output.write(`  ✗ ${problem}\n`);
    }
  }

  async function confirm(question: string, initial = true): Promise<boolean> {
    for (;;) {
      const raw = (
        await line(`${green("?")} ${bold(question)} ${dim(initial ? "(Y/n)" : "(y/N)")} `)
      )
        .trim()
        .toLowerCase();
      if (raw === "") return initial;
      if (/^y(es)?$/.test(raw)) return true;
      if (/^n(o)?$/.test(raw)) return false;
      output.write("  ✗ Please answer y or n.\n");
    }
  }

  function section(index: number, total: number, title: string): void {
    if (tty) output.write(`\n${cyan(`${index}/${total}`)} ${bold(title)}\n`);
  }

  return { select, text, confirm, section };
}
