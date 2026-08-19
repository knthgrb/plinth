import { describe, expect, it } from "vitest";

import {
  computeSupplementalWithholdingTaxForSpecialBenefit,
  splitPrivateLeaveConversionBenefit,
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

  it("exempts up to ten private-employee vacation leave days before the shared cap", () => {
    expect(
      splitPrivateLeaveConversionBenefit({
        amount: 15_000,
        convertedVacationDays: 15,
        dailyRate: 1_000,
        ytdOtherBenefits: 88_000,
      }),
    ).toEqual({
      deMinimisExempt: 10_000,
      otherBenefitsExempt: 2_000,
      taxable: 3_000,
    });
  });

  it("does not consume the shared benefit cap with de minimis leave conversion", () => {
    expect(
      splitPrivateLeaveConversionBenefit({
        amount: 8_000,
        convertedVacationDays: 8,
        dailyRate: 1_000,
        ytdOtherBenefits: 90_000,
      }),
    ).toEqual({
      deMinimisExempt: 8_000,
      otherBenefitsExempt: 0,
      taxable: 0,
    });
  });
});
