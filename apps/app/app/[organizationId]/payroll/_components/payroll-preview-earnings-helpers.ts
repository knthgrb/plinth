/** Step 5 preview: editable “other earnings” fields (excludes basic pay & non‑taxable allowance). */

export const PREVIEW_EDITABLE_EARNINGS_KEYS = [
  "holidayPay",
  "nightDiffPay",
  "restDayPay",
  "overtimeRegular",
  "overtimeRestDay",
  "overtimeRestDayExcess",
  "overtimeSpecialHoliday",
  "overtimeSpecialHolidayExcess",
  "overtimeLegalHoliday",
  "overtimeLegalHolidayExcess",
] as const;

export type PreviewEditableEarningKey = (typeof PREVIEW_EDITABLE_EARNINGS_KEYS)[number];

export type PreviewEditableEarnings = Record<PreviewEditableEarningKey, number>;

export const PREVIEW_EARNING_LABELS: Record<PreviewEditableEarningKey, string> = {
  holidayPay: "Holiday pay",
  nightDiffPay: "Night differential",
  restDayPay: "Rest day premium",
  overtimeRegular: "Overtime — regular",
  overtimeRestDay: "Overtime — rest day",
  overtimeRestDayExcess: "Overtime — RD over 8 hrs",
  overtimeSpecialHoliday: "Overtime — special holiday",
  overtimeSpecialHolidayExcess: "Overtime — special holiday over 8 hrs",
  overtimeLegalHoliday: "Overtime — legal holiday",
  overtimeLegalHolidayExcess: "Overtime — legal holiday over 8 hrs",
};

const EMBEDDED_IN_BASIC_KEYS: readonly PreviewEditableEarningKey[] = [
  "restDayPay",
  "overtimeRegular",
  "overtimeRestDay",
  "overtimeRestDayExcess",
  "overtimeSpecialHoliday",
  "overtimeSpecialHolidayExcess",
  "overtimeLegalHoliday",
  "overtimeLegalHolidayExcess",
];

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sums pay components that are included in `basicPay` in payroll-calculations (OT + rest day). */
export function sumEmbeddedEarningsInBasic(e: PreviewEditableEarnings): number {
  return round2(
    EMBEDDED_IN_BASIC_KEYS.reduce(
      (s, k) => s + (e[k] ?? 0),
      0,
    ),
  );
}

export function getPreviewEarningsFromSource(
  p: Record<string, unknown> | null | undefined,
): PreviewEditableEarnings {
  const o = p ?? {};
  return PREVIEW_EDITABLE_EARNINGS_KEYS.reduce((acc, k) => {
    const v = o[k];
    acc[k] = typeof v === "number" && !Number.isNaN(v) ? v : 0;
    return acc;
  }, {} as PreviewEditableEarnings);
}

export function zeroPreviewEarnings(): PreviewEditableEarnings {
  return getPreviewEarningsFromSource({});
}

export function sumTaxableIncentiveAmounts(
  incentives: { amount: number; taxable?: boolean }[] | null | undefined,
): number {
  if (!incentives?.length) return 0;
  return round2(
    incentives
      .filter((i) => i.taxable !== false)
      .reduce((s, i) => s + (i.amount || 0), 0),
  );
}

export function sumNonTaxableIncentiveAmounts(
  incentives: { amount: number; taxable?: boolean }[] | null | undefined,
): number {
  if (!incentives?.length) return 0;
  return round2(
    incentives
      .filter((i) => i.taxable === false)
      .reduce((s, i) => s + (i.amount || 0), 0),
  );
}

type Deduction = { name: string; amount: number; type: string };

function isPreviewAttendanceDeductionName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return (
    n === "late" ||
    n === "regular day late" ||
    n === "regular holiday late" ||
    n === "special holiday late" ||
    n === "undertime" ||
    /^absent(?:\b|\s|\()/.test(n) ||
    /^no[\s-]*work(?:\b|\s|\()/.test(n)
  );
}

function isAttendanceDeductionRow(d: Deduction): boolean {
  const t = (d.type || "").toLowerCase();
  return t === "attendance" || isPreviewAttendanceDeductionName(d.name);
}

/**
 * After changing variable earnings, recompute `grossPay` and `basicPay` to stay consistent with
 * backend: `gross = basic + holiday + night + taxableIncentives`, with OT/rest embedded in
 * `basicPay`.
 */
export function recomputeGrossAndBasicFromEarnings(
  p: { grossPay?: number; basicPay?: number },
  atOpen: PreviewEditableEarnings,
  edited: PreviewEditableEarnings,
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
 * Net pay aligned with canonical: totalEarnings = gross + nonTaxable + nonTax incentives;
 * then subtract all deduction lines in order.
 */
export function recomputePreviewNet(
  grossPay: number,
  nonTaxableAllowance: number,
  incentives: { amount: number; taxable?: boolean }[],
  deductions: Deduction[],
): {
  totalEarnings: number;
  netPay: number;
  totalDeductions: number;
  taxableGrossEarnings: number;
} {
  const nont = sumNonTaxableIncentiveAmounts(incentives);
  const nta = round2(nonTaxableAllowance || 0);
  /** Same as `buildCanonicalPayrollResult`: `gross + nonTaxableAllowance + nonTaxableIncentives`. */
  const totalEarnings = round2(grossPay + nta + nont);
  const att = round2(
    deductions
      .filter((d) => isAttendanceDeductionRow(d))
      .reduce((s, d) => s + (d.amount || 0), 0),
  );
  const totalDed = round2(
    deductions.reduce((s, d) => s + (d.amount || 0), 0),
  );
  const netPay = round2(Math.max(0, totalEarnings - totalDed));
  const taxableGrossEarnings = Math.max(0, round2(grossPay - att));
  return {
    totalEarnings,
    netPay,
    totalDeductions: totalDed,
    taxableGrossEarnings,
  };
}
