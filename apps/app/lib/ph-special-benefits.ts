import { computeAnnualTaxFromBasic } from "@/lib/ph-withholding-tax";

export const TRAIN_ANNUAL_NON_TAXABLE_BENEFIT_CAP_PHP = 90_000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function splitTrainNinetyThousandBenefit(
  benefitAmount: number,
  ytdNonTaxableBenefits: number,
): { exempt: number; taxable: number } {
  const amount = Math.max(0, round2(benefitAmount));
  const used = Math.max(0, round2(ytdNonTaxableBenefits));
  const room = Math.max(0, TRAIN_ANNUAL_NON_TAXABLE_BENEFIT_CAP_PHP - used);
  const exempt = round2(Math.min(amount, room));

  return {
    exempt,
    taxable: round2(amount - exempt),
  };
}

export function computeSupplementalWithholdingTaxForSpecialBenefit(args: {
  ytdTaxableGross: number;
  ytdMandatoryContributions: number;
  ytdWithholdingTax: number;
  taxableBenefit: number;
}): number {
  const annualTaxableIncome = Math.max(
    0,
    round2(args.ytdTaxableGross) +
      round2(args.taxableBenefit) -
      round2(args.ytdMandatoryContributions),
  );
  const annualTaxDue = computeAnnualTaxFromBasic(annualTaxableIncome);

  return round2(Math.max(0, annualTaxDue - round2(args.ytdWithholdingTax)));
}
