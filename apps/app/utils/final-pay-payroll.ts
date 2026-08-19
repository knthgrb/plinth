function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export type PayrollRunStatus =
  | "draft"
  | "processing"
  | "finalized"
  | "paid"
  | "archived"
  | "cancelled";

const ALLOWED_PAYROLL_RUN_TRANSITIONS: Record<
  PayrollRunStatus,
  ReadonlySet<PayrollRunStatus>
> = {
  draft: new Set(["finalized", "cancelled"]),
  processing: new Set(["draft", "cancelled"]),
  finalized: new Set(["paid", "archived"]),
  paid: new Set(["finalized", "archived"]),
  archived: new Set(),
  cancelled: new Set(),
};

export function assertPayrollRunStatusTransition(
  currentStatus: PayrollRunStatus,
  nextStatus: PayrollRunStatus,
): void {
  if (currentStatus === nextStatus) return;
  if (!ALLOWED_PAYROLL_RUN_TRANSITIONS[currentStatus].has(nextStatus)) {
    throw new Error(
      `Payroll run cannot transition from ${currentStatus} to ${nextStatus}.`,
    );
  }
}

export function reconcileFinalPayBasicPay(
  computedBasicPay: number,
  overlappingPaidBasicPay: number,
): number {
  return roundCurrency(
    Math.max(
      0,
      (Number.isFinite(computedBasicPay) ? computedBasicPay : 0) -
        (Number.isFinite(overlappingPaidBasicPay) ? overlappingPaidBasicPay : 0),
    ),
  );
}

export type FinalPayOverlapCoverage = "none" | "partial" | "full";

export function resolveFinalPayOverlapCoverage(
  cutoffStart: number,
  employmentEnd: number,
  paidPeriods: ReadonlyArray<{ start: number; end: number }>,
): FinalPayOverlapCoverage {
  const overlaps = paidPeriods
    .filter(
      (period) => period.start <= employmentEnd && period.end >= cutoffStart,
    )
    .sort((left, right) => left.start - right.start);
  if (overlaps.length === 0) return "none";

  let coveredThrough = cutoffStart - 1;
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (const period of overlaps) {
    if (period.start > coveredThrough + oneDayMs) break;
    coveredThrough = Math.max(coveredThrough, period.end);
    if (coveredThrough >= employmentEnd) return "full";
  }

  return "partial";
}
