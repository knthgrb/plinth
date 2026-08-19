import { computeAnnualTaxFromBasic } from "@/lib/ph-withholding-tax";

export type FinalTaxAdjustment = {
  annualTaxableIncome: number;
  annualTaxDue: number;
  taxAlreadyWithheld: number;
  adjustment: number;
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeFinalTaxAdjustment(args: {
  taxableCompensation: number;
  mandatoryContributions: number;
  taxAlreadyWithheld: number;
}): FinalTaxAdjustment {
  const annualTaxableIncome = roundCurrency(
    Math.max(0, args.taxableCompensation - args.mandatoryContributions),
  );
  const annualTaxDue = roundCurrency(
    computeAnnualTaxFromBasic(annualTaxableIncome),
  );
  const taxAlreadyWithheld = roundCurrency(
    Math.max(0, args.taxAlreadyWithheld),
  );
  return {
    annualTaxableIncome,
    annualTaxDue,
    taxAlreadyWithheld,
    adjustment: roundCurrency(annualTaxDue - taxAlreadyWithheld),
  };
}
