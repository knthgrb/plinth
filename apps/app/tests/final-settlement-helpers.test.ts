import { describe, expect, it } from "vitest";
import {
  buildFinalSettlementPayrollDeductions,
  computeFinalSettlementSummary,
  createDefaultFinalSettlementChecklist,
  isFinalSettlementReadyForPayroll,
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
    expect(summary.readyForRelease).toBe(true);
  });
});
