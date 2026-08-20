import { describe, expect, it } from "vitest";

import {
  computeAnnualTaxFromBasic,
  getTaxDeductionAmount,
  getWithholdingTaxCutoffForEmployee,
  removeWithholdingTaxOverrideLines,
} from "@/lib/ph-withholding-tax";

type DeductionLine = {
  name: string;
  amount: number;
  type: string;
};

function manilaMidnightUtc(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day - 1, 16, 0, 0, 0);
}

describe("withholding tax cutoff routing", () => {
  it("removes withholding tax from preserved payslip overrides", () => {
    const result = removeWithholdingTaxOverrideLines<DeductionLine>([
      { name: "Cash advance", amount: 750, type: "custom" },
      { name: " withholding TAX ", amount: 9_999, type: "government" },
      { name: "SSS", amount: 900, type: "government" },
    ]);

    expect(result).toEqual([
      { name: "Cash advance", amount: 750, type: "custom" },
      { name: "SSS", amount: 900, type: "government" },
    ]);
  });

  it("omits an override collection that only contained withholding tax", () => {
    expect(
      removeWithholdingTaxOverrideLines<DeductionLine>([
        { name: "Withholding Tax", amount: 1_234.56, type: "government" },
      ]),
    ).toBeUndefined();
  });

  it.each([
    [250_000, 0],
    [400_000, 22_500],
    [800_000, 102_500],
    [2_000_000, 402_500],
    [8_000_000, 2_202_500],
    [9_000_000, 2_552_500],
  ])("uses the BIR 2023-onward annual table at ₱%i", (income, expected) => {
    expect(computeAnnualTaxFromBasic(income)).toBe(expected);
  });

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

    expect(tax).toBe(3_284.17);
  });
});
