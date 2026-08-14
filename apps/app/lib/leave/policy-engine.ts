import type {
  LeaveBalanceProjection,
  LeaveLedgerEntryInput,
  LeavePolicyRules,
} from "@/lib/leave/types";

export interface CalculateEntitlementInput {
  rules: LeavePolicyRules;
  hireDate: number;
  periodStart: number;
  periodEnd: number;
  asOf: number;
  regularizationDate?: number;
  qualificationDate?: number;
  eventDate?: number;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function validatePolicyRules(rules: LeavePolicyRules): void {
  if (
    rules.accountBehavior === "shared_pool" &&
    (rules.poolKey === undefined || rules.poolKey.trim().length === 0)
  ) {
    throw new Error("A shared pool policy requires a pool key.");
  }
  if (rules.annualUnits !== undefined && rules.annualUnits < 0) {
    throw new Error("Annual units cannot be negative.");
  }
  if (
    rules.carryover.mode === "capped" &&
    (rules.carryover.capUnits === undefined || rules.carryover.capUnits < 0)
  ) {
    throw new Error("A capped carryover policy requires a non-negative cap.");
  }
  if (
    rules.carryover.mode !== "capped" &&
    rules.carryover.capUnits !== undefined
  ) {
    throw new Error("Only capped carryover policies can set a cap.");
  }
  if (rules.accountBehavior === "non_credit" && rules.conversion.allowed) {
    throw new Error("Non-credit leave cannot be converted.");
  }
  if (
    rules.conversion.maxUnits !== undefined &&
    (!rules.conversion.allowed || rules.conversion.maxUnits < 0)
  ) {
    throw new Error(
      "Conversion maximum requires an allowed non-negative conversion.",
    );
  }
  if (rules.eligibility.completedServiceMonths < 0) {
    throw new Error("Completed service months cannot be negative.");
  }
}

export function calculateEntitlement(input: CalculateEntitlementInput): number {
  const { rules } = input;
  validatePolicyRules(rules);
  if (rules.entitlementMethod === "none" || rules.annualUnits === undefined)
    return 0;

  const eligibilityDate = getEligibilityDate(input);
  if (
    eligibilityDate === undefined ||
    completedMonthsBetween(eligibilityDate, input.asOf) <
      rules.eligibility.completedServiceMonths
  ) {
    return 0;
  }

  const entitlement = prorateAnnualUnits(
    rules.annualUnits,
    rules.prorationMethod,
    Math.max(input.periodStart, eligibilityDate),
    input.periodEnd,
  );
  return roundLeaveUnits(entitlement, rules.roundingIncrement);
}

export function roundLeaveUnits(
  units: number,
  increment: LeavePolicyRules["roundingIncrement"],
): number {
  return Math.round((units + Number.EPSILON) / increment) * increment;
}

export function projectLeaveBalance(
  entries: readonly LeaveLedgerEntryInput[],
): LeaveBalanceProjection {
  return entries.reduce<LeaveBalanceProjection>(
    (projection, entry) => {
      projection.available += entry.amount;
      switch (entry.kind) {
        case "opening_grant":
        case "grant":
        case "accrual":
          projection.granted += entry.amount;
          break;
        case "opening_usage":
        case "usage":
          projection.used -= entry.amount;
          break;
        case "reservation":
        case "reservation_release":
          projection.reserved -= entry.amount;
          break;
        case "conversion":
          projection.converted -= entry.amount;
          break;
        case "expiration":
          projection.expired -= entry.amount;
          break;
        case "restoration":
        case "adjustment":
        case "carryover":
        case "migration_reconciliation":
          break;
      }
      return projection;
    },
    {
      granted: 0,
      used: 0,
      reserved: 0,
      converted: 0,
      expired: 0,
      available: 0,
    },
  );
}

function getEligibilityDate(
  input: CalculateEntitlementInput,
): number | undefined {
  switch (input.rules.eligibility.basis) {
    case "hire_date":
      return input.hireDate;
    case "regularization_date":
      return input.regularizationDate;
    case "verified_qualification":
      return input.qualificationDate;
    case "event":
      return input.eventDate;
  }
}

function completedMonthsBetween(startDate: number, endDate: number): number {
  if (endDate < startDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return months;
}

function prorateAnnualUnits(
  annualUnits: number,
  method: LeavePolicyRules["prorationMethod"],
  startDate: number,
  periodEnd: number,
): number {
  if (startDate > periodEnd) return 0;
  switch (method) {
    case "none":
      return annualUnits;
    case "calendar_months":
      return (annualUnits * calendarMonthsInclusive(startDate, periodEnd)) / 12;
    case "actual_days":
      return (
        (annualUnits * (periodEnd - startDate + DAY_IN_MILLISECONDS)) /
        (daysInYear(new Date(periodEnd).getUTCFullYear()) * DAY_IN_MILLISECONDS)
      );
    case "legacy_15th_day":
      return (annualUnits * legacyEligibleMonths(startDate, periodEnd)) / 12;
  }
}

function calendarMonthsInclusive(startDate: number, endDate: number): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth() +
    1
  );
}

function legacyEligibleMonths(startDate: number, endDate: number): number {
  const start = new Date(startDate);
  const firstEligibleMonth =
    start.getUTCDate() <= 15
      ? Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
      : Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return firstEligibleMonth > endDate
    ? 0
    : calendarMonthsInclusive(firstEligibleMonth, endDate);
}

function daysInYear(year: number): number {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}
