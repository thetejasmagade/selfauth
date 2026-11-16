import { describe, expect, it, vi } from "vitest";
import { takeTokenFromFragment } from "../src/auth/index.ts";

function env(url: string) {
  const u = new URL(url);
  const location = { hash: u.hash, pathname: u.pathname, search: u.search } as Location;
  const history = { state: null, replaceState: vi.fn() } as unknown as History;
  return { location, history };
}

describe("takeTokenFromFragment (SEC-TOKEN-005)", () => {
  it("returns the token and strips it from the URL", () => {
    const token = "A".repeat(43);
    const { location, history } = env(`https://app.test/reset-password?x=1#token=${token}`);
    expect(takeTokenFromFragment(location, history)).toBe(token);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/reset-password?x=1");
  });

  it("rejects malformed tokens but still clears the fragment", () => {
    const { location, history } = env("https://app.test/verify-email#token=<script>");
    expect(takeTokenFromFragment(location, history)).toBeNull();
    expect(history.replaceState).toHaveBeenCalled();
  });

  it("returns null without touching history when there is no fragment", () => {
    const { location, history } = env("https://app.test/verify-email");
    expect(takeTokenFromFragment(location, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
