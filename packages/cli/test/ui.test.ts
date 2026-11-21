import { describe, expect, it } from "vitest";
import { banner, box, colorEnabled, groupFiles, step, visibleWidth } from "../src/ui.js";

describe("colorEnabled", () => {
  it("is off for pipes, NO_COLOR and dumb terminals, on for a terminal", () => {
    expect(colorEnabled({}, false)).toBe(false);
    expect(colorEnabled({}, undefined)).toBe(false);
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({ TERM: "dumb" }, true)).toBe(false);
    expect(colorEnabled({ TERM: "xterm-256color" }, true)).toBe(true);
  });

  it("lets FORCE_COLOR switch it on, but NO_COLOR still wins", () => {
    expect(colorEnabled({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: "0" }, false)).toBe(false);
    expect(colorEnabled({ FORCE_COLOR: "1", NO_COLOR: "1" }, true)).toBe(false);
  });
});

describe("plain output (tests and pipes run without a terminal)", () => {
  it("prints a one-line banner, a text step heading and an unframed box", () => {
    expect(banner("1.2.3")).toBe("SelfAuth 1.2.3");
    expect(step(2, 4, "Database")).toBe("Step 2 of 4: Database");
    expect(box(["a", "b"], "Title")).toBe("Title\na\nb");
  });
});

describe("groupFiles", () => {
  it("summarizes folders and lists root files", () => {
    const lines = groupFiles(["app/a.py", "app/b.py", "tests/t.py", "README.md"]).map((l) =>
      // eslint-disable-next-line no-control-regex -- strip colour codes if a terminal forced them
      l.replace(/\x1b\[[0-9;]*m/g, ""),
    );
    expect(lines).toEqual(["+ app/   2 files", "+ tests/ 1 file", "+ README.md"]);
  });
});

describe("visibleWidth", () => {
  it("ignores colour codes", () => {
    expect(visibleWidth("\x1b[1mhello\x1b[22m")).toBe(5);
  });
});
