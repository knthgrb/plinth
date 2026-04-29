/**
 * Shared with client `payroll-preview-earnings-helpers` — keep formulas in sync when changing either.
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const EMBEDDED_IN_BASIC_KEYS = [
  "restDayPay",
  "overtimeRegular",
  "overtimeRestDay",
  "overtimeRestDayExcess",
  "overtimeSpecialHoliday",
  "overtimeSpecialHolidayExcess",
  "overtimeLegalHoliday",
  "overtimeLegalHolidayExcess",
] as const;

export type VariableEarnings = {
  holidayPay: number;
  nightDiffPay: number;
  restDayPay: number;
  overtimeRegular: number;
  overtimeRestDay: number;
  overtimeRestDayExcess: number;
  overtimeSpecialHoliday: number;
  overtimeSpecialHolidayExcess: number;
  overtimeLegalHoliday: number;
  overtimeLegalHolidayExcess: number;
};

type Deduction = { name: string; amount: number; type: string };

function sumEmbeddedEarningsInBasic(e: VariableEarnings): number {
  return round2(
    EMBEDDED_IN_BASIC_KEYS.reduce((s, k) => s + (e[k] ?? 0), 0),
  );
}

function sumNonTaxableIncentiveAmounts(
  incentives: { amount: number; taxable?: boolean }[] | null | undefined,
): number {
  if (!incentives?.length) return 0;
  return round2(
    incentives
      .filter((i) => i.taxable === false)
      .reduce((s, i) => s + (i.amount || 0), 0),
  );
}

export function getVariableEarningsFromPayslip(p: Record<string, unknown>): VariableEarnings {
  const n = (k: string) => {
    const v = p[k];
    return typeof v === "number" && !Number.isNaN(v) ? v : 0;
  };
  return {
    holidayPay: n("holidayPay"),
    nightDiffPay: n("nightDiffPay"),
    restDayPay: n("restDayPay"),
    overtimeRegular: n("overtimeRegular"),
    overtimeRestDay: n("overtimeRestDay"),
    overtimeRestDayExcess: n("overtimeRestDayExcess"),
    overtimeSpecialHoliday: n("overtimeSpecialHoliday"),
    overtimeSpecialHolidayExcess: n("overtimeSpecialHolidayExcess"),
    overtimeLegalHoliday: n("overtimeLegalHoliday"),
    overtimeLegalHolidayExcess: n("overtimeLegalHolidayExcess"),
  };
}

export function recomputeGrossAndBasicFromVariableEarnings(
  p: { grossPay?: number; basicPay?: number },
  atOpen: VariableEarnings,
  edited: VariableEarnings,
  taxableIncentiveTotalAtOpen: number,
  taxableIncentiveTotalNow: number,
): { grossPay: number; basicPay: number } {
  const g0 = typeof p.grossPay === "number" ? p.grossPay : 0;
  const b0 = typeof p.basicPay === "number" ? p.basicPay : 0;
  const h0 = atOpen.holidayPay;
  const n0 = atOpen.nightDiffPay;
  const e0 = sumEmbeddedEarningsInBasic(atOpen);
  const h1 = edited.holidayPay;
  const n1 = edited.nightDiffPay;
  const e1 = sumEmbeddedEarningsInBasic(edited);
  const t0 = round2(taxableIncentiveTotalAtOpen);
  const t1 = round2(taxableIncentiveTotalNow);
  const g1 = round2(g0 + (h1 - h0) + (n1 - n0) + (e1 - e0) + (t1 - t0));
  const b1 = round2(b0 - e0 + e1);
  return { grossPay: g1, basicPay: b1 };
}

/**
 * `totalEarnings` = gross + nonta + non‑taxable incentives; `net` = that minus all deduction lines.
 */
export function recomputeNetFromEarningsAndLines(
  grossPay: number,
  nonTaxableAllowance: number,
  incentives: { amount: number; taxable?: boolean }[],
  deductions: Deduction[],
): { totalEarnings: number; netPay: number; totalDeductions: number } {
  const nont = sumNonTaxableIncentiveAmounts(incentives);
  const nta = round2(nonTaxableAllowance || 0);
  const totalEarnings = round2(grossPay + nta + nont);
  const totalDed = round2(
    deductions.reduce((s, d) => s + (d.amount || 0), 0),
  );
  const netPay = round2(Math.max(0, totalEarnings - totalDed));
  return { totalEarnings, netPay, totalDeductions: totalDed };
}
