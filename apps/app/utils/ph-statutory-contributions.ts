export type StatutoryContribution = {
  employeeShare: number;
  employerShare: number;
  total: number;
};

export type PhilHealthContribution = StatutoryContribution & {
  monthlyPremiumBase: number;
  rate: number;
};

export type PagibigContribution = StatutoryContribution & {
  monthlyFundSalary: number;
  rate: number;
};

export type StatutoryRuleOptions = {
  effectiveAt?: number;
  ruleVersion?: string;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function getPhilHealthContribution(
  monthlyBasicPay: number,
  options: StatutoryRuleOptions = {},
): PhilHealthContribution {
  const rules = resolvePhStatutoryRuleSet(
    options.effectiveAt ?? Date.now(),
    options.ruleVersion,
  );
  const monthlyPremiumBase = clamp(
    Number(monthlyBasicPay) || 0,
    rules.philHealth.monthlyFloor,
    rules.philHealth.monthlyCeiling,
  );
  const total = round2(monthlyPremiumBase * rules.philHealth.rate);
  const employeeShare = round2(
    total * rules.philHealth.employeeShareRatio,
  );
  const employerShare = round2(total - employeeShare);

  return {
    monthlyPremiumBase,
    rate: rules.philHealth.rate,
    employeeShare,
    employerShare,
    total,
  };
}

export function getPagibigContribution(
  monthlyBasicPay: number,
  options: StatutoryRuleOptions = {},
): PagibigContribution {
  const rules = resolvePhStatutoryRuleSet(
    options.effectiveAt ?? Date.now(),
    options.ruleVersion,
  );
  const monthlyFundSalary = Math.min(
    Math.max(Number(monthlyBasicPay) || 0, 0),
    rules.pagibig.monthlyFundSalaryCeiling,
  );
  const employeeRate =
    monthlyFundSalary <= rules.pagibig.employeeRateThreshold
      ? rules.pagibig.employeeRateAtOrBelowThreshold
      : rules.pagibig.employeeRateAboveThreshold;
  const employeeShare = round2(monthlyFundSalary * employeeRate);
  const employerShare = round2(
    monthlyFundSalary * rules.pagibig.employerRate,
  );

  return {
    monthlyFundSalary,
    rate: employeeRate,
    employeeShare,
    employerShare,
    total: round2(employeeShare + employerShare),
  };
}
import { resolvePhStatutoryRuleSet } from "@/lib/ph-statutory-rules";
