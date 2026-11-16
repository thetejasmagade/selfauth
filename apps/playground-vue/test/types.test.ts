import type { ErrorCode as SpecErrorCode } from "@selfauth/spec";
import { describe, expectTypeOf, it } from "vitest";
import type { ErrorCode } from "../src/auth/types.ts";

describe("local spec types", () => {
  it("match @selfauth/spec exactly (checked by vue-tsc)", () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<SpecErrorCode>();
  });
});
