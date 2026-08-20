import { describe, expect, it } from "vitest";

import {
  assertValidPayslipEditInput,
  assertValidPayrollRunInput,
  assertValidPayrollYear,
} from "@/lib/payroll-input-validation";

describe("payroll input validation", () => {
  it("rejects reversed cutoffs and duplicate employees", () => {
    expect(() =>
      assertValidPayrollRunInput({
        cutoffStart: 100,
        cutoffEnd: 200,
        employeeIds: [],
      }),
    ).toThrow("at least one employee");

    expect(() =>
      assertValidPayrollRunInput({
        cutoffStart: 200,
        cutoffEnd: 100,
        employeeIds: ["employee-1"],
      }),
    ).toThrow("Cutoff start must be on or before cutoff end");

    expect(() =>
      assertValidPayrollRunInput({
        cutoffStart: 100,
        cutoffEnd: 200,
        employeeIds: ["employee-1", "employee-1"],
      }),
    ).toThrow("Duplicate employees are not allowed");
  });

  it("rejects negative, non-finite, blank, and excessive line inputs", () => {
    expect(() =>
      assertValidPayrollRunInput({
        cutoffStart: 100,
        cutoffEnd: 200,
        employeeIds: ["employee-1"],
        manualDeductions: [
          {
            employeeId: "employee-1",
            lines: [{ name: "Cash advance", type: "custom", amount: -1 }],
          },
        ],
      }),
    ).toThrow("amount must be a finite non-negative number");

    expect(() =>
      assertValidPayrollRunInput({
        cutoffStart: 100,
        cutoffEnd: 200,
        employeeIds: ["employee-1"],
        incentives: [
          {
            employeeId: "employee-1",
            lines: [{ name: " ", type: "bonus", amount: Number.NaN }],
          },
        ],
      }),
    ).toThrow("name is required");
  });

  it("requires a bounded calendar year", () => {
    expect(() => assertValidPayrollYear(2026)).not.toThrow();
    expect(() => assertValidPayrollYear(2026.5)).toThrow("calendar year");
    expect(() => assertValidPayrollYear(1800)).toThrow("calendar year");
  });

  it("rejects invalid direct payslip edits", () => {
    expect(() =>
      assertValidPayslipEditInput({
        incentives: [{ name: "Bonus", type: "incentive", amount: -1 }],
      }),
    ).toThrow("finite non-negative");
    expect(() =>
      assertValidPayslipEditInput({
        variableEarnings: { overtimeRegular: Number.POSITIVE_INFINITY },
      }),
    ).toThrow("finite non-negative variable earning");
    expect(() =>
      assertValidPayslipEditInput({
        deductions: [{ name: " ", type: "custom", amount: 1 }],
      }),
    ).toThrow("line name is required");
    expect(() =>
      assertValidPayslipEditInput({ correctionReason: "x".repeat(1_001) }),
    ).toThrow("cannot exceed 1000");
  });
});
