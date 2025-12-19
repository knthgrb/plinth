/**
 * Leave calculation utilities for Convex
 * Handles proration, anniversary leave, and cash conversion
 */

/**
 * Calculate months worked between two dates
 */
export function calculateMonthsWorked(
  startDate: number,
  endDate: number
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const yearsDiff = end.getFullYear() - start.getFullYear();
  const monthsDiff = end.getMonth() - start.getMonth();
  const daysDiff = end.getDate() - start.getDate();

  let totalMonths = yearsDiff * 12 + monthsDiff;

  // Add partial month based on days
  if (daysDiff >= 0) {
    const daysInMonth = new Date(
      end.getFullYear(),
      end.getMonth() + 1,
      0
    ).getDate();
    const partialMonth = daysDiff / daysInMonth;
    totalMonths += partialMonth;
  } else {
    // If we haven't reached the same day of month, subtract partial
    const daysInMonth = new Date(
      end.getFullYear(),
      end.getMonth() + 1,
      0
    ).getDate();
    const partialMonth = Math.abs(daysDiff) / daysInMonth;
    totalMonths -= partialMonth;
  }

  return Math.max(0, totalMonths);
}

/**
 * Calculate prorated leave based on months worked
 * Formula: (Total Annual Leave ÷ 12 months) × Months Worked
 */
export function calculateProratedLeave(
  totalAnnualLeave: number,
  startDate: number,
  referenceDate: number = Date.now()
): number {
  const monthsWorked = calculateMonthsWorked(startDate, referenceDate);
  const proratedLeave = (totalAnnualLeave / 12) * monthsWorked;
  // Round to 2 decimal places
  return Math.round(proratedLeave * 100) / 100;
}

/**
 * Calculate years since a date
 */
export function calculateYearsSince(
  startDate: number,
  endDate: number
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  let years = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  // If the anniversary hasn't passed this year, subtract 1
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years--;
  }

  // Calculate partial year
  const nextAnniversary = new Date(start);
  nextAnniversary.setFullYear(end.getFullYear());
  if (nextAnniversary > end) {
    nextAnniversary.setFullYear(end.getFullYear() - 1);
  }
  const daysSinceLastAnniversary =
    (end.getTime() - nextAnniversary.getTime()) / (1000 * 60 * 60 * 24);
  const daysInYear = isLeapYear(end.getFullYear()) ? 366 : 365;
  const partialYear = daysSinceLastAnniversary / daysInYear;

  return years + partialYear;
}

/**
 * Check if a year is a leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Calculate anniversary leave
 * Grants 1 additional leave per year from regularization date
 */
export function calculateAnniversaryLeave(
  regularizationDate: number | undefined,
  referenceDate: number = Date.now()
): number {
  if (!regularizationDate) {
    return 0;
  }

  const yearsSinceReg = calculateYearsSince(regularizationDate, referenceDate);
  // Grant 1 leave per full year (rounded down)
  return Math.floor(yearsSinceReg);
}

/**
 * Get the number of convertible leave days
 * First 5 leaves are convertible to cash
 */
export function getConvertibleLeaveDays(totalLeave: number): number {
  return Math.min(5, Math.max(0, totalLeave));
}

/**
 * Calculate total leave entitlement including proration and anniversary leave
 */
export function calculateTotalLeaveEntitlement(
  annualLeave: number,
  hireDate: number,
  regularizationDate: number | undefined,
  referenceDate: number = Date.now()
): {
  proratedLeave: number;
  anniversaryLeave: number;
  totalEntitlement: number;
} {
  const proratedLeave = calculateProratedLeave(
    annualLeave,
    hireDate,
    referenceDate
  );
  const anniversaryLeave = calculateAnniversaryLeave(
    regularizationDate,
    referenceDate
  );
  const totalEntitlement = proratedLeave + anniversaryLeave;

  return {
    proratedLeave,
    anniversaryLeave,
    totalEntitlement,
  };
}
