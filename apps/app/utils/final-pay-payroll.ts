function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export type PayrollRunStatus = PayrollFinancialStatus;

export function assertPayrollRunStatusTransition(
  currentStatus: PayrollRunStatus,
  nextStatus: PayrollRunStatus,
): void {
  assertPayrollLifecycleTransition(currentStatus, nextStatus);
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
import {
  assertPayrollLifecycleTransition,
  type PayrollFinancialStatus,
} from "@/lib/payroll-lifecycle";
