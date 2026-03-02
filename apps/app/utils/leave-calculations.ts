/**
 * Leave calculation utilities for proration, anniversary leave, and cash conversion
 */

/**
 * Calculate prorated leave based on months worked
 * Formula: (Total Annual Leave ÷ 12 months) × Months Worked
 *
 * @param totalAnnualLeave - Total annual leave entitlement (default: 8 days)
 * @param startDate - Employee hire date or regularization date (timestamp)
 * @param referenceDate - Reference date for calculation (default: current date)
 * @returns Prorated leave days (rounded up)
 */
export function calculateProratedLeave(
  totalAnnualLeave: number = 8,
  startDate: number,
  referenceDate: number = Date.now()
): number {
  const start = new Date(startDate);
  const reference = new Date(referenceDate);

  // Calculate months worked
  const monthsWorked = calculateMonthsWorked(start, reference);

  // Calculate prorated leave: (Total Annual Leave ÷ 12) × Months Worked
  const proratedLeave = (totalAnnualLeave / 12) * monthsWorked;

  // Round up to nearest whole day
  return Math.ceil(proratedLeave * 100) / 100; // Keep 2 decimal places, but round up
}

/**
 * Calculate months worked between two dates
 * Uses the actual calendar months, not just 30-day periods
 */
export function calculateMonthsWorked(startDate: Date, endDate: Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Calculate the difference in years and months
  const yearsDiff = end.getFullYear() - start.getFullYear();
  const monthsDiff = end.getMonth() - start.getMonth();
  const daysDiff = end.getDate() - start.getDate();

  // Total months = years * 12 + months
  // If the day of month has passed, count as full month
  let totalMonths = yearsDiff * 12 + monthsDiff;

  // If the day hasn't been reached yet this month, don't count it as a full month
  // But if it's the same day or later, count it
  if (daysDiff < 0) {
    // We're in the same month but before the start day
    // Count partial month based on days
    const daysInMonth = new Date(
      end.getFullYear(),
      end.getMonth() + 1,
      0
    ).getDate();
    const partialMonth = daysDiff / daysInMonth;
    totalMonths += partialMonth;
  } else {
    // Count current month if we're on or past the start day
    // For proration, we typically count full months only, but include partial
    const daysInMonth = new Date(
      end.getFullYear(),
      end.getMonth() + 1,
      0
    ).getDate();
    const partialMonth = daysDiff / daysInMonth;
    totalMonths += partialMonth;
  }

  // Ensure at least 0 months
  return Math.max(0, totalMonths);
}

/**
 * Calculate anniversary leave
 * Grants 1 additional leave per year from regularization date
 *
 * @param regularizationDate - Date of regularization (timestamp)
 * @param referenceDate - Reference date for calculation (default: current date)
 * @returns Number of anniversary leave days earned
 */
export function calculateAnniversaryLeave(
  regularizationDate: number | undefined,
  referenceDate: number = Date.now()
): number {
  if (!regularizationDate) {
    return 0; // No anniversary leave if not regularized
  }

  const regDate = new Date(regularizationDate);
  const refDate = new Date(referenceDate);

  // Calculate years since regularization
  const yearsSinceReg = calculateYearsSince(regDate, refDate);

  // Grant 1 leave per year (rounded down - only full years count)
  return Math.floor(yearsSinceReg);
}

/**
 * Calculate years between two dates
 */
export function calculateYearsSince(startDate: Date, endDate: Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  let years = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  // If the anniversary hasn't passed this year, subtract 1
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years--;
  }

  // Calculate partial year for more accurate calculation
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
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Get the number of convertible leave days
 * First 5 leaves are convertible to cash
 *
 * @param totalLeave - Total leave balance
 * @returns Number of convertible days (max 5)
 */
export function getConvertibleLeaveDays(totalLeave: number): number {
  return Math.min(5, Math.max(0, totalLeave));
}

/**
 * Calculate total leave entitlement including proration and anniversary leave
 *
 * @param annualLeave - Annual leave entitlement (default: 8)
 * @param hireDate - Employee hire date
 * @param regularizationDate - Employee regularization date (optional)
 * @param referenceDate - Reference date for calculation
 * @returns Object with prorated leave and anniversary leave
 */
export function calculateTotalLeaveEntitlement(
  annualLeave: number = 8,
  hireDate: number,
  regularizationDate: number | undefined,
  referenceDate: number = Date.now()
): {
  proratedLeave: number;
  anniversaryLeave: number;
  totalEntitlement: number;
} {
  // Calculate prorated leave based on hire date
  const proratedLeave = calculateProratedLeave(
    annualLeave,
    hireDate,
    referenceDate
  );

  // Calculate anniversary leave based on regularization date
  const anniversaryLeave = calculateAnniversaryLeave(
    regularizationDate,
    referenceDate
  );

  // Total entitlement = prorated leave + anniversary leave
  const totalEntitlement = proratedLeave + anniversaryLeave;

  return {
    proratedLeave,
    anniversaryLeave,
    totalEntitlement,
  };
}

/**
 * Quick reference table for prorated leave (8 days annual)
 * Returns the prorated leave for a given number of months
 */
export function getProratedLeaveTable(
  annualLeave: number = 8
): Map<number, number> {
  const table = new Map<number, number>();
  for (let months = 1; months <= 12; months++) {
    const prorated = (annualLeave / 12) * months;
    // Round up to nearest whole day for display
    table.set(months, Math.ceil(prorated * 100) / 100);
  }
  return table;
}

