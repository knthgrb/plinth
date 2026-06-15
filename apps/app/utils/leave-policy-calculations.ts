export type LeaveAccrualFrequency = "monthly" | "semi_annual" | "annual";

type ProrationStartInput = {
  hireDate?: number | null;
  regularizationDate?: number | null;
  referenceDate: number;
  grantLeaveUponRegularization?: boolean;
  paidLeaveRequiresRegularization?: boolean;
};

type AnnualLeaveInput = ProrationStartInput & {
  annualLeave: number;
  proratedLeave?: boolean;
};

type AnniversaryLeaveInput = {
  startDate?: number | null;
  referenceDate: number;
  enabled?: boolean;
  maxDays?: number;
};

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function getAccrualStartMonth(startDate: number) {
  const date = new Date(startDate);
  const month = date.getMonth() + 1;
  return date.getDate() <= 15 ? month : month + 1;
}

export function getCompletedYearsSince(
  startDate: number | null | undefined,
  referenceDate: number,
) {
  if (!startDate) return 0;

  const start = new Date(startDate);
  const end = new Date(referenceDate);
  let years = end.getFullYear() - start.getFullYear();
  const monthDiff = end.getMonth() - start.getMonth();
  const dayDiff = end.getDate() - start.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years -= 1;
  }

  return Math.max(0, years);
}

export function isEligibleForPaidLeave({
  regularizationDate,
  referenceDate,
  paidLeaveRequiresRegularization = false,
}: {
  regularizationDate?: number | null;
  referenceDate: number;
  paidLeaveRequiresRegularization?: boolean;
}) {
  if (!paidLeaveRequiresRegularization) return true;
  return Boolean(regularizationDate && regularizationDate <= referenceDate);
}

export function getLeaveProrationStartDate({
  hireDate,
  regularizationDate,
  referenceDate,
  grantLeaveUponRegularization = true,
  paidLeaveRequiresRegularization = false,
}: ProrationStartInput) {
  if (!hireDate) return undefined;
  if (
    !isEligibleForPaidLeave({
      regularizationDate,
      referenceDate,
      paidLeaveRequiresRegularization,
    })
  ) {
    return undefined;
  }

  return grantLeaveUponRegularization
    ? regularizationDate ?? hireDate
    : hireDate;
}

export function calculateProratedAnnualLeave(
  annualLeave: number,
  startDate: number | null | undefined,
  referenceDate: number,
) {
  if (!startDate) return annualLeave;

  const start = new Date(startDate);
  const reference = new Date(referenceDate);

  if (start.getFullYear() < reference.getFullYear()) {
    return annualLeave;
  }
  if (start.getFullYear() > reference.getFullYear()) {
    return 0;
  }

  const accrualStartMonth = getAccrualStartMonth(startDate);
  if (accrualStartMonth > 12) {
    return 0;
  }

  const monthsRemaining = 13 - accrualStartMonth;
  return roundToTwo((annualLeave / 12) * monthsRemaining);
}

export function calculateAnnualLeaveBase({
  annualLeave,
  hireDate,
  regularizationDate,
  referenceDate,
  proratedLeave = true,
  grantLeaveUponRegularization = true,
  paidLeaveRequiresRegularization = false,
}: AnnualLeaveInput) {
  const startDate = getLeaveProrationStartDate({
    hireDate,
    regularizationDate,
    referenceDate,
    grantLeaveUponRegularization,
    paidLeaveRequiresRegularization,
  });

  if (!startDate) return 0;
  return proratedLeave
    ? calculateProratedAnnualLeave(annualLeave, startDate, referenceDate)
    : roundToTwo(annualLeave);
}

export function calculateAnniversaryLeave({
  startDate,
  referenceDate,
  enabled = true,
  maxDays = 15,
}: AnniversaryLeaveInput) {
  if (!enabled) return 0;
  return Math.min(Math.max(0, maxDays), getCompletedYearsSince(startDate, referenceDate));
}

export function getConvertibleLeaveDays(totalLeave: number, maxDays = 5) {
  return Math.min(maxDays, Math.max(0, roundToTwo(totalLeave)));
}
