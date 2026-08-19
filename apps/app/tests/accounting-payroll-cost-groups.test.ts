import { describe, expect, it } from "vitest";

import {
  groupPayrollCostItems,
  isPayrollGeneratedCostItem,
} from "@/lib/accounting/payroll-cost-groups";

describe("payroll accounting cost groups", () => {
  it("collapses payroll liabilities into one group per payroll run", () => {
    const groups = groupPayrollCostItems(
      [
        {
          id: "payroll",
          payrollRunId: "run-1",
          name: "Payroll - Apr 10 - Apr 24, 2026",
          amount: 26_862.47,
          amountPaid: 10_000,
          status: "partial",
          updatedAt: 20,
        },
        {
          id: "sss",
          payrollRunId: "run-1",
          name: "SSS - Apr 10 - Apr 24, 2026",
          amount: 4_530,
          amountPaid: 0,
          status: "pending",
          updatedAt: 21,
        },
        {
          id: "tax",
          payrollRunId: "run-1",
          name: "Tax Employee Deductions - Apr 10 - Apr 24, 2026",
          amount: 687.53,
          amountPaid: 0,
          status: "pending",
          updatedAt: 22,
        },
      ],
      [
        {
          id: "run-1",
          status: "finalized",
          runType: "regular",
          period: "Apr 10 - Apr 24, 2026",
          employeeCount: 1,
          updatedAt: 19,
        },
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "run:run-1",
      period: "Apr 10 - Apr 24, 2026",
      runType: "regular",
      employeeCount: 1,
      total: 32_080,
      paidTotal: 10_000,
      remaining: 22_080,
      status: "partial",
    });
    expect(groups[0].components.map((component) => component.type)).toEqual([
      "payroll",
      "sss",
      "tax",
    ]);
  });

  it("creates a missing-record group for a finalized payroll without costs", () => {
    const groups = groupPayrollCostItems([], [
      {
        id: "run-2",
        status: "finalized",
        runType: "final_pay",
        period: "Final Pay Aug 1 - Aug 15, 2026",
        updatedAt: 30,
      },
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        key: "run:run-2",
        runType: "final_pay",
        status: "missing",
        components: [],
      }),
    ]);
  });

  it("keeps manually entered employee costs out of payroll groups", () => {
    expect(
      isPayrollGeneratedCostItem({
        name: "HMO reimbursement",
        sourceType: "manual",
      }),
    ).toBe(false);
    expect(
      isPayrollGeneratedCostItem({
        name: "Payroll - Apr 10 - Apr 24, 2026",
        sourceType: "payroll_run",
      }),
    ).toBe(true);
  });
});
