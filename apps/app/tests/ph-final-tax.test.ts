import { describe, expect, it } from "vitest";

import { computeFinalTaxAdjustment } from "@/lib/ph-final-tax";

describe("Philippine final annualized withholding adjustment", () => {
  it("returns the remaining withholding tax due at termination", () => {
    expect(
      computeFinalTaxAdjustment({
        taxableCompensation: 500_000,
        mandatoryContributions: 30_000,
        taxAlreadyWithheld: 30_000,
      }),
    ).toEqual({
      annualTaxableIncome: 470_000,
      annualTaxDue: 36_500,
      taxAlreadyWithheld: 30_000,
      adjustment: 6_500,
    });
  });

  it("returns a negative adjustment when tax must be refunded", () => {
    expect(
      computeFinalTaxAdjustment({
        taxableCompensation: 300_000,
        mandatoryContributions: 20_000,
        taxAlreadyWithheld: 10_000,
      }),
    ).toEqual({
      annualTaxableIncome: 280_000,
      annualTaxDue: 4_500,
      taxAlreadyWithheld: 10_000,
      adjustment: -5_500,
    });
  });
});
