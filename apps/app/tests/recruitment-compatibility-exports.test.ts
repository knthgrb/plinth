import { describe, expect, it } from "vitest";
import {
  replaceEmployeeDeductions,
  replaceEmployeeIncentives,
} from "../convex/leaveEmployeeCompatibility";

describe("recruitment employee projection exports", () => {
  it("exports the normalized child replacement operations used by recruitment", () => {
    expect(replaceEmployeeDeductions).toBeTypeOf("function");
    expect(replaceEmployeeIncentives).toBeTypeOf("function");
  });
});
