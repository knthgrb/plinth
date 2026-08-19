import { describe, expect, it } from "vitest";
import {
  assertFinalSettlementEditable,
  assertFinalSettlementTransition,
  buildSeparationKey,
  buildFinalSettlementPayrollDeductions,
  computeFinalSettlementSummary,
  createDefaultFinalSettlementChecklist,
  createLoanPayoffsFromEmployeeDeductions,
  isFinalSettlementReadyForPayroll,
  validateFinalTaxReview,
} from "../utils/final-settlement";

describe("final settlement helpers", () => {
  it("requires every required clearance item to be completed or waived", () => {
    const checklist = createDefaultFinalSettlementChecklist(1);

    expect(
      isFinalSettlementReadyForPayroll({
        status: "in_review",
        clearanceItems: checklist,
      }),
    ).toBe(false);

    expect(
      isFinalSettlementReadyForPayroll({
        status: "ready_for_payroll",
        clearanceItems: checklist.map((item) => ({
          ...item,
          status: "completed",
        })),
      }),
    ).toBe(true);
  });

  it("only allows an unlinked ready settlement to enter payroll", () => {
    const clearanceItems = createDefaultFinalSettlementChecklist(1).map(
      (item) => ({ ...item, status: "completed" as const }),
    );

    expect(
      isFinalSettlementReadyForPayroll({
        status: "payroll_generated",
        clearanceItems,
      }),
    ).toBe(false);
    expect(
      isFinalSettlementReadyForPayroll({
        status: "released",
        clearanceItems,
      }),
    ).toBe(false);
    expect(
      isFinalSettlementReadyForPayroll({
        status: "ready_for_payroll",
        clearanceItems,
        payrollRunId: "run-1",
      }),
    ).toBe(false);
  });

  it("requires a verified positive payoff for approved loans", () => {
    const clearanceItems = createDefaultFinalSettlementChecklist(1).map(
      (item) => ({ ...item, status: "completed" as const }),
    );

    expect(
      isFinalSettlementReadyForPayroll({
        status: "ready_for_payroll",
        clearanceItems,
        loanPayoffs: [
          {
            id: "loan-1",
            name: "Salary loan",
            payoffAmount: 0,
            rule: "deduct_full_balance",
            status: "approved",
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not assume a recurring loan deduction is its outstanding balance", () => {
    const [payoff] = createLoanPayoffsFromEmployeeDeductions([
      {
        id: "loan-1",
        name: "Salary loan",
        type: "loan",
        amount: 1_500,
        frequency: "per-cutoff",
        isActive: true,
      },
    ]);

    expect(payoff).toMatchObject({
      scheduledAmount: 1_500,
      payoffAmount: 0,
      rule: "deduct_full_balance",
      status: "pending",
    });
  });

  it("binds settlement identity to the employee separation event", () => {
    expect(buildSeparationKey("employee-1", "resigned", 123_456)).toBe(
      "employee-1:resigned:123456",
    );
    expect(buildSeparationKey("employee-1", "terminated", 123_456)).not.toBe(
      buildSeparationKey("employee-1", "resigned", 123_456),
    );
  });

  it("locks generated settlements and rejects invalid lifecycle transitions", () => {
    expect(() => assertFinalSettlementEditable("payroll_generated")).toThrow(
      "cannot be edited",
    );
    expect(() => assertFinalSettlementEditable("ready_for_payroll")).not.toThrow();
    expect(() =>
      assertFinalSettlementTransition("released", "ready_for_payroll"),
    ).toThrow("cannot transition");
    expect(() =>
      assertFinalSettlementTransition("in_review", "ready_for_payroll"),
    ).not.toThrow();
  });

  it("builds approved loan payoff and custom deduction payroll lines", () => {
    const lines = buildFinalSettlementPayrollDeductions({
      loanPayoffs: [
        {
          id: "loan-1",
          name: "SSS Loan",
          payoffAmount: 1800,
          rule: "custom_amount",
          status: "approved",
        },
        {
          id: "waived-loan",
          name: "Waived Loan",
          payoffAmount: 500,
          rule: "waive",
          status: "waived",
        },
      ],
      customDeductions: [
        {
          id: "prop-1",
          name: "Unreturned asset",
          amount: 2500,
          type: "company_property",
        },
      ],
    });

    expect(lines).toEqual([
      { name: "Loan Payoff - SSS Loan", amount: 1800, type: "loan" },
      {
        name: "Separation Deduction - Unreturned asset",
        amount: 2500,
        type: "separation",
      },
    ]);
  });

  it("summarizes loan payoff, custom deductions, and release readiness", () => {
    const summary = computeFinalSettlementSummary({
      status: "payroll_generated",
      clearanceItems: [
        {
          id: "hr",
          label: "HR Clearance",
          required: true,
          status: "completed",
        },
        {
          id: "it",
          label: "IT Assets",
          required: true,
          status: "pending",
        },
      ],
      loanPayoffs: [
        {
          id: "loan",
          name: "Salary Loan",
          payoffAmount: 1000,
          rule: "deduct_full_balance",
          status: "approved",
        },
      ],
      customDeductions: [
        {
          id: "fee",
          name: "Training bond",
          amount: 1500,
          type: "other",
        },
      ],
      bir2316: { status: "data_ready" },
      finalTaxRelease: { status: "reviewed" },
    });

    expect(summary.clearance.completedRequired).toBe(1);
    expect(summary.clearance.required).toBe(2);
    expect(summary.totalSettlementDeductions).toBe(2500);
    expect(summary.readyForRelease).toBe(false);
  });

  it("requires a reason when HR overrides the calculated final tax", () => {
    expect(() =>
      validateFinalTaxReview({
        calculatedAdjustment: 6_500,
        appliedAdjustment: 5_000,
      }),
    ).toThrow("override reason");

    expect(
      validateFinalTaxReview({
        calculatedAdjustment: 6_500,
        appliedAdjustment: 5_000,
        overrideReason: "Confirmed against the employee's previous BIR 2316.",
      }),
    ).toEqual({
      calculatedAdjustment: 6_500,
      appliedAdjustment: 5_000,
      variance: -1_500,
      overrideReason: "Confirmed against the employee's previous BIR 2316.",
    });
  });
});
