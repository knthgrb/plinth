import type { LeavePayTreatment } from "@/lib/leave/types";

export interface ResolveLeavePayrollDayInput {
  scheduledMinutes: number;
  leaveMinutes: number;
  payTreatment: LeavePayTreatment;
}

export interface LeavePayrollOccurrenceInput extends ResolveLeavePayrollDayInput {
  leaveRequestId?: string;
  localDate: string;
  isWorkday?: boolean;
}

export interface LeavePayrollDayResolution {
  paidFraction: number;
  unpaidFraction: number;
  requiresBenefitBreakdown?: boolean;
}

export function isMigratedLegacyLeaveRequestForPayroll(input: {
  engineVersion?: number;
  cutoverAt?: number;
  submittedBy?: string;
}): boolean {
  return (
    input.engineVersion === 2 &&
    input.cutoverAt !== undefined &&
    input.submittedBy === undefined
  );
}

export function resolveLeavePayrollDay(
  input: ResolveLeavePayrollDayInput,
): LeavePayrollDayResolution {
  if (
    !Number.isInteger(input.scheduledMinutes) ||
    input.scheduledMinutes <= 0
  ) {
    throw new Error("Leave payroll scheduled minutes must be positive");
  }
  if (!Number.isInteger(input.leaveMinutes) || input.leaveMinutes < 0) {
    throw new Error(
      "Leave payroll minutes must be a non-negative whole number",
    );
  }
  if (input.leaveMinutes > input.scheduledMinutes) {
    throw new Error("Leave minutes cannot exceed scheduled minutes");
  }
  const leaveFraction = input.leaveMinutes / input.scheduledMinutes;
  if (input.payTreatment === "unpaid") {
    return { paidFraction: 0, unpaidFraction: leaveFraction };
  }
  return {
    paidFraction: leaveFraction,
    unpaidFraction: 0,
    ...(input.payTreatment === "statutory_benefit_supported"
      ? { requiresBenefitBreakdown: true }
      : {}),
  };
}
