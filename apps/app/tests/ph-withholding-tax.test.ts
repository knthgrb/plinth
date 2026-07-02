import { describe, expect, it } from "vitest";

import {
  getTaxDeductionAmount,
  getWithholdingTaxCutoffForEmployee,
} from "@/lib/ph-withholding-tax";

function manilaMidnightUtc(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day - 1, 16, 0, 0, 0);
}

describe("withholding tax cutoff routing", () => {
  it("treats Manila 16th as the second semi-monthly cutoff", () => {
    const cutoffStart = manilaMidnightUtc(2026, 4, 16);

    expect(
      getTaxDeductionAmount(
        1000,
        cutoffStart,
        "bimonthly",
        "once_per_month",
        "first",
      ),
    ).toBe(0);

    expect(
      getTaxDeductionAmount(
        1000,
        cutoffStart,
        "bimonthly",
        "once_per_month",
        "second",
      ),
    ).toBe(1000);
  });

  it("treats Manila 15th as the first semi-monthly cutoff", () => {
    const cutoffStart = manilaMidnightUtc(2026, 4, 15);

    expect(
      getTaxDeductionAmount(
        1000,
        cutoffStart,
        "bimonthly",
        "once_per_month",
        "first",
      ),
    ).toBe(1000);

    expect(
      getTaxDeductionAmount(
        1000,
        cutoffStart,
        "bimonthly",
        "once_per_month",
        "second",
      ),
    ).toBe(0);
  });

  it("uses taxable cutoff gross and salary-based contributions for withholding tax", () => {
    const cutoffStart = manilaMidnightUtc(2026, 4, 1);
    const employee = {
      compensation: {
        salaryType: "monthly",
        basicSalary: 50_000,
      },
    };

    const tax = getWithholdingTaxCutoffForEmployee(employee, {
      workingDaysPerYear: 261,
      cutoffStart,
      payFrequency: "bimonthly",
      taxDeductionFrequency: "twice_per_month",
      taxDeductOnPay: "first",
      taxableGrossForCutoff: 30_000,
    });

    expect(tax).toBe(4_183.34);
  });
});
