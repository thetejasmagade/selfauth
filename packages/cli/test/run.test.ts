import { describe, expect, it } from "vitest";
import { quoteForWindows, runCommand } from "../src/run.js";

describe("runCommand", () => {
  it("quotes arguments for cmd.exe so ^ and & stay literal", () => {
    expect(quoteForWindows("pkg@^1.2.3")).toBe('"pkg@^1.2.3"');
    expect(quoteForWindows("a&b")).toBe('"a&b"');
    expect(quoteForWindows('say "hi"')).toBe('"say ""hi"""');
  });

  it("reports a command that cannot start, with the reason", () => {
    const result = runCommand(["selfauth-no-such-command"], process.cwd(), "linux");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not start");
  });

  it("reports a non-zero exit", () => {
    const result = runCommand([process.execPath, "-e", "process.exit(3)"], process.cwd(), "linux");
    expect(result).toEqual({ ok: false, reason: `${process.execPath} exited with code 3` });
  });

  it("succeeds when the command does", () => {
    expect(runCommand([process.execPath, "-e", ""], process.cwd(), "linux")).toEqual({ ok: true });
  });
});
