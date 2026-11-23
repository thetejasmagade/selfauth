import { describe, expect, it } from "vitest";
import { visitorAddress } from "../src/proxy.ts";

describe("visitorAddress", () => {
  it("takes the entry the nearest trusted proxy appended, never one the visitor wrote", () => {
    expect(visitorAddress("203.0.113.9", 1)).toBe("203.0.113.9");
    expect(visitorAddress("10.0.0.1, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(visitorAddress("198.51.100.1, 203.0.113.9", 2)).toBe("198.51.100.1");
    expect(visitorAddress("203.0.113.9", 3)).toBe("203.0.113.9");
  });
  it("drops the header when nothing is trusted or the value is not an address", () => {
    expect(visitorAddress("203.0.113.9", 0)).toBeNull();
    expect(visitorAddress("not-an-address", 1)).toBeNull();
    expect(visitorAddress(null, 1)).toBeNull();
    expect(visitorAddress("2001:db8::1", 1)).toBe("2001:db8::1");
  });
});
