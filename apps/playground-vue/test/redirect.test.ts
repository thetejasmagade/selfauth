import { describe, expect, it } from "vitest";
import { safeRedirect } from "../src/auth/index.ts";

describe("safeRedirect (SEC-REDIRECT-001)", () => {
  it.each([
    ["/notes", "/notes"],
    ["/notes?x=1#top", "/notes?x=1#top"],
    ["/a/../b", "/b"],
  ])("allows same-origin path %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    "https://evil.test/",
    "//evil.test/path",
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "evil.test",
    "/\u0000evil",
    "/\tevil",
    "",
    "x".repeat(3000),
    undefined,
    ["/notes"],
  ])("rejects %j", (input) => {
    expect(safeRedirect(input, "/home")).toBe("/home");
  });
});
