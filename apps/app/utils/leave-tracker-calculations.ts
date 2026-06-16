import type { LeaveAccrualFrequency } from "@/utils/leave-policy-calculations";

type LeaveTrackerAccrualInput = {
  total: number;
  accrualMonth: number;
  accrualFrequency?: LeaveAccrualFrequency;
};

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function clampMonth(value: number) {
  return Math.min(12, Math.max(0, value));
}

export function getLeaveTrackerReferenceDate(
  selectedYear: number,
  currentDate: Date = new Date(),
) {
  if (selectedYear === currentDate.getFullYear()) {
    return currentDate.getTime();
  }

  return new Date(selectedYear, 11, 31).getTime();
}

export function getLeaveTrackerAccrualMonth(
  selectedYear: number,
  currentDate: Date = new Date(),
) {
  const currentYear = currentDate.getFullYear();

  if (selectedYear < currentYear) {
    return 12;
  }

  if (selectedYear > currentYear) {
    return 0;
  }

  return currentDate.getMonth() + 1;
}

export function calculateLeaveTrackerAccrual({
  total,
  accrualMonth,
  accrualFrequency = "monthly",
}: LeaveTrackerAccrualInput) {
  const cappedTotal = roundToTwo(Math.max(0, total));
  const monthlyAccrualRaw = cappedTotal / 12;
  let periodAccrualRaw = monthlyAccrualRaw;
  const month = clampMonth(accrualMonth);
  let accruedRaw = monthlyAccrualRaw * month;

  if (accrualFrequency === "semi_annual") {
    periodAccrualRaw = cappedTotal / 2;
    accruedRaw =
      month === 0 ? 0 : month <= 6 ? cappedTotal / 2 : cappedTotal;
  }
  if (accrualFrequency === "annual") {
    periodAccrualRaw = cappedTotal;
    accruedRaw = month === 0 ? 0 : cappedTotal;
  }

  return {
    monthlyAccrual: roundToTwo(monthlyAccrualRaw),
    periodAccrual: roundToTwo(periodAccrualRaw),
    accrued: Math.min(cappedTotal, roundToTwo(accruedRaw)),
  };
}

export function getLeaveTrackerAccrualColumnLabel(
  accrualFrequency: LeaveAccrualFrequency = "monthly",
) {
  if (accrualFrequency === "semi_annual") return "Semi-annual Grant";
  if (accrualFrequency === "annual") return "Annual Grant";
  return "Monthly Accrual";
}
