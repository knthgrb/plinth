import { describe, expect, it } from "vitest";

import {
  computeSupplementalWithholdingTaxForSpecialBenefit,
  splitTrainNinetyThousandBenefit,
} from "@/lib/ph-special-benefits";

describe("Philippine special benefit tax handling", () => {
  it("splits 13th month and other benefits against the annual PHP 90,000 cap", () => {
    expect(splitTrainNinetyThousandBenefit(70_000, 15_000)).toEqual({
      exempt: 70_000,
      taxable: 0,
    });

    expect(splitTrainNinetyThousandBenefit(80_000, 30_000)).toEqual({
      exempt: 60_000,
      taxable: 20_000,
    });
  });

  it("computes supplemental withholding as the unpaid annual tax delta", () => {
    const tax = computeSupplementalWithholdingTaxForSpecialBenefit({
      ytdTaxableGross: 1_000_000,
      ytdMandatoryContributions: 50_000,
      ytdWithholdingTax: 140_000,
      taxableBenefit: 40_000,
    });

    expect(tax).toBe(10_000);
  });
});
