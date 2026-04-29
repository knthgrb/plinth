/**
 * Philippine TRAIN withholding tax (cutoff) — same pipeline as
 * `buildCanonicalPayrollResult` in `convex/payroll.ts`. Used for edit payslip + Step 5 preview
 * to keep WHT in sync when variable earnings change.
 */

import { getSSSContribution } from "@/utils/sss";

const PHILHEALTH_EMPLOYEE_MONTHLY = 500;
const PAGIBIG_EMPLOYEE_MONTHLY = 200;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * TRAIN Law individual income tax table (2025 rates).
 * Taxable income = gross income - mandatory contributions (SSS, PhilHealth, Pag-IBIG).
 */
export function computeAnnualTaxFromBasic(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 250_000) return 0;
  if (annualTaxableIncome <= 400_000) {
    return 0.2 * (annualTaxableIncome - 250_000);
  }
  if (annualTaxableIncome <= 800_000) {
    return 30_000 + 0.25 * (annualTaxableIncome - 400_000);
  }
  if (annualTaxableIncome <= 2_000_000) {
    return 130_000 + 0.3 * (annualTaxableIncome - 800_000);
  }
  if (annualTaxableIncome <= 8_000_000) {
    return 490_000 + 0.32 * (annualTaxableIncome - 2_000_000);
  }
  return 2_410_000 + 0.35 * (annualTaxableIncome - 8_000_000);
}

type PayFrequency = "monthly" | "bimonthly";

/**
 * Per-cutoff withholding amount from annualized basic (aligns with server `getTaxDeductionAmount`).
 */
export function getTaxDeductionAmount(
  monthlyTax: number,
  cutoffStart: number,
  payFrequency: PayFrequency,
  taxDeductionFrequency: "once_per_month" | "twice_per_month",
  taxDeductOnPay: "first" | "second",
): number {
  if (payFrequency === "monthly") return monthlyTax;
  const dayOfMonth = new Date(cutoffStart).getDate();
  const isFirstPay = dayOfMonth <= 15;

  if (taxDeductionFrequency === "twice_per_month") {
    return round2(monthlyTax / 2);
  }
  if (taxDeductOnPay === "first") {
    return isFirstPay ? monthlyTax : 0;
  }
  return isFirstPay ? 0 : monthlyTax;
}

/** Match `convex/payroll` getDailyRateForEmployee (monthly path) for tax basis. */
function getDailyRateForEmployee(
  employee: any,
  _cutoffStart: number,
  _cutoffEnd: number,
  options?: { includeAllowance: boolean; workingDaysPerYear: number },
): number {
  const salaryType = employee?.compensation?.salaryType || "monthly";
  const basicSalary = employee?.compensation?.basicSalary || 0;
  const allowance = employee?.compensation?.allowance ?? 0;

  if (salaryType === "daily") {
    return basicSalary;
  }
  if (salaryType === "hourly") {
    return basicSalary * 8;
  }
  if (options) {
    const monthlyBase =
      basicSalary + (options.includeAllowance ? allowance : 0);
    return monthlyBase * (12 / options.workingDaysPerYear);
  }
  return basicSalary / 22;
}

/** Monthly basic for SSS / tax, aligned with `getMonthlyBasicForTax` in `convex/payroll`. */
export function getMonthlyBasicForTax(
  employee: any,
  workingDaysPerYear: number,
): number {
  const salaryType = employee?.compensation?.salaryType || "monthly";
  const basicSalary = employee?.compensation?.basicSalary || 0;

  if (salaryType === "monthly") {
    return basicSalary;
  }

  const dailyRateNoAllowance = getDailyRateForEmployee(
    employee,
    0,
    0,
    { includeAllowance: false, workingDaysPerYear },
  );

  return dailyRateNoAllowance * (workingDaysPerYear / 12);
}

/**
 * Withholding amount for this cutoff (before the dailyized first-cutoff / gross 20,833 rule).
 */
export function getWithholdingTaxCutoffForEmployee(
  employee: any,
  options: {
    workingDaysPerYear: number;
    cutoffStart: number;
    payFrequency: PayFrequency;
    taxDeductionFrequency: "once_per_month" | "twice_per_month";
    taxDeductOnPay: "first" | "second";
  },
): number {
  const monthlyBasicForTax = getMonthlyBasicForTax(
    employee,
    options.workingDaysPerYear,
  );
  const sssContribution = getSSSContribution(monthlyBasicForTax);
  const annualBasic = monthlyBasicForTax * 12;
  const annualSSS = sssContribution.employeeShare * 12;
  const annualPhilhealth = PHILHEALTH_EMPLOYEE_MONTHLY * 12;
  const annualPagibig = PAGIBIG_EMPLOYEE_MONTHLY * 12;
  const annualTaxableIncome = Math.max(
    0,
    annualBasic - annualSSS - annualPhilhealth - annualPagibig,
  );
  const annualTax = computeAnnualTaxFromBasic(annualTaxableIncome);
  const monthlyTax = round2(annualTax / 12);
  return getTaxDeductionAmount(
    monthlyTax,
    options.cutoffStart,
    options.payFrequency,
    options.taxDeductionFrequency,
    options.taxDeductOnPay,
  );
}

/** Same rule as `buildCanonicalPayrollResult` (dailyized hire / first cutoff). */
export function shouldShowWithholdingTaxByGrossRule(
  isDailyizedFirstCutoff: boolean,
  grossPay: number,
): boolean {
  const qualifiesForFirstCutoffTax =
    !isDailyizedFirstCutoff || grossPay > 20_833;
  return qualifiesForFirstCutoffTax;
}

export type DeductionLine = { name: string; amount: number; type: string };

/**
 * Strips all "Withholding Tax" lines and optionally inserts one with the canonical
 * name/casing for display.
 */
export function mergeWithholdingTaxDeductionLine(
  deductions: DeductionLine[],
  options: {
    /** From payroll run `governmentDeductionSettings[].tax.enabled` */
    taxEnabledInRun: boolean;
    /** From {@link getWithholdingTaxCutoffForEmployee} */
    taxCutoffAmount: number;
    isDailyizedFirstCutoff: boolean;
    grossPay: number;
  },
): DeductionLine[] {
  const wht = (n: string) => (n || "").trim().toLowerCase() === "withholding tax";
  const withoutWht = deductions.filter((d) => !wht(d.name));
  const showLine =
    options.taxEnabledInRun &&
    options.taxCutoffAmount > 0 &&
    shouldShowWithholdingTaxByGrossRule(
      options.isDailyizedFirstCutoff,
      options.grossPay,
    );
  if (!showLine) {
    return withoutWht;
  }
  const line: DeductionLine = {
    name: "Withholding Tax",
    amount: round2(options.taxCutoffAmount),
    type: "government",
  };
  return insertWithholdingAfterGovLines(withoutWht, line);
}

function insertWithholdingAfterGovLines(
  lines: DeductionLine[],
  wht: DeductionLine,
): DeductionLine[] {
  const out = [...lines];
  const isPag = (d: DeductionLine) => (d.name || "").trim() === "Pag-IBIG";
  const isPh = (d: DeductionLine) => (d.name || "").trim() === "PhilHealth";
  const isSss = (d: DeductionLine) => (d.name || "").trim() === "SSS";
  const pagI = out.findIndex(isPag);
  if (pagI >= 0) {
    out.splice(pagI + 1, 0, wht);
    return out;
  }
  const phI = out.findIndex(isPh);
  if (phI >= 0) {
    out.splice(phI + 1, 0, wht);
    return out;
  }
  const idxSss = out.findIndex(isSss);
  if (idxSss >= 0) {
    out.splice(idxSss + 1, 0, wht);
    return out;
  }
  const firstNonGov = out.findIndex(
    (d) => (d.type || "").toLowerCase() !== "government",
  );
  if (firstNonGov >= 0) {
    out.splice(firstNonGov, 0, wht);
  } else {
    out.push(wht);
  }
  return out;
}
