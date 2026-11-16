import type {
  ErrorCode as SpecErrorCode,
  ErrorEnvelope as SpecEnvelope,
  SelfAuthConfig as SpecConfig,
} from "@selfauth/spec";
import { describe, expectTypeOf, it } from "vitest";
import type { ErrorCode, ErrorEnvelope, SelfAuthConfig } from "../src/auth/types.ts";

/** The app's local spec types must stay identical to @selfauth/spec (checked by `tsc`). */
describe("local spec types", () => {
  it("match @selfauth/spec exactly", () => {
    expectTypeOf<SelfAuthConfig>().toEqualTypeOf<SpecConfig>();
    expectTypeOf<ErrorCode>().toEqualTypeOf<SpecErrorCode>();
    expectTypeOf<ErrorEnvelope>().toEqualTypeOf<SpecEnvelope>();
  });
});
