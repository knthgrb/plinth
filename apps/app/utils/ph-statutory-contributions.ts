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

const PHILHEALTH_RATE_2025 = 0.05;
const PHILHEALTH_MONTHLY_FLOOR_2025 = 10_000;
const PHILHEALTH_MONTHLY_CEILING_2025 = 100_000;

const PAGIBIG_RATE = 0.02;
const PAGIBIG_MONTHLY_FUND_SALARY_CEILING = 10_000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function getPhilHealthContribution(
  monthlyBasicPay: number,
): PhilHealthContribution {
  const monthlyPremiumBase = clamp(
    Number(monthlyBasicPay) || 0,
    PHILHEALTH_MONTHLY_FLOOR_2025,
    PHILHEALTH_MONTHLY_CEILING_2025,
  );
  const total = round2(monthlyPremiumBase * PHILHEALTH_RATE_2025);
  const employeeShare = round2(total / 2);
  const employerShare = round2(total - employeeShare);

  return {
    monthlyPremiumBase,
    rate: PHILHEALTH_RATE_2025,
    employeeShare,
    employerShare,
    total,
  };
}

export function getPagibigContribution(
  monthlyBasicPay: number,
): PagibigContribution {
  const monthlyFundSalary = Math.min(
    Math.max(Number(monthlyBasicPay) || 0, 0),
    PAGIBIG_MONTHLY_FUND_SALARY_CEILING,
  );
  const employeeShare = round2(monthlyFundSalary * PAGIBIG_RATE);
  const employerShare = round2(monthlyFundSalary * PAGIBIG_RATE);

  return {
    monthlyFundSalary,
    rate: PAGIBIG_RATE,
    employeeShare,
    employerShare,
    total: round2(employeeShare + employerShare),
  };
}
