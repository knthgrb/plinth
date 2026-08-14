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
const MANILA_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1000;

interface ManilaCalendarDate {
  year: number;
  monthIndex: number;
  day: number;
}

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
  const eligibleFrom =
    eligibilityDate === undefined
      ? undefined
      : addManilaCalendarMonths(
          eligibilityDate,
          rules.eligibility.completedServiceMonths,
        );
  if (
    eligibleFrom === undefined ||
    compareManilaCalendarDates(input.asOf, eligibleFrom) < 0
  ) {
    return 0;
  }

  const entitlement = prorateAnnualUnits(
    rules.annualUnits,
    rules.prorationMethod,
    Math.max(input.periodStart, eligibleFrom),
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
          projection.used -= entry.amount;
          break;
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

function prorateAnnualUnits(
  annualUnits: number,
  method: LeavePolicyRules["prorationMethod"],
  startDate: number,
  periodEnd: number,
): number {
  if (compareManilaCalendarDates(startDate, periodEnd) > 0) return 0;
  switch (method) {
    case "none":
      return annualUnits;
    case "calendar_months":
      return (annualUnits * calendarMonthsInclusive(startDate, periodEnd)) / 12;
    case "actual_days":
      return (
        (annualUnits * manilaCalendarDaysInclusive(startDate, periodEnd)) /
        daysInYear(getManilaCalendarDate(periodEnd).year)
      );
    case "legacy_15th_day":
      return (annualUnits * legacyEligibleMonths(startDate, periodEnd)) / 12;
  }
}

function calendarMonthsInclusive(startDate: number, endDate: number): number {
  const start = getManilaCalendarDate(startDate);
  const end = getManilaCalendarDate(endDate);
  return (
    (end.year - start.year) * 12 + end.monthIndex - start.monthIndex + 1
  );
}

function legacyEligibleMonths(startDate: number, endDate: number): number {
  const start = getManilaCalendarDate(startDate);
  const firstEligibleMonth =
    start.day <= 15
      ? toManilaMidnight({ ...start, day: 1 })
      : toManilaMidnight({
          year: start.monthIndex === 11 ? start.year + 1 : start.year,
          monthIndex: (start.monthIndex + 1) % 12,
          day: 1,
        });
  return compareManilaCalendarDates(firstEligibleMonth, endDate) > 0
    ? 0
    : calendarMonthsInclusive(firstEligibleMonth, endDate);
}

function addManilaCalendarMonths(timestamp: number, months: number): number {
  const date = getManilaCalendarDate(timestamp);
  const monthOffset = date.monthIndex + months;
  const year = date.year + Math.floor(monthOffset / 12);
  const monthIndex = monthOffset % 12;
  return toManilaMidnight({
    year,
    monthIndex,
    day: Math.min(date.day, daysInMonth(year, monthIndex)),
  });
}

function compareManilaCalendarDates(left: number, right: number): number {
  const leftDate = getManilaCalendarDate(left);
  const rightDate = getManilaCalendarDate(right);
  return (
    Date.UTC(leftDate.year, leftDate.monthIndex, leftDate.day) -
    Date.UTC(rightDate.year, rightDate.monthIndex, rightDate.day)
  );
}

function manilaCalendarDaysInclusive(startDate: number, endDate: number): number {
  return (
    compareManilaCalendarDates(endDate, startDate) / DAY_IN_MILLISECONDS + 1
  );
}

function getManilaCalendarDate(timestamp: number): ManilaCalendarDate {
  const shiftedDate = new Date(timestamp + MANILA_OFFSET_MILLISECONDS);
  return {
    year: shiftedDate.getUTCFullYear(),
    monthIndex: shiftedDate.getUTCMonth(),
    day: shiftedDate.getUTCDate(),
  };
}

function toManilaMidnight(date: ManilaCalendarDate): number {
  return (
    Date.UTC(date.year, date.monthIndex, date.day) -
    MANILA_OFFSET_MILLISECONDS
  );
}

function daysInMonth(year: number, monthIndex: number): number {
  if (monthIndex === 1) return daysInYear(year) === 366 ? 29 : 28;
  return [3, 5, 8, 10].includes(monthIndex) ? 30 : 31;
}

function daysInYear(year: number): number {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
}
