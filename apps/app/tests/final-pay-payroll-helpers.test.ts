import { describe, expect, it } from "vitest";

import {
  assertPayrollRunStatusTransition,
  reconcileFinalPayBasicPay,
  resolveFinalPayOverlapCoverage,
} from "@/utils/final-pay-payroll";
import { isEmployeeFinalPayEligible } from "@/utils/employment-lifecycle";

describe("final pay payroll helpers", () => {
  it("accepts canonical and legacy separated employment statuses", () => {
    expect(isEmployeeFinalPayEligible("separated")).toBe(true);
    expect(isEmployeeFinalPayEligible("resigned")).toBe(true);
    expect(isEmployeeFinalPayEligible("terminated")).toBe(true);
    expect(isEmployeeFinalPayEligible("active")).toBe(false);
  });

  it("subtracts overlapping finalized regular basic pay without going below zero", () => {
    expect(reconcileFinalPayBasicPay(12_000, 5_000)).toBe(7_000);
    expect(reconcileFinalPayBasicPay(12_000, 15_000)).toBe(0);
  });

  it("rounds reconciled basic pay to currency precision", () => {
    expect(reconcileFinalPayBasicPay(10_000.555, 2_500.444)).toBe(7_500.11);
  });

  it("rejects status jumps that bypass payroll review", () => {
    expect(() => assertPayrollRunStatusTransition("draft", "paid")).toThrow(
      "cannot transition",
    );
    expect(() =>
      assertPayrollRunStatusTransition("draft", "finalized"),
    ).not.toThrow();
    expect(() =>
      assertPayrollRunStatusTransition("finalized", "paid"),
    ).not.toThrow();
  });

  it("distinguishes fully paid and partially overlapping payroll windows", () => {
    expect(
      resolveFinalPayOverlapCoverage(1, 15, [{ start: 1, end: 15 }]),
    ).toBe("full");
    expect(
      resolveFinalPayOverlapCoverage(1, 15, [{ start: 1, end: 10 }]),
    ).toBe("partial");
    expect(
      resolveFinalPayOverlapCoverage(1, 15, [{ start: 20, end: 30 }]),
    ).toBe("none");
  });
});
