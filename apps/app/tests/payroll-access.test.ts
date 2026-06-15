import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYROLL_TAB_PASSWORD,
  getPayrollTabPassword,
  isPayrollPasswordCorrect,
} from "@/utils/payroll-access";

describe("payroll access", () => {
  it("defaults the payroll tab password to the seeded code", () => {
    expect(getPayrollTabPassword(undefined)).toBe(DEFAULT_PAYROLL_TAB_PASSWORD);
    expect(getPayrollTabPassword({})).toBe(DEFAULT_PAYROLL_TAB_PASSWORD);
  });

  it("accepts the configured payroll password after trimming input", () => {
    expect(
      isPayrollPasswordCorrect(" 2468 ", {
        payrollTabPassword: "2468",
      }),
    ).toBe(true);
  });

  it("treats a blank configured password as no password required", () => {
    expect(
      isPayrollPasswordCorrect("anything", {
        payrollTabPassword: "   ",
      }),
    ).toBe(true);
  });
});
