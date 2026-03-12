import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  getSSSContribution,
  getSSSContributionByEmployeeDeduction,
} from "./sss";
import { calculatePayrollBaseFromRecords } from "@/lib/payroll-calculations";

function buildDraftPayrollConfig(args: {
  employeeIds: any[];
  manualDeductions?: any[];
  incentives?: any[];
  governmentDeductionSettings?: any[];
}) {
  return {
    employeeIds: args.employeeIds,
    manualDeductions: args.manualDeductions,
    incentives: args.incentives,
    governmentDeductionSettings: args.governmentDeductionSettings,
  };
}

function getDeductionAmountByNames(
  deductions: Array<{ name: string; amount: number }>,
  names: string[],
): number {
  return deductions.reduce((sum, deduction) => {
    return names.includes((deduction.name || "").toLowerCase())
      ? sum + (deduction.amount ?? 0)
      : sum;
  }, 0);
}

/** Round to 2 decimal places for currency */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deriveAccountingCostItemStatus(
  amount: number,
  amountPaid: number,
): "pending" | "partial" | "paid" {
  if (amountPaid <= 0) return "pending";
  if (amountPaid >= amount) return "paid";
  return "partial";
}

// Helper to check authorization with organization context
// Allows admin, hr, and accounting roles for payroll access
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr" | "accounting",
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  // Check user's role in the specific organization
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId),
    )
    .first();

  // Fallback to legacy organizationId/role fields for backward compatibility
  let userRole: string | undefined = userOrg?.role;
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);

  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }

  // Use legacy role if userOrg doesn't exist
  if (!userRole && userRecord.organizationId === organizationId) {
    userRole = userRecord.role;
  }

  // For payroll: allow admin, hr, and accounting roles
  const allowedRoles = ["owner", "admin", "hr", "accounting"];
  if (requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized");
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Helper to get day name from date (lowercase)
function getDayName(date: number): string {
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const dateObj = new Date(date);
  return dayNames[dateObj.getDay()];
}

// Helper to check if a date is a rest day for an employee.
// Uses the employee's scheduled work days: only returns true when that day is
// explicitly a non-workday (e.g. Saturday/Sunday). Work on such days is rest day OT.
// If schedule is missing or the day key is missing, we treat as work day (return false)
// so we never add rest day pay by mistake.
function isRestDay(date: number, employeeSchedule: any): boolean {
  if (!employeeSchedule?.defaultSchedule) return false;
  const dayName = getDayName(date);
  const daySchedule =
    employeeSchedule.defaultSchedule[
      dayName as keyof typeof employeeSchedule.defaultSchedule
    ];
  if (!daySchedule || typeof daySchedule.isWorkday !== "boolean") return false;

  // Check if there's a schedule override for this date
  if (employeeSchedule.scheduleOverrides) {
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) =>
        new Date(o.date).toDateString() === new Date(date).toDateString(),
    );
    if (override) {
      // If there's an override, it's not a rest day (override means working)
      return false;
    }
  }

  // If isWorkday is false, it's a rest day
  return !daySchedule.isWorkday;
}

// Helper to calculate working days in the month for an employee based on their schedule
// This lets us derive the divisor dynamically instead of hardcoding /26.
function getWorkingDaysInMonth(
  referenceDate: number,
  employeeSchedule: any,
): number {
  const dateObj = new Date(referenceDate);
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth(); // 0-based

  // Get number of days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const current = new Date(year, month, day);
    const currentTs = current.getTime();

    // If this date is not a rest day for the employee, count it as a working day
    if (!isRestDay(currentTs, employeeSchedule)) {
      workingDays++;
    }
  }

  // Fallback safeguard: if for some reason schedule marks everything as rest day,
  // default to 26 to avoid division by zero.
  return workingDays > 0 ? workingDays : 26;
}

// Helper to calculate working days in a specific cutoff range (inclusive)
function getWorkingDaysInRange(
  startDate: number,
  endDate: number,
  employeeSchedule: any,
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  let workingDays = 0;
  const current = new Date(start);

  while (current <= end) {
    const ts = current.getTime();
    if (!isRestDay(ts, employeeSchedule)) {
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

// Options for daily rate calculation (from org payroll settings).
export type DailyRateOptions = {
  includeAllowance: boolean;
  workingDaysPerYear: number;
};

// Helper to get per-day rate based on salary type.
// Monthly: (basic + allowance if enabled) × (12 / workingDaysPerYear). E.g. 24k + 6k with 261 → 30k × (12/261).
// - monthly: uses options.workingDaysPerYear (e.g. 261) and options.includeAllowance for allowance
// - daily:   basicSalary is already the per-day rate
// - hourly:  approximate daily rate as hourly * 8
function getDailyRateForEmployee(
  employee: any,
  cutoffStart: number,
  cutoffEnd: number,
  options?: DailyRateOptions,
): number {
  const salaryType = employee.compensation.salaryType || "monthly";
  const basicSalary = employee.compensation.basicSalary || 0;
  const allowance = employee.compensation.allowance ?? 0;

  if (salaryType === "daily") {
    return basicSalary;
  }

  if (salaryType === "hourly") {
    return basicSalary * 8;
  }

  // Monthly: (basic + allowance if included) × (12 / workingDaysPerYear)
  if (options) {
    const monthlyBase =
      basicSalary + (options.includeAllowance ? allowance : 0);
    return monthlyBase * (12 / options.workingDaysPerYear);
  }

  // Legacy when no options: basic only, 22 working days
  return basicSalary / 22;
}

// Government contributions (monthly amounts).
const PHILHEALTH_EMPLOYEE_MONTHLY = 500;
const PHILHEALTH_EMPLOYER_MONTHLY = 500;
const PAGIBIG_EMPLOYEE_MONTHLY = 200;
const PAGIBIG_EMPLOYER_MONTHLY = 200;

type PayFrequency = "monthly" | "bimonthly";
type DeductionFrequency = "full" | "half";
type HolidayType = "regular" | "special" | "special_working";

/**
 * TRAIN Law individual income tax table (2025 rates).
 * Taxable income = gross income - mandatory contributions (SSS, PhilHealth, Pag-IBIG).
 * First 250,000 exempt; 13th month & benefits exempt up to 90,000.
 */
function computeAnnualTaxFromBasic(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 250_000) return 0;
  if (annualTaxableIncome <= 400_000) {
    return 0.2 * (annualTaxableIncome - 250_000);
  }
  if (annualTaxableIncome <= 800_000) {
    return 30_000 + 0.25 * (annualTaxableIncome - 400_000);
  }
  if (annualTaxableIncome <= 2_000_000) {
    return 130_000 + 0.3 * (annualTaxableIncome - 800_000);
  }
  if (annualTaxableIncome <= 8_000_000) {
    return 490_000 + 0.32 * (annualTaxableIncome - 2_000_000);
  }
  return 2_410_000 + 0.35 * (annualTaxableIncome - 8_000_000);
}

/** Resolve organization pay frequency with sensible default (bimonthly). */
function getOrganizationPayFrequency(
  org: any | null | undefined,
): PayFrequency {
  const freq = org?.salaryPaymentFrequency;
  return freq === "monthly" || freq === "bimonthly" ? freq : "bimonthly";
}

/** Split a monthly amount per cutoff, honoring org + per-employee frequency. */
function getPerCutoffAmount(
  monthlyAmount: number,
  orgFrequency: PayFrequency,
  perEmployeeFrequency?: DeductionFrequency,
): number {
  const effective: DeductionFrequency =
    perEmployeeFrequency ?? (orgFrequency === "bimonthly" ? "half" : "full");
  return effective === "half" ? monthlyAmount / 2 : monthlyAmount;
}

/** Government deductions (SSS, PhilHealth, Pag-IBIG) are taken once per month (full monthly amount). For semi-monthly, apply only on the first cutoff of the month. */
function getGovDeductionAmount(
  monthlyAmount: number,
  cutoffStart: number,
  payFrequency: PayFrequency,
): number {
  if (payFrequency === "monthly") return monthlyAmount;
  const dayOfMonth = new Date(cutoffStart).getDate();
  return dayOfMonth <= 15 ? monthlyAmount : 0;
}

/** Tax deduction uses payroll settings: once_per_month = full on selected pay; twice_per_month = half on each pay. */
function getTaxDeductionAmount(
  monthlyTax: number,
  cutoffStart: number,
  payFrequency: PayFrequency,
  taxDeductionFrequency: "once_per_month" | "twice_per_month",
  taxDeductOnPay: "first" | "second",
): number {
  if (payFrequency === "monthly") return monthlyTax;
  const dayOfMonth = new Date(cutoffStart).getDate();
  const isFirstPay = dayOfMonth <= 15;

  if (taxDeductionFrequency === "twice_per_month") {
    return round2(monthlyTax / 2);
  }
  // once_per_month: full tax on selected pay only
  if (taxDeductOnPay === "first") {
    return isFirstPay ? monthlyTax : 0;
  }
  return isFirstPay ? 0 : monthlyTax;
}

// Default OT/holiday rates (used when org settings not set)
const DEFAULT_REGULAR_OT = 1.25;
const DEFAULT_SPECIAL_HOLIDAY_OT = 1.69;
const DEFAULT_REGULAR_HOLIDAY_OT = 2.0;
const DEFAULT_REST_DAY_OT = 1.69;
const DEFAULT_NIGHT_DIFF_RATE = 0.1;

const DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR = 261;

export type PayrollRates = {
  regularOt: number;
  specialHolidayOt: number;
  regularHolidayOt: number;
  restDayOt: number;
  nightDiffRate: number;
  dailyRateIncludesAllowance: boolean;
  dailyRateWorkingDaysPerYear: number;
  regularHolidayRate: number;
  specialHolidayRate: number;
};

/** Load tax deduction settings from organization (default: twice_per_month, first). */
async function getTaxDeductionSettings(
  ctx: any,
  organizationId: any,
): Promise<{
  taxDeductionFrequency: "once_per_month" | "twice_per_month";
  taxDeductOnPay: "first" | "second";
}> {
  const settings = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .first();
  const ps = settings?.payrollSettings;
  return {
    taxDeductionFrequency:
      ps?.taxDeductionFrequency ?? "twice_per_month",
    taxDeductOnPay: ps?.taxDeductOnPay ?? "first",
  };
}

/** Load payroll rates from organization settings (with defaults). */
async function getPayrollRates(
  ctx: any,
  organizationId: any,
): Promise<PayrollRates> {
  const settings = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .first();
  const ps = settings?.payrollSettings;
  return {
    regularOt: ps?.overtimeRegularRate ?? DEFAULT_REGULAR_OT,
    specialHolidayOt: ps?.specialHolidayOtRate ?? DEFAULT_SPECIAL_HOLIDAY_OT,
    regularHolidayOt: ps?.regularHolidayOtRate ?? DEFAULT_REGULAR_HOLIDAY_OT,
    restDayOt: ps?.overtimeRestDayRate ?? DEFAULT_REST_DAY_OT,
    nightDiffRate: ps?.nightDiffPercent ?? DEFAULT_NIGHT_DIFF_RATE,
    dailyRateIncludesAllowance: ps?.dailyRateIncludesAllowance ?? true,
    dailyRateWorkingDaysPerYear:
      ps?.dailyRateWorkingDaysPerYear ??
      DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR,
    regularHolidayRate: ps?.regularHolidayRate ?? 2.0,
    specialHolidayRate: ps?.specialHolidayRate ?? 1.3,
  };
}

/**
 * Merge organization payroll settings with employee-specific compensation overrides.
 */
function getEmployeePayrollRates(
  employee: any,
  organizationRates: PayrollRates,
): PayrollRates & {
  regularHolidayRate: number;
  specialHolidayRate: number;
} {
  const compensation = employee.compensation || {};
  let regularHolidayRate =
    compensation.regularHolidayRate ?? organizationRates.regularHolidayRate;
  let specialHolidayRate =
    compensation.specialHolidayRate ?? organizationRates.specialHolidayRate;
  // Backward compatibility: legacy "additional" values (1.0=100% add, 0.3=30% add) → actual rates (2.0, 1.3)
  if (regularHolidayRate <= 1.5) regularHolidayRate = 2.0;
  if (specialHolidayRate <= 0.5) specialHolidayRate = 1.3;
  regularHolidayRate = Math.max(regularHolidayRate, 1.0);

  return {
    ...organizationRates,
    regularOt:
      compensation.overtimeRegularRate ?? organizationRates.regularOt,
    specialHolidayOt:
      compensation.specialHolidayOtRate ?? organizationRates.specialHolidayOt,
    regularHolidayOt:
      compensation.regularHolidayOtRate ?? organizationRates.regularHolidayOt,
    restDayOt:
      compensation.overtimeRestDayRate ?? organizationRates.restDayOt,
    nightDiffRate:
      compensation.nightDiffPercent ?? organizationRates.nightDiffRate,
    // Legal/regular holidays should never pay less than an additional 100%
    // of the basic daily rate, even if legacy employee data was misconfigured.
    regularHolidayRate,
    specialHolidayRate,
  };
}

function toLocalDayTimestamp(date: number): number {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);
  return dateObj.getTime();
}

function isSameLocalDay(left: number, right: number): boolean {
  return toLocalDayTimestamp(left) === toLocalDayTimestamp(right);
}

function holidayMatchesDate(holiday: any, date: number): boolean {
  // Payroll uses offset date as the holiday date when set
  const effectiveTimestamp = holiday.offsetDate ?? holiday.date;
  const holidayDate = new Date(effectiveTimestamp);
  const targetDate = new Date(date);

  if (holiday.isRecurring) {
    return (
      holidayDate.getMonth() === targetDate.getMonth() &&
      holidayDate.getDate() === targetDate.getDate()
    );
  }

  if (holiday.year != null && holiday.year !== targetDate.getFullYear()) {
    return false;
  }

  return (
    holidayDate.getFullYear() === targetDate.getFullYear() &&
    holidayDate.getMonth() === targetDate.getMonth() &&
    holidayDate.getDate() === targetDate.getDate()
  );
}

function getHolidayInfo(
  date: number,
  holidays: any[],
  attendanceRecord?: any,
): { isHoliday: boolean; holidayType?: HolidayType } {
  // Prefer the encoded attendance holiday classification when present.
  // This keeps payroll aligned with the employee's reviewed attendance record.
  if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
    return {
      isHoliday: true,
      holidayType: attendanceRecord.holidayType,
    };
  }

  const holiday = holidays.find((entry) => holidayMatchesDate(entry, date));
  if (holiday) {
    return {
      isHoliday: true,
      holidayType: holiday.type,
    };
  }

  return { isHoliday: false };
}

function timeStringToMinutes(time: string | undefined): number | null {
  if (!time || typeof time !== "string") return null;
  const [hourPart, minutePart = "0"] = time.trim().split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function getLateHoursFromAttendance(att: {
  actualIn?: string;
  scheduleIn?: string;
  late?: number;
  lateManualOverride?: boolean;
  lunchStart?: string;
}): number {
  if (att.lateManualOverride === true) {
    return (att.late ?? 0) / 60;
  }

  if (att.late !== undefined && att.late !== null) {
    return att.late / 60;
  }

  const scheduleMinutes = timeStringToMinutes(att.scheduleIn);
  const actualMinutes = timeStringToMinutes(att.actualIn);
  if (scheduleMinutes === null || actualMinutes === null) return 0;
  if (att.lunchStart != null) {
    const lunchStartM = timeStringToMinutes(att.lunchStart);
    if (lunchStartM !== null && actualMinutes >= lunchStartM) return 0;
  }
  return Math.max(0, actualMinutes - scheduleMinutes) / 60;
}

function getUndertimeHoursFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  scheduleIn?: string;
  scheduleOut?: string;
  undertime?: number;
  undertimeManualOverride?: boolean;
  lunchStart?: string;
  lunchEnd?: string;
}): number {
  if (att.undertimeManualOverride === true) {
    return att.undertime ?? 0;
  }

  const scheduleOutM = timeStringToMinutes(att.scheduleOut);
  const actualOutM = timeStringToMinutes(att.actualOut);
  if (scheduleOutM === null || actualOutM === null) return 0;

  const lunchStartM = att.lunchStart != null ? timeStringToMinutes(att.lunchStart) : null;
  const lunchEndM = att.lunchEnd != null ? timeStringToMinutes(att.lunchEnd) : null;
  const scheduleInM = timeStringToMinutes(att.scheduleIn);
  const actualInM = timeStringToMinutes(att.actualIn);

  if (
    lunchStartM !== null &&
    lunchEndM !== null &&
    scheduleInM !== null &&
    actualInM !== null &&
    lunchEndM > lunchStartM
  ) {
    const breakMins = lunchEndM - lunchStartM;
    const requiredWorkMins = Math.max(0, scheduleOutM - scheduleInM - breakMins);
    const breakDeducted =
      actualInM >= lunchEndM
        ? 0
        : Math.max(0, Math.min(actualOutM, lunchEndM) - Math.max(actualInM, lunchStartM));
    const actualWorkMins = Math.max(0, actualOutM - actualInM - breakDeducted);
    const undertimeMins = Math.max(0, requiredWorkMins - actualWorkMins);
    return undertimeMins / 60;
  }

  return Math.max(0, scheduleOutM - actualOutM) / 60;
}

function getMonthlyBasicForTax(
  employee: any,
  workingDaysPerYear: number,
): number {
  const salaryType = employee.compensation.salaryType || "monthly";
  const basicSalary = employee.compensation.basicSalary || 0;

  if (salaryType === "monthly") {
    return basicSalary;
  }

  const dailyRateNoAllowance = getDailyRateForEmployee(
    employee,
    0,
    0,
    {
      includeAllowance: false,
      workingDaysPerYear,
    },
  );

  return dailyRateNoAllowance * (workingDaysPerYear / 12);
}

type PayrollBaseResult = {
  basicPay: number;
  daysWorked: number;
  absences: number;
  lateHours: number;
  undertimeHours: number;
  overtimeHours: number;
  holidayPay: number;
  holidayPayType?: "regular" | "special";
  nightDiffPay: number;
  overtimeRegular: number;
  overtimeRestDay: number;
  overtimeRestDayExcess: number;
  overtimeSpecialHoliday: number;
  overtimeSpecialHolidayExcess: number;
  overtimeLegalHoliday: number;
  overtimeLegalHolidayExcess: number;
  lateDeduction: number;
  undertimeDeduction: number;
  absentDeduction: number;
  dailyRate: number;
  hourlyRate: number;
  salaryType: "monthly" | "daily" | "hourly";
  payDivisor: number;
  payrollRates: PayrollRates & {
    regularHolidayRate: number;
    specialHolidayRate: number;
  };
};

async function buildEmployeePayrollBase(
  ctx: any,
  args: {
    employee: any;
    cutoffStart: number;
    cutoffEnd: number;
    payFrequency: PayFrequency;
    payrollRates?: PayrollRates;
    holidays?: any[];
    leaveTypes?: any[];
  },
): Promise<PayrollBaseResult> {
  const { employee, cutoffStart, cutoffEnd, payFrequency } = args;
  const organizationRates =
    args.payrollRates ?? (await getPayrollRates(ctx, employee.organizationId));
  const payrollRates = getEmployeePayrollRates(employee, organizationRates);

  const attendance = await (ctx.db.query("attendance") as any)
    .withIndex("by_employee", (q: any) => q.eq("employeeId", employee._id))
    .collect();

  const holidays =
    args.holidays ??
    (await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId),
      )
      .collect());

  const leaveRequests = await (ctx.db.query("leaveRequests") as any)
    .withIndex("by_employee", (q: any) => q.eq("employeeId", employee._id))
    .collect();
  const approvedLeaves = leaveRequests.filter(
    (leave: any) =>
      leave.status === "approved" &&
      leave.startDate <= cutoffEnd &&
      leave.endDate >= cutoffStart,
  );

  const leaveTypes =
    args.leaveTypes ??
    (await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId),
      )
      .collect());
  return calculatePayrollBaseFromRecords({
    employee,
    cutoffStart,
    cutoffEnd,
    payFrequency,
    payrollRates,
    attendance,
    holidays,
    leaveRequests: approvedLeaves,
    leaveTypes,
  });
}

/**
 * Get total hours worked for a day from attendance (actual in/out minus break).
 * Uses lunchStart/lunchEnd from record when present; else deducts 60 min.
 */
function getHoursWorkedFromAttendance(att: {
  actualIn?: string;
  actualOut?: string;
  scheduleIn?: string;
  scheduleOut?: string;
  status?: string;
  overtime?: number;
  lunchStart?: string;
  lunchEnd?: string;
}): number {
  const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
  if (att.actualIn && att.actualOut) {
    const inMins = timeStringToMinutes(att.actualIn) ?? 0;
    const outMins = timeStringToMinutes(att.actualOut) ?? 0;
    let breakMins = 60;
    if (att.lunchStart != null && att.lunchEnd != null) {
      const ls = timeStringToMinutes(att.lunchStart) ?? 0;
      const le = timeStringToMinutes(att.lunchEnd) ?? 0;
      const overlapStart = Math.max(inMins, ls);
      const overlapEnd = Math.min(outMins, le);
      breakMins = Math.max(0, overlapEnd - overlapStart);
    }
    const workMins = Math.max(0, outMins - inMins - breakMins);
    return workMins / 60;
  }
  return 8 * dayMultiplier + (att.overtime ?? 0);
}

// Compute payroll for employee
export const computeEmployeePayroll = query({
  args: {
    employeeId: v.id("employees"),
    cutoffStart: v.number(),
    cutoffEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    await checkAuth(ctx, employee.organizationId);

    const organization = await ctx.db.get(employee.organizationId);
    const payFrequency: PayFrequency =
      getOrganizationPayFrequency(organization);
    const payrollBase = await buildEmployeePayrollBase(ctx, {
      employee,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      payFrequency,
    });

    // Add incentives
    let incentiveTotal = 0;
    if (employee.incentives) {
      for (const incentive of employee.incentives) {
        if (incentive.isActive) {
          if (incentive.frequency === "monthly") {
            incentiveTotal += getPerCutoffAmount(incentive.amount, payFrequency);
          } else if (incentive.frequency === "per-cutoff") {
            incentiveTotal += incentive.amount;
          }
        }
      }
    }

    // Calculate gross pay (total earnings before any deductions)
    const grossPay =
      payrollBase.basicPay +
      payrollBase.holidayPay +
      payrollBase.nightDiffPay +
      incentiveTotal;

    // Check if employee worked at least 1 day
    const hasWorkedAtLeastOneDay = payrollBase.daysWorked > 0;

    // Government deductions: based on monthly amounts, split per cutoff by pay frequency.
    // Tax uses TRAIN 2025 brackets; taxable income = basic - SSS - PhilHealth - Pag-IBIG.
    const monthlyBasicForTax = getMonthlyBasicForTax(
      employee,
      payrollBase.payrollRates.dailyRateWorkingDaysPerYear,
    );

    const sssMonthly = getSSSContribution(monthlyBasicForTax);
    const annualBasic = monthlyBasicForTax * 12;
    const annualSSS = sssMonthly.employeeShare * 12;
    const annualPhilhealth = PHILHEALTH_EMPLOYEE_MONTHLY * 12;
    const annualPagibig = PAGIBIG_EMPLOYEE_MONTHLY * 12;
    const annualTaxableIncome = Math.max(
      0,
      annualBasic - annualSSS - annualPhilhealth - annualPagibig,
    );
    const annualTax = computeAnnualTaxFromBasic(annualTaxableIncome);
    const monthlyTax = round2(annualTax / 12);

    const sssAmount = getGovDeductionAmount(
      sssMonthly.employeeShare,
      args.cutoffStart,
      payFrequency,
    );
    const philhealthAmount = getGovDeductionAmount(
      PHILHEALTH_EMPLOYEE_MONTHLY,
      args.cutoffStart,
      payFrequency,
    );
    const pagibigAmount = getGovDeductionAmount(
      PAGIBIG_EMPLOYEE_MONTHLY,
      args.cutoffStart,
      payFrequency,
    );
    const taxSettings = await getTaxDeductionSettings(
      ctx,
      employee.organizationId,
    );
    const withholdingTaxAmount = getTaxDeductionAmount(
      monthlyTax,
      args.cutoffStart,
      payFrequency,
      taxSettings.taxDeductionFrequency,
      taxSettings.taxDeductOnPay,
    );

    // Total deductions = attendance deductions + government deductions + custom deductions
    // If employee didn't work at least 1 day, no government deductions (they'll be pending)
    let totalDeductions =
      payrollBase.lateDeduction +
      payrollBase.undertimeDeduction +
      payrollBase.absentDeduction;
    let pendingDeductions = 0;

    if (hasWorkedAtLeastOneDay) {
      totalDeductions += sssAmount + philhealthAmount + pagibigAmount;
    } else {
      // No deductions if employee didn't work - set as pending for next cutoff
      pendingDeductions = sssAmount + philhealthAmount + pagibigAmount;
    }

    // Add custom deductions
    if (employee.deductions) {
      for (const deduction of employee.deductions) {
        if (deduction.isActive) {
          const now = Date.now();
          if (
            deduction.startDate <= now &&
            (!deduction.endDate || deduction.endDate >= now)
          ) {
            if (deduction.frequency === "monthly") {
              totalDeductions += getPerCutoffAmount(
                deduction.amount,
                payFrequency,
              );
            } else if (deduction.frequency === "per-cutoff") {
              totalDeductions += deduction.amount;
            }
          }
        }
      }
    }

    // Tax: TRAIN 2025 brackets on taxable income (basic - SSS - PhilHealth - Pag-IBIG)
    if (hasWorkedAtLeastOneDay) {
      totalDeductions += withholdingTaxAmount;
    } else {
      pendingDeductions += withholdingTaxAmount;
    }

    // Calculate net pay before applying deduction limits
    let netPay = grossPay - totalDeductions;

    // Deductions cannot exceed net pay (before non-taxable allowance)
    // If deductions exceed net pay, cap them at net pay
    if (totalDeductions > netPay && netPay > 0) {
      // Reduce deductions proportionally or cap at net pay
      // For now, we'll cap total deductions at net pay
      const excessDeductions = totalDeductions - netPay;
      totalDeductions = netPay;
      // Add excess to pending deductions
      pendingDeductions += excessDeductions;
      netPay = 0;
    } else if (netPay < 0) {
      // If net pay is negative, all deductions become pending
      pendingDeductions += totalDeductions - grossPay;
      totalDeductions = grossPay;
      netPay = 0;
    }

    return {
      employeeId: args.employeeId,
      period: {
        start: args.cutoffStart,
        end: args.cutoffEnd,
      },
      basicPay: payrollBase.basicPay,
      daysWorked: payrollBase.daysWorked,
      absences: payrollBase.absences,
      lateHours: payrollBase.lateHours,
      undertimeHours: payrollBase.undertimeHours,
      overtimeHours: payrollBase.overtimeHours,
      holidayPay: payrollBase.holidayPay,
      holidayPayType: payrollBase.holidayPayType,
      restDayPay: 0,
      nightDiffPay: payrollBase.nightDiffPay,
      overtimeRegular: payrollBase.overtimeRegular,
      overtimeRestDay: payrollBase.overtimeRestDay,
      overtimeRestDayExcess: payrollBase.overtimeRestDayExcess,
      overtimeSpecialHoliday: payrollBase.overtimeSpecialHoliday,
      overtimeSpecialHolidayExcess: payrollBase.overtimeSpecialHolidayExcess,
      overtimeLegalHoliday: payrollBase.overtimeLegalHoliday,
      overtimeLegalHolidayExcess: payrollBase.overtimeLegalHolidayExcess,
      incentiveTotal,
      grossPay,
      deductions: {
        sss: sssAmount,
        philhealth: philhealthAmount,
        pagibig: pagibigAmount,
        withholdingTax: withholdingTaxAmount,
        custom:
          totalDeductions -
          payrollBase.lateDeduction -
          payrollBase.undertimeDeduction -
          payrollBase.absentDeduction -
          sssAmount -
          philhealthAmount -
          pagibigAmount -
          withholdingTaxAmount,
      },
      totalDeductions,
      netPay,
      pendingDeductions: pendingDeductions > 0 ? pendingDeductions : undefined,
      hasWorkedAtLeastOneDay,
    };
  },
});

// Create payroll run
export const createPayrollRun = mutation({
  args: {
    organizationId: v.id("organizations"),
    cutoffStart: v.number(),
    cutoffEnd: v.number(),
    employeeIds: v.array(v.id("employees")),
    manualDeductions: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          deductions: v.array(
            v.object({
              name: v.string(),
              amount: v.number(),
              type: v.string(),
            }),
          ),
        }),
      ),
    ),
    incentives: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          incentives: v.array(
            v.object({
              name: v.string(),
              amount: v.number(),
              type: v.string(),
            }),
          ),
        }),
      ),
    ),
    governmentDeductionSettings: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          sss: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          pagibig: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          philhealth: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          tax: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
        }),
      ),
    ),
    /** Run-level: enable government deductions for this run. When false, no SSS/PhilHealth/Pag-IBIG/Tax. Override per employee via governmentDeductionSettings. */
    deductionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const organization = await ctx.db.get(args.organizationId);
    const payFrequency: PayFrequency =
      getOrganizationPayFrequency(organization);

    const now = Date.now();
    const startDate = new Date(args.cutoffStart);
    const endDate = new Date(args.cutoffEnd);
    const period = `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;

    const deductionsEnabled = args.deductionsEnabled ?? true;
    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId: args.organizationId,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      period,
      status: "draft",
      processedBy: userRecord._id,
      deductionsEnabled,
      draftConfig: buildDraftPayrollConfig({
        employeeIds: args.employeeIds,
        manualDeductions: args.manualDeductions,
        incentives: args.incentives,
        governmentDeductionSettings: args.governmentDeductionSettings,
      }),
      createdAt: now,
      updatedAt: now,
    });

    const rates = await getPayrollRates(ctx, args.organizationId);
    const taxSettings = await getTaxDeductionSettings(
      ctx,
      args.organizationId,
    );
    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Compute and create payslips for each employee
    for (const employeeId of args.employeeIds) {
      const employee = await ctx.db.get(employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        continue;
      }

      const payrollBase = await buildEmployeePayrollBase(ctx, {
        employee,
        cutoffStart: args.cutoffStart,
        cutoffEnd: args.cutoffEnd,
        payFrequency,
        payrollRates: rates,
        holidays,
        leaveTypes,
      });

      // Get government deduction settings for this employee
      const govSettings = args.governmentDeductionSettings?.find(
        (gs) => gs.employeeId === employeeId,
      );

      // Check if manual deductions are provided for this employee
      const manualDeductionEntry = args.manualDeductions?.find(
        (md) => md.employeeId === employeeId,
      );

      const GOV_DEDUCTION_NAMES_CREATE = new Set([
        "SSS",
        "PhilHealth",
        "Pag-IBIG",
        "Withholding Tax",
      ]);
      // SSS, PhilHealth, Pag-IBIG only - withholding tax follows org settings independently
      const GOV_DEDUCTIONS_EXCEPT_TAX = new Set([
        "SSS",
        "PhilHealth",
        "Pag-IBIG",
      ]);
      const hasOverrideDeductionsCreate =
        manualDeductionEntry?.deductions?.length &&
        manualDeductionEntry.deductions.some((d: { name: string }) =>
          GOV_DEDUCTION_NAMES_CREATE.has(d.name),
        );

      let deductions: Array<{ name: string; amount: number; type: string }> =
        [];

      if (hasOverrideDeductionsCreate) {
        // Manual override: use saved/edited deduction amounts as-is (from "Edit deductions" in preview).
        // Override values for SSS, PhilHealth, Pag-IBIG, Withholding Tax are used directly in computation.
        const nonAttendance = (manualDeductionEntry!.deductions as any[]).filter(
          (d: { name: string }) =>
            d.name !== "Late" &&
            d.name !== "Undertime" &&
            !d.name.startsWith("Absent "),
        );
        // When run has government deductions disabled, exclude SSS/PhilHealth/Pag-IBIG only; withholding tax follows org settings
        deductions =
          deductionsEnabled === false
            ? nonAttendance.filter(
                (d: { name: string }) =>
                  !GOV_DEDUCTIONS_EXCEPT_TAX.has(d.name),
              )
            : [...nonAttendance];
        // Withholding tax follows org settings independently: ensure it's present when it applies (override may not include it)
        const hasTaxInOverride = deductions.some(
          (d) => d.name === "Withholding Tax",
        );
        if (!hasTaxInOverride) {
          const monthlyBasicForTax = getMonthlyBasicForTax(
            employee,
            payrollBase.payrollRates.dailyRateWorkingDaysPerYear,
          );
          const sssContribution = getSSSContribution(monthlyBasicForTax);
          const annualBasic = monthlyBasicForTax * 12;
          const annualSSS = sssContribution.employeeShare * 12;
          const annualPhilhealth = PHILHEALTH_EMPLOYEE_MONTHLY * 12;
          const annualPagibig = PAGIBIG_EMPLOYEE_MONTHLY * 12;
          const annualTaxableIncome = Math.max(
            0,
            annualBasic - annualSSS - annualPhilhealth - annualPagibig,
          );
          const annualTax = computeAnnualTaxFromBasic(annualTaxableIncome);
          const monthlyTax = round2(annualTax / 12);
          const taxAmount = getTaxDeductionAmount(
            monthlyTax,
            args.cutoffStart,
            payFrequency,
            taxSettings.taxDeductionFrequency,
            taxSettings.taxDeductOnPay,
          );
          const taxApplies = taxAmount > 0;
          const taxEnabled =
            !govSettings ? taxApplies : govSettings.tax.enabled && taxApplies;
          if (taxEnabled) {
            deductions.push({
              name: "Withholding Tax",
              amount: taxAmount,
              type: "government",
            });
          }
        }
      } else {
        const monthlyBasicForTax = getMonthlyBasicForTax(
          employee,
          payrollBase.payrollRates.dailyRateWorkingDaysPerYear,
        );

        const sssContribution = getSSSContribution(monthlyBasicForTax);
        const sssEmployeeMonthly = sssContribution.employeeShare;
        const sssEmployerMonthly = sssContribution.employerShare;
        const philhealthEmployeeMonthly = PHILHEALTH_EMPLOYEE_MONTHLY;
        const philhealthEmployerMonthly = PHILHEALTH_EMPLOYER_MONTHLY;
        const pagibigEmployeeMonthly = PAGIBIG_EMPLOYEE_MONTHLY;
        const pagibigEmployerMonthly = PAGIBIG_EMPLOYER_MONTHLY;

        const sssEmployeeAmount = getGovDeductionAmount(
          sssEmployeeMonthly,
          args.cutoffStart,
          payFrequency,
        );
        const philhealthEmployeeAmount = getGovDeductionAmount(
          philhealthEmployeeMonthly,
          args.cutoffStart,
          payFrequency,
        );
        const pagibigEmployeeAmount = getGovDeductionAmount(
          pagibigEmployeeMonthly,
          args.cutoffStart,
          payFrequency,
        );

        // TRAIN: taxable income = gross - mandatory contributions (SSS, PhilHealth, Pag-IBIG)
        const annualBasic = monthlyBasicForTax * 12;
        const annualSSS = sssEmployeeMonthly * 12;
        const annualPhilhealth = philhealthEmployeeMonthly * 12;
        const annualPagibig = pagibigEmployeeMonthly * 12;
        const annualTaxableIncome = Math.max(
          0,
          annualBasic - annualSSS - annualPhilhealth - annualPagibig,
        );
        const annualTax = computeAnnualTaxFromBasic(annualTaxableIncome);
        const monthlyTax = round2(annualTax / 12);

        const taxAmount = getTaxDeductionAmount(
          monthlyTax,
          args.cutoffStart,
          payFrequency,
          taxSettings.taxDeductionFrequency,
          taxSettings.taxDeductOnPay,
        );

        const runDeductionsEnabled = deductionsEnabled;

        // Add SSS, PhilHealth, Pag-IBIG only when run has deductions enabled; per-employee override via govSettings
        if (runDeductionsEnabled) {
          if (govSettings) {
            if (govSettings.sss.enabled) {
              deductions.push({
                name: "SSS",
                amount: sssEmployeeAmount,
                type: "government",
              });
            }
            if (govSettings.philhealth.enabled) {
              deductions.push({
                name: "PhilHealth",
                amount: philhealthEmployeeAmount,
                type: "government",
              });
            }
            if (govSettings.pagibig.enabled) {
              deductions.push({
                name: "Pag-IBIG",
                amount: pagibigEmployeeAmount,
                type: "government",
              });
            }
          } else {
            deductions.push(
              { name: "SSS", amount: sssEmployeeAmount, type: "government" },
              {
                name: "PhilHealth",
                amount: philhealthEmployeeAmount,
                type: "government",
              },
              {
                name: "Pag-IBIG",
                amount: pagibigEmployeeAmount,
                type: "government",
              },
            );
          }
        }

        // Withholding tax follows org settings independently of deductionsEnabled (twice_per_month = both pays; once_per_month = selected pay only; getTaxDeductionAmount returns 0 when not applicable)
        const taxApplies = taxAmount > 0;
        const taxEnabled =
          !govSettings ? taxApplies : govSettings.tax.enabled && taxApplies;
        if (taxEnabled) {
          deductions.push({
            name: "Withholding Tax",
            amount: taxAmount,
            type: "government",
          });
        }

        // Add manual/custom deductions (loans, etc.) - these are separate from government deductions
        if (manualDeductionEntry && manualDeductionEntry.deductions) {
          for (const ded of manualDeductionEntry.deductions) {
            deductions.push(ded);
          }
        }

        // Add employee's custom deductions (loans, etc.)
        if (employee.deductions) {
          for (const deduction of employee.deductions) {
            if (deduction.isActive) {
              const now = Date.now();
              if (
                deduction.startDate <= now &&
                (!deduction.endDate || deduction.endDate >= now)
              ) {
                deductions.push({
                  name: deduction.name,
                  amount:
                    deduction.frequency === "monthly"
                      ? getPerCutoffAmount(deduction.amount, payFrequency)
                      : deduction.amount,
                  type: deduction.type,
                });
              }
            }
          }
        }
      }

      // Add attendance-based deductions to deductions array
      if (payrollBase.lateDeduction > 0) {
        deductions.push({
          name: "Late",
          amount: payrollBase.lateDeduction,
          type: "attendance",
        });
      }
      if (payrollBase.undertimeDeduction > 0) {
        deductions.push({
          name: "Undertime",
          amount: payrollBase.undertimeDeduction,
          type: "attendance",
        });
      }
      if (payrollBase.absentDeduction > 0) {
        deductions.push({
          name: `Absent (${payrollBase.absences} ${payrollBase.absences === 1 ? "day" : "days"})`,
          amount: payrollBase.absentDeduction,
          type: "attendance",
        });
      }

      // Calculate total deductions (government + custom + attendance deductions)
      const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

      // Get incentives for this employee
      const incentiveEntry = args.incentives?.find(
        (inc) => inc.employeeId === employeeId,
      );
      const incentives = incentiveEntry?.incentives || [];
      const totalIncentives = incentives.reduce(
        (sum, inc) => sum + inc.amount,
        0,
      );

      // Non-taxable allowance: monthly value, split by pay frequency
      const nonTaxableAllowance = getPerCutoffAmount(
        employee.compensation.allowance || 0,
        payFrequency,
      );

      // Calculate gross pay (total earnings: basic pay + holiday pay + rest day OT + overtime + incentives)
      const grossPay =
        payrollBase.basicPay +
        payrollBase.holidayPay +
        payrollBase.nightDiffPay +
        totalIncentives;

      // Check if employee worked at least 1 day
      const hasWorkedAtLeastOneDay = payrollBase.daysWorked > 0;

      // Get pending deductions from previous cutoff (same month only)
      // Check if there's a previous payslip in the same month with pending deductions
      const cutoffStartForPending = new Date(args.cutoffStart);
      const currentMonth = cutoffStartForPending.getMonth();
      const currentYear = cutoffStartForPending.getFullYear();

      // Find previous payslips in the same month
      const previousPayslips = await (ctx.db.query("payslips") as any)
        .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
        .collect();

      const sameMonthPreviousPayslips = previousPayslips.filter((p: any) => {
        // Parse period string to get start date
        try {
          const periodParts = p.period.split(" to ");
          if (periodParts.length === 2) {
            const payslipDate = new Date(periodParts[0]);
            return (
              payslipDate.getMonth() === currentMonth &&
              payslipDate.getFullYear() === currentYear &&
              payslipDate < cutoffStartForPending &&
              p.pendingDeductions &&
              p.pendingDeductions > 0
            );
          }
        } catch {
          return false;
        }
        return false;
      });

      // Get the most recent pending deductions from the same month
      let previousPendingDeductions = 0;
      if (sameMonthPreviousPayslips.length > 0) {
        // Sort by period start date (parse from period string)
        sameMonthPreviousPayslips.sort((a: any, b: any) => {
          try {
            const aPeriod = a.period.split(" to ")[0];
            const bPeriod = b.period.split(" to ")[0];
            return new Date(bPeriod).getTime() - new Date(aPeriod).getTime();
          } catch {
            return 0;
          }
        });
        previousPendingDeductions =
          sameMonthPreviousPayslips[0].pendingDeductions || 0;
      }

      // Fixed gov deductions already in array; if employee didn't work, move to pending
      let pendingDeductions = 0;

      if (!hasWorkedAtLeastOneDay) {
        // Sum of government deductions we already pushed (fixed 250 each or half)
        const govTotal = deductions
          .filter(
            (d) =>
              d.name === "SSS" ||
              d.name === "PhilHealth" ||
              d.name === "Pag-IBIG" ||
              d.name === "Withholding Tax",
          )
          .reduce((sum, d) => sum + d.amount, 0);
        pendingDeductions = govTotal;
        deductions = deductions.filter(
          (d) =>
            d.name !== "SSS" &&
            d.name !== "PhilHealth" &&
            d.name !== "Pag-IBIG" &&
            d.name !== "Withholding Tax",
        );
      }

      // Add previous pending deductions to current deductions if employee worked
      if (hasWorkedAtLeastOneDay && previousPendingDeductions > 0) {
        // Add pending deductions from previous cutoff
        deductions.push({
          name: "Pending Deductions (Previous Cutoff)",
          amount: previousPendingDeductions,
          type: "government",
        });
      } else if (previousPendingDeductions > 0) {
        // If still no work, keep it pending
        pendingDeductions += previousPendingDeductions;
      }

      // Recalculate total deductions with updated tax and pending deductions
      const finalTotalDeductions = deductions.reduce(
        (sum, d) => sum + d.amount,
        0,
      );

      // Calculate net pay before applying deduction limits
      let netPay = grossPay + nonTaxableAllowance - finalTotalDeductions;

      // Deductions cannot exceed net pay
      // If deductions exceed net pay, cap them at net pay and add excess to pending
      if (finalTotalDeductions > netPay + nonTaxableAllowance && netPay > 0) {
        const excessDeductions =
          finalTotalDeductions - (netPay + nonTaxableAllowance);
        // Reduce deductions proportionally or cap at net pay
        // For simplicity, we'll add excess to pending
        pendingDeductions += excessDeductions;
        // Remove excess from deductions array
        const pendingDeductionIndex = deductions.findIndex(
          (d) => d.name === "Pending Deductions (Previous Cutoff)",
        );
        if (pendingDeductionIndex >= 0) {
          const pendingAmount = deductions[pendingDeductionIndex].amount;
          if (excessDeductions >= pendingAmount) {
            deductions.splice(pendingDeductionIndex, 1);
          } else {
            deductions[pendingDeductionIndex].amount =
              pendingAmount - excessDeductions;
          }
        }
        netPay = 0;
      } else if (netPay < 0) {
        // If net pay is negative, all deductions become pending
        pendingDeductions +=
          finalTotalDeductions - (grossPay + nonTaxableAllowance);
        // Remove all deductions
        deductions = [];
        netPay = 0;
      }

      const employeeSSSAmount = getDeductionAmountByNames(deductions, ["sss"]);
      const employeePhilhealthAmount = getDeductionAmountByNames(deductions, [
        "philhealth",
      ]);
      const employeePagibigAmount = getDeductionAmountByNames(deductions, [
        "pag-ibig",
        "pagibig",
      ]);
      const employerContributions: {
        sss?: number;
        philhealth?: number;
        pagibig?: number;
      } = {};
      if (employeeSSSAmount > 0) {
        employerContributions.sss = round2(
          getSSSContributionByEmployeeDeduction(employeeSSSAmount).employerShare,
        );
      }
      if (employeePhilhealthAmount > 0) {
        employerContributions.philhealth = round2(employeePhilhealthAmount);
      }
      if (employeePagibigAmount > 0) {
        employerContributions.pagibig = round2(employeePagibigAmount);
      }
      await ctx.db.insert("payslips", {
        organizationId: args.organizationId,
        employeeId,
        payrollRunId,
        period,
        grossPay: round2(grossPay),
        basicPay: round2(payrollBase.basicPay),
        deductions: deductions.map((d) => ({
          ...d,
          amount: round2(d.amount),
        })),
        incentives: incentives.length > 0 ? incentives : undefined,
        nonTaxableAllowance:
          nonTaxableAllowance > 0 ? round2(nonTaxableAllowance) : undefined,
        netPay: round2(netPay),
        daysWorked: payrollBase.daysWorked,
        absences: payrollBase.absences,
        lateHours: payrollBase.lateHours,
        undertimeHours: payrollBase.undertimeHours,
        overtimeHours: payrollBase.overtimeHours,
        holidayPay:
          payrollBase.holidayPay > 0 ? round2(payrollBase.holidayPay) : undefined,
        holidayPayType: payrollBase.holidayPayType,
        nightDiffPay:
          payrollBase.nightDiffPay > 0
            ? round2(payrollBase.nightDiffPay)
            : undefined,
        overtimeRegular:
          payrollBase.overtimeRegular > 0
            ? round2(payrollBase.overtimeRegular)
            : undefined,
        overtimeRestDay:
          payrollBase.overtimeRestDay > 0
            ? round2(payrollBase.overtimeRestDay)
            : undefined,
        overtimeRestDayExcess:
          payrollBase.overtimeRestDayExcess > 0
            ? round2(payrollBase.overtimeRestDayExcess)
            : undefined,
        overtimeSpecialHoliday:
          payrollBase.overtimeSpecialHoliday > 0
            ? round2(payrollBase.overtimeSpecialHoliday)
            : undefined,
        overtimeSpecialHolidayExcess:
          payrollBase.overtimeSpecialHolidayExcess > 0
            ? round2(payrollBase.overtimeSpecialHolidayExcess)
            : undefined,
        overtimeLegalHoliday:
          payrollBase.overtimeLegalHoliday > 0
            ? round2(payrollBase.overtimeLegalHoliday)
            : undefined,
        overtimeLegalHolidayExcess:
          payrollBase.overtimeLegalHolidayExcess > 0
            ? round2(payrollBase.overtimeLegalHolidayExcess)
            : undefined,
        pendingDeductions:
          pendingDeductions > 0 ? round2(pendingDeductions) : undefined,
        hasWorkedAtLeastOneDay,
        employerContributions:
          Object.keys(employerContributions).length > 0
            ? employerContributions
            : undefined,
        createdAt: now,
      });
    }

    // Keep status as "draft" - user can review and finalize later
    // Mark that deductions (gov + attendance) were applied when saving this draft
    await ctx.db.patch(payrollRunId, {
      processedAt: now,
      deductionsEnabled,
      updatedAt: now,
    });

    return payrollRunId;
  },
});

// Update payroll run (only for draft status)
export const updatePayrollRun = mutation({
  args: {
    payrollRunId: v.id("payrollRuns"),
    cutoffStart: v.optional(v.number()),
    cutoffEnd: v.optional(v.number()),
    employeeIds: v.optional(v.array(v.id("employees"))),
    manualDeductions: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          deductions: v.array(
            v.object({
              name: v.string(),
              amount: v.number(),
              type: v.string(),
            }),
          ),
        }),
      ),
    ),
    incentives: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          incentives: v.array(
            v.object({
              name: v.string(),
              amount: v.number(),
              type: v.string(),
            }),
          ),
        }),
      ),
    ),
    governmentDeductionSettings: v.optional(
      v.array(
        v.object({
          employeeId: v.id("employees"),
          sss: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          pagibig: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          philhealth: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
          tax: v.object({
            enabled: v.boolean(),
            frequency: v.union(v.literal("full"), v.literal("half")),
          }),
        }),
      ),
    ),
    deductionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    if (payrollRun.status !== "draft") {
      throw new Error("Can only edit payroll runs in draft status");
    }

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to update payroll run");
    }

    let period = payrollRun.period;
    if (args.cutoffStart || args.cutoffEnd) {
      const startDate = new Date(args.cutoffStart || payrollRun.cutoffStart);
      const endDate = new Date(args.cutoffEnd || payrollRun.cutoffEnd);
      period = `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
    }

    const runDeductionsEnabled =
      args.deductionsEnabled ?? payrollRun.deductionsEnabled ?? true;
    const previousDraftConfig = payrollRun.draftConfig ?? {
      employeeIds: [],
    };
    await ctx.db.patch(args.payrollRunId, {
      cutoffStart: args.cutoffStart ?? payrollRun.cutoffStart,
      cutoffEnd: args.cutoffEnd ?? payrollRun.cutoffEnd,
      period,
      deductionsEnabled: runDeductionsEnabled,
      draftConfig: buildDraftPayrollConfig({
        employeeIds: args.employeeIds ?? previousDraftConfig.employeeIds ?? [],
        manualDeductions:
          args.manualDeductions ?? previousDraftConfig.manualDeductions,
        incentives: args.incentives ?? previousDraftConfig.incentives,
        governmentDeductionSettings:
          args.governmentDeductionSettings ??
          previousDraftConfig.governmentDeductionSettings,
      }),
      updatedAt: Date.now(),
    });

    if (
      args.employeeIds ||
      args.manualDeductions ||
      args.incentives ||
      args.governmentDeductionSettings ||
      args.deductionsEnabled !== undefined
    ) {
      const existingPayslips = await (ctx.db.query("payslips") as any)
        .withIndex("by_payroll_run", (q: any) =>
          q.eq("payrollRunId", args.payrollRunId),
        )
        .collect();
      const existingEmployeeIds = existingPayslips.map((p: any) => p.employeeId);

      for (const payslip of existingPayslips) {
        await ctx.db.delete(payslip._id);
      }

      const employeeIds = args.employeeIds ?? existingEmployeeIds;
      const cutoffStart = args.cutoffStart ?? payrollRun.cutoffStart;
      const cutoffEnd = args.cutoffEnd ?? payrollRun.cutoffEnd;

      const rates = await getPayrollRates(ctx, payrollRun.organizationId);
      const taxSettingsUpdate = await getTaxDeductionSettings(
        ctx,
        payrollRun.organizationId,
      );
      const organizationUpdate = await ctx.db.get(payrollRun.organizationId);
      const payFrequencyUpdate: PayFrequency =
        getOrganizationPayFrequency(organizationUpdate);
      const holidays = await (ctx.db.query("holidays") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", payrollRun.organizationId),
        )
        .collect();
      const leaveTypes = await (ctx.db.query("leaveTypes") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", payrollRun.organizationId),
        )
        .collect();

      for (const employeeId of employeeIds) {
        const employee = (await ctx.db.get(employeeId)) as any;
        if (!employee || employee.organizationId !== payrollRun.organizationId) {
          continue;
        }

        const payrollBase = await buildEmployeePayrollBase(ctx, {
          employee,
          cutoffStart,
          cutoffEnd,
          payFrequency: payFrequencyUpdate,
          payrollRates: rates,
          holidays,
          leaveTypes,
        });

        const govSettings = args.governmentDeductionSettings?.find(
          (gs) => gs.employeeId === employeeId,
        );
        const manualDeductionEntry = args.manualDeductions?.find(
          (md) => md.employeeId === employeeId,
        );
        const GOV_DEDUCTION_NAMES = new Set([
          "SSS",
          "PhilHealth",
          "Pag-IBIG",
          "Withholding Tax",
        ]);
        const GOV_DEDUCTIONS_EXCEPT_TAX_UPDATE = new Set([
          "SSS",
          "PhilHealth",
          "Pag-IBIG",
        ]);
        const hasOverrideDeductions =
          manualDeductionEntry?.deductions?.length &&
          manualDeductionEntry.deductions.some((d: { name: string }) =>
            GOV_DEDUCTION_NAMES.has(d.name),
          );

        let deductions: Array<{ name: string; amount: number; type: string }> =
          [];

        if (hasOverrideDeductions) {
          // Use saved/edited deductions as-is; only refresh attendance-based ones
          const nonAttendance = (manualDeductionEntry!.deductions as any[]).filter(
            (d: { name: string }) =>
              d.name !== "Late" &&
              d.name !== "Undertime" &&
              !d.name.startsWith("Absent "),
          );
          // When run has government deductions disabled, exclude SSS/PhilHealth/Pag-IBIG only; withholding tax follows org settings
          deductions =
            runDeductionsEnabled === false
              ? nonAttendance.filter(
                  (d: { name: string }) =>
                    !GOV_DEDUCTIONS_EXCEPT_TAX_UPDATE.has(d.name),
                )
              : [...nonAttendance];
          // Withholding tax follows org settings independently: ensure it's present when it applies (override may not include it)
          const hasTaxInOverrideUpdate = deductions.some(
            (d) => d.name === "Withholding Tax",
          );
          if (!hasTaxInOverrideUpdate) {
            const monthlyBasicForTaxOverride = getMonthlyBasicForTax(
              employee,
              payrollBase.payrollRates.dailyRateWorkingDaysPerYear,
            );
            const sssContributionOverride = getSSSContribution(
              monthlyBasicForTaxOverride,
            );
            const annualBasicOverride = monthlyBasicForTaxOverride * 12;
            const annualSSSOverride = sssContributionOverride.employeeShare * 12;
            const annualPhilhealthOverride = PHILHEALTH_EMPLOYEE_MONTHLY * 12;
            const annualPagibigOverride = PAGIBIG_EMPLOYEE_MONTHLY * 12;
            const annualTaxableIncomeOverride = Math.max(
              0,
              annualBasicOverride -
                annualSSSOverride -
                annualPhilhealthOverride -
                annualPagibigOverride,
            );
            const annualTaxOverride = computeAnnualTaxFromBasic(
              annualTaxableIncomeOverride,
            );
            const monthlyTaxOverride = round2(annualTaxOverride / 12);
            const taxAmountOverride = getTaxDeductionAmount(
              monthlyTaxOverride,
              cutoffStart,
              payFrequencyUpdate,
              taxSettingsUpdate.taxDeductionFrequency,
              taxSettingsUpdate.taxDeductOnPay,
            );
            const taxAppliesOverride = taxAmountOverride > 0;
            const taxEnabledOverride =
              !govSettings
                ? taxAppliesOverride
                : govSettings.tax.enabled && taxAppliesOverride;
            if (taxEnabledOverride) {
              deductions.push({
                name: "Withholding Tax",
                amount: taxAmountOverride,
                type: "government",
              });
            }
          }
        } else {
          const monthlyBasicForTax = getMonthlyBasicForTax(
            employee,
            payrollBase.payrollRates.dailyRateWorkingDaysPerYear,
          );
          const sssContribution = getSSSContribution(monthlyBasicForTax);

          const sssEmployeeAmount = getGovDeductionAmount(
            sssContribution.employeeShare,
            cutoffStart,
            payFrequencyUpdate,
          );
          const philhealthEmployeeAmount = getGovDeductionAmount(
            PHILHEALTH_EMPLOYEE_MONTHLY,
            cutoffStart,
            payFrequencyUpdate,
          );
          const pagibigEmployeeAmount = getGovDeductionAmount(
            PAGIBIG_EMPLOYEE_MONTHLY,
            cutoffStart,
            payFrequencyUpdate,
          );

          // TRAIN: taxable income = basic - SSS - PhilHealth - Pag-IBIG
          const annualBasic = monthlyBasicForTax * 12;
          const annualSSS = sssContribution.employeeShare * 12;
          const annualPhilhealth = PHILHEALTH_EMPLOYEE_MONTHLY * 12;
          const annualPagibig = PAGIBIG_EMPLOYEE_MONTHLY * 12;
          const annualTaxableIncome = Math.max(
            0,
            annualBasic - annualSSS - annualPhilhealth - annualPagibig,
          );
          const annualTax = computeAnnualTaxFromBasic(annualTaxableIncome);
          const monthlyTax = round2(annualTax / 12);

          const taxAmount = getTaxDeductionAmount(
            monthlyTax,
            cutoffStart,
            payFrequencyUpdate,
            taxSettingsUpdate.taxDeductionFrequency,
            taxSettingsUpdate.taxDeductOnPay,
          );

          if (runDeductionsEnabled) {
            if (govSettings) {
              if (govSettings.sss.enabled) {
                deductions.push({
                  name: "SSS",
                  amount: sssEmployeeAmount,
                  type: "government",
                });
              }
              if (govSettings.philhealth.enabled) {
                deductions.push({
                  name: "PhilHealth",
                  amount: philhealthEmployeeAmount,
                  type: "government",
                });
              }
              if (govSettings.pagibig.enabled) {
                deductions.push({
                  name: "Pag-IBIG",
                  amount: pagibigEmployeeAmount,
                  type: "government",
                });
              }
            } else {
              deductions.push(
                { name: "SSS", amount: sssEmployeeAmount, type: "government" },
                {
                  name: "PhilHealth",
                  amount: philhealthEmployeeAmount,
                  type: "government",
                },
                {
                  name: "Pag-IBIG",
                  amount: pagibigEmployeeAmount,
                  type: "government",
                },
              );
            }
          }

          // Withholding tax follows org settings independently of deductionsEnabled
          const taxAppliesUpdate = taxAmount > 0;
          const taxEnabledUpdate =
            !govSettings
              ? taxAppliesUpdate
              : govSettings.tax.enabled && taxAppliesUpdate;
          if (taxEnabledUpdate) {
            deductions.push({
              name: "Withholding Tax",
              amount: taxAmount,
              type: "government",
            });
          }

          if (manualDeductionEntry?.deductions) {
            deductions.push(...manualDeductionEntry.deductions);
          }

          if (employee.deductions) {
            for (const deduction of employee.deductions) {
              if (!deduction.isActive) continue;
              const now = Date.now();
              if (
                deduction.startDate <= now &&
                (!deduction.endDate || deduction.endDate >= now)
              ) {
                deductions.push({
                  name: deduction.name,
                  amount:
                    deduction.frequency === "monthly"
                      ? getPerCutoffAmount(deduction.amount, payFrequencyUpdate)
                      : deduction.amount,
                  type: deduction.type,
                });
              }
            }
          }
        }

        if (payrollBase.lateDeduction > 0) {
          deductions.push({
            name: "Late",
            amount: payrollBase.lateDeduction,
            type: "attendance",
          });
        }
        if (payrollBase.undertimeDeduction > 0) {
          deductions.push({
            name: "Undertime",
            amount: payrollBase.undertimeDeduction,
            type: "attendance",
          });
        }
        if (payrollBase.absentDeduction > 0) {
          deductions.push({
            name: `Absent (${payrollBase.absences} ${payrollBase.absences === 1 ? "day" : "days"})`,
            amount: payrollBase.absentDeduction,
            type: "attendance",
          });
        }

        const incentives =
          args.incentives?.find((inc) => inc.employeeId === employeeId)
            ?.incentives || [];
        const totalIncentives = incentives.reduce(
          (sum, inc) => sum + inc.amount,
          0,
        );

        const grossPay =
          payrollBase.basicPay +
          payrollBase.holidayPay +
          payrollBase.nightDiffPay +
          totalIncentives;
        const nonTaxableAllowance = getPerCutoffAmount(
          employee.compensation.allowance || 0,
          payFrequencyUpdate,
        );
        const hasWorkedAtLeastOneDay = payrollBase.daysWorked > 0;

        const cutoffStartDate = new Date(cutoffStart);
        const currentMonth = cutoffStartDate.getMonth();
        const currentYear = cutoffStartDate.getFullYear();

        const previousPayslips = await (ctx.db.query("payslips") as any)
          .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
          .collect();

        const sameMonthPreviousPayslips = previousPayslips.filter((p: any) => {
          try {
            const periodParts = p.period.split(" to ");
            if (periodParts.length !== 2) return false;
            const payslipStartDate = new Date(periodParts[0]);
            return (
              payslipStartDate.getMonth() === currentMonth &&
              payslipStartDate.getFullYear() === currentYear &&
              payslipStartDate < cutoffStartDate &&
              p.pendingDeductions &&
              p.pendingDeductions > 0 &&
              p.payrollRunId !== args.payrollRunId
            );
          } catch {
            return false;
          }
        });

        let previousPendingDeductions = 0;
        if (sameMonthPreviousPayslips.length > 0) {
          sameMonthPreviousPayslips.sort((a: any, b: any) => {
            try {
              return (
                new Date(b.period.split(" to ")[0]).getTime() -
                new Date(a.period.split(" to ")[0]).getTime()
              );
            } catch {
              return 0;
            }
          });
          previousPendingDeductions =
            sameMonthPreviousPayslips[0].pendingDeductions || 0;
        }

        let pendingDeductions = 0;
        if (!hasWorkedAtLeastOneDay) {
          const govTotal = deductions
            .filter((d) =>
              ["SSS", "PhilHealth", "Pag-IBIG", "Withholding Tax"].includes(
                d.name,
              ),
            )
            .reduce((sum, d) => sum + d.amount, 0);
          pendingDeductions = govTotal;
          deductions = deductions.filter(
            (d) =>
              !["SSS", "PhilHealth", "Pag-IBIG", "Withholding Tax"].includes(
                d.name,
              ),
          );
        }

        if (hasWorkedAtLeastOneDay && previousPendingDeductions > 0) {
          deductions.push({
            name: "Pending Deductions (Previous Cutoff)",
            amount: previousPendingDeductions,
            type: "government",
          });
        } else if (previousPendingDeductions > 0) {
          pendingDeductions += previousPendingDeductions;
        }

        const finalTotalDeductions = deductions.reduce(
          (sum, d) => sum + d.amount,
          0,
        );
        let netPay = grossPay + nonTaxableAllowance - finalTotalDeductions;

        if (finalTotalDeductions > netPay + nonTaxableAllowance && netPay > 0) {
          const excessDeductions =
            finalTotalDeductions - (netPay + nonTaxableAllowance);
          pendingDeductions += excessDeductions;
          const pendingDeductionIndex = deductions.findIndex(
            (d) => d.name === "Pending Deductions (Previous Cutoff)",
          );
          if (pendingDeductionIndex >= 0) {
            const pendingAmount = deductions[pendingDeductionIndex].amount;
            if (excessDeductions >= pendingAmount) {
              deductions.splice(pendingDeductionIndex, 1);
            } else {
              deductions[pendingDeductionIndex].amount =
                pendingAmount - excessDeductions;
            }
          }
          netPay = 0;
        } else if (netPay < 0) {
          pendingDeductions +=
            finalTotalDeductions - (grossPay + nonTaxableAllowance);
          deductions = [];
          netPay = 0;
        }

        const employeeSSSAmount = getDeductionAmountByNames(deductions, ["sss"]);
        const employeePhilhealthAmount = getDeductionAmountByNames(deductions, [
          "philhealth",
        ]);
        const employeePagibigAmount = getDeductionAmountByNames(deductions, [
          "pag-ibig",
          "pagibig",
        ]);
        const employerContributions: {
          sss?: number;
          philhealth?: number;
          pagibig?: number;
        } = {};
        if (employeeSSSAmount > 0) {
          employerContributions.sss = round2(
            getSSSContributionByEmployeeDeduction(employeeSSSAmount)
              .employerShare,
          );
        }
        if (employeePhilhealthAmount > 0) {
          employerContributions.philhealth = round2(employeePhilhealthAmount);
        }
        if (employeePagibigAmount > 0) {
          employerContributions.pagibig = round2(employeePagibigAmount);
        }

        await ctx.db.insert("payslips", {
          organizationId: payrollRun.organizationId,
          employeeId,
          payrollRunId: args.payrollRunId,
          period,
          grossPay: round2(grossPay),
          basicPay: round2(payrollBase.basicPay),
          deductions: deductions.map((d) => ({
            ...d,
            amount: round2(d.amount),
          })),
          incentives: incentives.length > 0 ? incentives : undefined,
          nonTaxableAllowance:
            nonTaxableAllowance > 0 ? round2(nonTaxableAllowance) : undefined,
          netPay: round2(netPay),
          daysWorked: payrollBase.daysWorked,
          absences: payrollBase.absences,
          lateHours: payrollBase.lateHours,
          undertimeHours: payrollBase.undertimeHours,
          overtimeHours: payrollBase.overtimeHours,
          holidayPay:
            payrollBase.holidayPay > 0
              ? round2(payrollBase.holidayPay)
              : undefined,
          holidayPayType: payrollBase.holidayPayType,
          nightDiffPay:
            payrollBase.nightDiffPay > 0
              ? round2(payrollBase.nightDiffPay)
              : undefined,
          overtimeRegular:
            payrollBase.overtimeRegular > 0
              ? round2(payrollBase.overtimeRegular)
              : undefined,
          overtimeRestDay:
            payrollBase.overtimeRestDay > 0
              ? round2(payrollBase.overtimeRestDay)
              : undefined,
          overtimeRestDayExcess:
            payrollBase.overtimeRestDayExcess > 0
              ? round2(payrollBase.overtimeRestDayExcess)
              : undefined,
          overtimeSpecialHoliday:
            payrollBase.overtimeSpecialHoliday > 0
              ? round2(payrollBase.overtimeSpecialHoliday)
              : undefined,
          overtimeSpecialHolidayExcess:
            payrollBase.overtimeSpecialHolidayExcess > 0
              ? round2(payrollBase.overtimeSpecialHolidayExcess)
              : undefined,
          overtimeLegalHoliday:
            payrollBase.overtimeLegalHoliday > 0
              ? round2(payrollBase.overtimeLegalHoliday)
              : undefined,
          overtimeLegalHolidayExcess:
            payrollBase.overtimeLegalHolidayExcess > 0
              ? round2(payrollBase.overtimeLegalHolidayExcess)
              : undefined,
          pendingDeductions:
            pendingDeductions > 0 ? round2(pendingDeductions) : undefined,
          hasWorkedAtLeastOneDay,
          employerContributions:
            Object.keys(employerContributions).length > 0
              ? employerContributions
              : undefined,
          createdAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});

// Update payroll run status
export const updatePayrollRunStatus = mutation({
  args: {
    payrollRunId: v.id("payrollRuns"),
    status: v.union(
      v.literal("draft"),
      v.literal("finalized"),
      v.literal("paid"),
      v.literal("archived"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to update payroll run status");
    }

    if (payrollRun.status === "finalized" && args.status === "draft") {
      throw new Error(
        "Finalized payroll runs cannot be reverted to draft. Delete the run and create a new one instead.",
      );
    }

    // Remove cost items if archiving after finalize/paid
    if (
      (payrollRun.status === "finalized" || payrollRun.status === "paid") &&
      args.status === "archived"
    ) {
      await deleteExpenseItemsFromPayroll(ctx, payrollRun);
    }

    await ctx.db.patch(args.payrollRunId, {
      status: args.status,
      processedAt:
        args.status === "finalized" ? Date.now() : payrollRun.processedAt,
      updatedAt: Date.now(),
    });

    const updatedRun = await ctx.db.get(args.payrollRunId);

    if (args.status === "finalized") {
      // Total to pay = sum of payslip netPay (same logic as generating payslips)
      await createExpenseItemsFromPayroll(ctx, updatedRun);
    }

    if (args.status === "paid") {
      await markExpenseItemsPaid(ctx, updatedRun);
    }

    return { success: true };
  },
});

// Delete payroll run and related records
export const deletePayrollRun = mutation({
  args: {
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to delete payroll runs");
    }

    // Delete all associated accounting cost items (Payroll, SSS, Pag-IBIG, PhilHealth, Tax) created when this run was finalized
    await deleteExpenseItemsFromPayroll(ctx, payrollRun);

    // Delete payslips
    const payslips = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();
    for (const payslip of payslips) {
      await ctx.db.delete(payslip._id);
    }

    // Delete payroll run
    await ctx.db.delete(args.payrollRunId);
    return { success: true };
  },
});

// Temporary fixer: convert legacy "processing" payroll runs to "draft"
export const normalizeProcessingPayrollRuns = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx) => {
    const runs = await (ctx.db.query("payrollRuns") as any).collect();
    let updated = 0;
    for (const run of runs) {
      if (run.status === "processing") {
        await ctx.db.patch(run._id, { status: "draft", updatedAt: Date.now() });
        updated += 1;
      }
    }
    return { updated };
  },
});

// Helper function to delete expense items created from payroll run
async function deleteExpenseItemsFromPayroll(ctx: any, payrollRun: any) {
  // Format period for expense name matching
  const startDate = new Date(payrollRun.cutoffStart);
  const endDate = new Date(payrollRun.cutoffEnd);
  const periodStr = `${startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const payrollExpenseName = `Payroll - ${periodStr}`;
  const sssExpenseName = `SSS - ${periodStr}`;
  const philhealthExpenseName = `PhilHealth - ${periodStr}`;
  const pagibigExpenseName = `Pag-IBIG - ${periodStr}`;
  const taxDeductionExpenseName = `Tax Employee Deductions - ${periodStr}`;
  // Legacy names (before we merged employee + employer into one line)
  const sssDeductionExpenseName = `SSS Employee Deductions - ${periodStr}`;
  const pagibigDeductionExpenseName = `Pag-IBIG Employee Deductions - ${periodStr}`;
  const philhealthDeductionExpenseName = `PhilHealth Employee Deductions - ${periodStr}`;

  // Get all expense items for this organization
  const existingExpenses = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId),
    )
    .collect();

  // Find and delete matching expense items (new names + legacy names)
  const expensesToDelete = existingExpenses.filter(
    (exp: any) =>
      exp.name === payrollExpenseName ||
      exp.name === sssExpenseName ||
      exp.name === philhealthExpenseName ||
      exp.name === pagibigExpenseName ||
      exp.name === taxDeductionExpenseName ||
      exp.name === sssDeductionExpenseName ||
      exp.name === pagibigDeductionExpenseName ||
      exp.name === philhealthDeductionExpenseName,
  );

  for (const expense of expensesToDelete) {
    await ctx.db.delete(expense._id);
  }
}

// Helper to mark expense items as paid
async function markExpenseItemsPaid(ctx: any, payrollRun: any) {
  const startDate = new Date(payrollRun.cutoffStart);
  const endDate = new Date(payrollRun.cutoffEnd);
  const periodStr = `${startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const names = [
    `Payroll - ${periodStr}`,
    `SSS - ${periodStr}`,
    `Pag-IBIG - ${periodStr}`,
    `PhilHealth - ${periodStr}`,
    `Tax Employee Deductions - ${periodStr}`,
    // Legacy names
    `SSS Contribution - ${periodStr}`,
    `PhilHealth Contribution - ${periodStr}`,
    `Pag-IBIG Contribution - ${periodStr}`,
    `SSS Employee Deductions - ${periodStr}`,
    `Pag-IBIG Employee Deductions - ${periodStr}`,
    `PhilHealth Employee Deductions - ${periodStr}`,
  ];

  const expenses = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId),
    )
    .collect();

  const targets = expenses.filter((exp: any) => names.includes(exp.name));
  for (const exp of targets) {
    await ctx.db.patch(exp._id, {
      status: "paid",
      amountPaid: exp.amount,
      updatedAt: Date.now(),
    });
  }
}

// Helper function to create expense items from payroll run
async function createExpenseItemsFromPayroll(ctx: any, payrollRun: any) {
  // Get all payslips for this payroll run
  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) =>
      q.eq("payrollRunId", payrollRun._id),
    )
    .collect();

  if (payslips.length === 0) return;

  const employees = await Promise.all(
    payslips.map((payslip: any) => ctx.db.get(payslip.employeeId)),
  );
  const employeeNameById = new Map<string, string>();
  employees.forEach((employee: any) => {
    if (!employee) return;
    employeeNameById.set(
      employee._id,
      `${employee.personalInfo?.firstName ?? ""} ${employee.personalInfo?.lastName ?? ""}`.trim(),
    );
  });

  const payslipCount = payslips.length;
  const now = Date.now();
  const EMPLOYEE_CATEGORY_NAME = "Employee Related Cost";

  // Payroll record = total net pay (what we actually pay after absences, gov deductions, etc.)
  const totalNetPay = round2(
    payslips.reduce((sum: number, p: any) => sum + (p.netPay ?? 0), 0),
  );

  // Format period for expense name
  const startDate = new Date(payrollRun.cutoffStart);
  const endDate = new Date(payrollRun.cutoffEnd);
  const periodStr = `${startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} - ${endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const payrollExpenseName = `Payroll - ${periodStr}`;
  const sssExpenseName = `SSS - ${periodStr}`;
  const pagibigExpenseName = `Pag-IBIG - ${periodStr}`;
  const philhealthExpenseName = `PhilHealth - ${periodStr}`;
  const taxDeductionExpenseName = `Tax Employee Deductions - ${periodStr}`;

  const allExistingExpenses = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId),
    )
    .collect();
  const legacyExpenseNames = [
    `SSS Contribution - ${periodStr}`,
    `PhilHealth Contribution - ${periodStr}`,
    `Pag-IBIG Contribution - ${periodStr}`,
    `SSS Employee Deductions - ${periodStr}`,
    `Pag-IBIG Employee Deductions - ${periodStr}`,
    `PhilHealth Employee Deductions - ${periodStr}`,
  ];
  const managedExpenseNames = [
    payrollExpenseName,
    sssExpenseName,
    pagibigExpenseName,
    philhealthExpenseName,
    taxDeductionExpenseName,
    ...legacyExpenseNames,
  ];
  const existingExpenses = allExistingExpenses.filter((expense: any) =>
    managedExpenseNames.includes(expense.name),
  );

  const syncExpenseItem = async (expense: {
    name: string;
    description: string;
    amount: number;
    breakdown?: any;
    notes: string;
  }) => {
    const existingExpense = existingExpenses.find(
      (item: any) => item.name === expense.name,
    );
    const preservedAmountPaid =
      payrollRun.status === "paid"
        ? expense.amount
        : Math.min(existingExpense?.amountPaid ?? 0, expense.amount);
    const nextStatus =
      payrollRun.status === "paid"
        ? "paid"
        : deriveAccountingCostItemStatus(expense.amount, preservedAmountPaid);
    const payload = {
      organizationId: payrollRun.organizationId,
      payrollRunId: payrollRun._id,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: expense.name,
      description: expense.description,
      amount: expense.amount,
      amountPaid: preservedAmountPaid,
      frequency: "one-time" as const,
      status: nextStatus,
      dueDate: undefined,
      breakdown: expense.breakdown,
      notes: expense.notes,
      receipts: existingExpense?.receipts,
      updatedAt: now,
    };

    if (existingExpense) {
      await ctx.db.patch(existingExpense._id, payload);
      return;
    }

    await ctx.db.insert("accountingCostItems", {
      ...payload,
      createdAt: now,
    });
  };

  // Create payroll expense item (Employee Related Cost) — amount = total net pay to pay
  if (totalNetPay > 0) {
    await syncExpenseItem({
      name: payrollExpenseName,
      description: `Total net pay for cutoff period ${payrollRun.period} (${payslipCount} payslip${payslipCount > 1 ? "s" : ""})`,
      amount: totalNetPay,
      breakdown: {
        kind: "payroll",
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          grossPay: payslip.grossPay ?? 0,
          nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
          totalIncentives: (payslip.incentives ?? []).reduce(
            (sum: number, incentive: any) => sum + (incentive?.amount ?? 0),
            0,
          ),
          totalDeductions: (payslip.deductions ?? []).reduce(
            (sum: number, deduction: any) => sum + (deduction?.amount ?? 0),
            0,
          ),
          incentiveItems: (payslip.incentives ?? []).map((incentive: any) => ({
            name: incentive.name,
            amount: incentive.amount ?? 0,
            type: incentive.type,
          })),
          deductionItems: (payslip.deductions ?? []).map((deduction: any) => ({
            name: deduction.name,
            amount: deduction.amount ?? 0,
            type: deduction.type,
          })),
          netPay: payslip.netPay ?? 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. Payslips: ${payslipCount}, Total net pay: ₱${totalNetPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    });
  }

  // Employee deduction expense items: use ONLY amounts from payslips (no fallbacks).
  // This avoids doubled amounts; tax is 0 when taxable income ≤ 250k (TRAIN exemption).
  let totalEmployeeSSS = 0;
  let totalEmployeePagIbig = 0;
  let totalEmployeePhilHealth = 0;
  let totalEmployeeTax = 0;

  let totalSSSEmployer = 0;
  let totalPhilHealthEmployer = 0;
  let totalPagIbigEmployer = 0;
  for (const payslip of payslips) {
    if (payslip.deductions && Array.isArray(payslip.deductions)) {
      for (const deduction of payslip.deductions) {
        const name = (deduction.name || "").toLowerCase();
        const amount = deduction.amount || 0;
        if (name.includes("sss")) {
          totalEmployeeSSS += amount;
        } else if (name.includes("pag-ibig") || name.includes("pagibig")) {
          totalEmployeePagIbig += amount;
        } else if (name.includes("philhealth")) {
          totalEmployeePhilHealth += amount;
        } else if (name.includes("tax") || name.includes("withholding")) {
          totalEmployeeTax += amount;
        }
      }
    }
    totalSSSEmployer += payslip.employerContributions?.sss ?? 0;
    totalPhilHealthEmployer += payslip.employerContributions?.philhealth ?? 0;
    totalPagIbigEmployer += payslip.employerContributions?.pagibig ?? 0;
  }

  const totalSSSForAccounting = round2(totalEmployeeSSS + totalSSSEmployer);
  const totalPhilHealthForAccounting = round2(
    totalEmployeePhilHealth + totalPhilHealthEmployer,
  );
  const totalPagIbigForAccounting = round2(
    totalEmployeePagIbig + totalPagIbigEmployer,
  );

  if (totalEmployeeSSS > 0 || totalSSSEmployer > 0) {
    await syncExpenseItem({
      name: sssExpenseName,
      description: `Total SSS for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalSSSForAccounting,
      breakdown: {
        kind: "contributions",
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
            "sss",
          ]),
          companyAmount: payslip.employerContributions?.sss ?? 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
    });
  }

  if (totalEmployeePagIbig > 0 || totalPagIbigEmployer > 0) {
    await syncExpenseItem({
      name: pagibigExpenseName,
      description: `Total Pag-IBIG for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalPagIbigForAccounting,
      breakdown: {
        kind: "contributions",
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
            "pag-ibig",
            "pagibig",
          ]),
          companyAmount: payslip.employerContributions?.pagibig ?? 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
    });
  }

  if (totalEmployeePhilHealth > 0 || totalPhilHealthEmployer > 0) {
    await syncExpenseItem({
      name: philhealthExpenseName,
      description: `Total PhilHealth for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalPhilHealthForAccounting,
      breakdown: {
        kind: "contributions",
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
            "philhealth",
          ]),
          companyAmount: payslip.employerContributions?.philhealth ?? 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
    });
  }

  if (totalEmployeeTax > 0) {
    await syncExpenseItem({
      name: taxDeductionExpenseName,
      description: `Total Tax employee deductions for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeeTax),
      breakdown: {
        kind: "contributions",
        rows: payslips.map((payslip: any) => ({
          employeeId: payslip.employeeId,
          employeeName: employeeNameById.get(payslip.employeeId) || "Unknown",
          employeeAmount: getDeductionAmountByNames(payslip.deductions ?? [], [
            "withholding tax",
          ]),
          companyAmount: 0,
        })),
      },
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
    });
  }

  const activeExpenseNames = new Set<string>();
  if (totalNetPay > 0) activeExpenseNames.add(payrollExpenseName);
  if (totalEmployeeSSS > 0 || totalSSSEmployer > 0) activeExpenseNames.add(sssExpenseName);
  if (totalEmployeePagIbig > 0 || totalPagIbigEmployer > 0)
    activeExpenseNames.add(pagibigExpenseName);
  if (totalEmployeePhilHealth > 0 || totalPhilHealthEmployer > 0)
    activeExpenseNames.add(philhealthExpenseName);
  if (totalEmployeeTax > 0) activeExpenseNames.add(taxDeductionExpenseName);

  for (const expense of existingExpenses) {
    if (!activeExpenseNames.has(expense.name)) {
      await ctx.db.delete(expense._id);
    }
  }
}

// Get payroll runs
export const getPayrollRuns = query({
  args: {
    organizationId: v.id("organizations"),
    /** Filter by run type. When "13th_month", returns only 13th month runs. */
    runType: v.optional(v.union(v.literal("regular"), v.literal("13th_month"))),
    /** For 13th month: filter by year (e.g. 2025) */
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    let runs = await (ctx.db.query("payrollRuns") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    if (args.runType) {
      runs = runs.filter((r: any) => (r.runType ?? "regular") === args.runType);
    }
    if (args.year != null) {
      runs = runs.filter((r: any) => r.year === args.year);
    }

    runs.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return runs;
  },
});

/** Derive basic pay from a payslip (for legacy payslips without basicPay stored). */
function getBasicPayFromPayslip(p: any): number {
  if (p.basicPay != null && p.basicPay > 0) return p.basicPay;
  const overtime =
    (p.overtimeRegular ?? 0) +
    (p.overtimeRestDay ?? 0) +
    (p.overtimeRestDayExcess ?? 0) +
    (p.overtimeSpecialHoliday ?? 0) +
    (p.overtimeSpecialHolidayExcess ?? 0) +
    (p.overtimeLegalHoliday ?? 0) +
    (p.overtimeLegalHolidayExcess ?? 0);
  const incentives = (p.incentives ?? []).reduce(
    (s: number, i: any) => s + (i.amount ?? 0),
    0,
  );
  return (
    (p.grossPay ?? 0) -
    (p.holidayPay ?? 0) -
    (p.nightDiffPay ?? 0) -
    (p.restDayPay ?? 0) -
    overtime -
    incentives
  );
}

/** Compute 13th month amounts for employees. 13th month = total basic pay for year / 12. */
export const compute13thMonthAmounts = query({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    employeeIds: v.optional(v.array(v.id("employees"))),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);
    return compute13thMonthAmountsInternal(ctx, {
      organizationId: args.organizationId,
      year: args.year,
      employeeIds: args.employeeIds,
    });
  },
});

/** Internal helper: compute 13th month amounts. Used by both query and mutation. */
async function compute13thMonthAmountsInternal(
  ctx: any,
  args: {
    organizationId: any;
    year: number;
    employeeIds?: any[];
  },
): Promise<Array<{ employeeId: any; employee: any; totalBasicPay: number; thirteenthMonthAmount: number }>> {
  const org = await ctx.db.get(args.organizationId);
  const payFrequency = getOrganizationPayFrequency(org);
  const yearStart = new Date(args.year, 0, 1).getTime();
  const yearEnd = new Date(args.year, 11, 31, 23, 59, 59, 999).getTime();

  const employees = await (ctx.db.query("employees") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();

  const employeeIds =
    args.employeeIds && args.employeeIds.length > 0
      ? args.employeeIds
      : employees.map((e: any) => e._id);

  const payrollRuns = await (ctx.db.query("payrollRuns") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();

  const regularRuns = payrollRuns.filter(
    (r: any) => (r.runType ?? "regular") !== "13th_month",
  );
  const runIds = new Set(regularRuns.map((r: any) => r._id));

  const allPayslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();

  const results: Array<{
    employeeId: any;
    employee: any;
    totalBasicPay: number;
    thirteenthMonthAmount: number;
  }> = [];

  const rates = await getPayrollRates(ctx, args.organizationId);
  const holidays = await (ctx.db.query("holidays") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();
  const leaveTypes = await (ctx.db.query("leaveTypes") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", args.organizationId),
    )
    .collect();

  for (const employeeId of employeeIds) {
    const employee = employees.find((e: any) => e._id === employeeId);
    if (!employee) continue;

    let totalBasicPay = 0;

    const empPayslips = allPayslips.filter(
      (p: any) =>
        p.employeeId === employeeId &&
        runIds.has(p.payrollRunId) &&
        (() => {
          const run = regularRuns.find((r: any) => r._id === p.payrollRunId);
          return run && run.cutoffStart >= yearStart && run.cutoffEnd <= yearEnd;
        })(),
    );

    if (empPayslips.length > 0) {
      for (const p of empPayslips) {
        totalBasicPay += Math.max(0, getBasicPayFromPayslip(p));
      }
    } else {
      const cutoffs: { start: number; end: number }[] = [];
      if (payFrequency === "monthly") {
        for (let m = 0; m < 12; m++) {
          cutoffs.push({
            start: new Date(args.year, m, 1).getTime(),
            end: new Date(args.year, m + 1, 0, 23, 59, 59, 999).getTime(),
          });
        }
      } else {
        for (let m = 0; m < 12; m++) {
          cutoffs.push({
            start: new Date(args.year, m, 1).getTime(),
            end: new Date(args.year, m, 15, 23, 59, 59, 999).getTime(),
          });
          cutoffs.push({
            start: new Date(args.year, m, 16).getTime(),
            end: new Date(args.year, m + 1, 0, 23, 59, 59, 999).getTime(),
          });
        }
      }
      for (const { start, end } of cutoffs) {
        if (end > yearEnd) continue;
        const base = await buildEmployeePayrollBase(ctx, {
          employee,
          cutoffStart: start,
          cutoffEnd: end,
          payFrequency,
          payrollRates: rates,
          holidays,
          leaveTypes,
        });
        totalBasicPay += base.basicPay;
      }
    }

    const thirteenthMonthAmount = round2(totalBasicPay / 12);
    results.push({
      employeeId,
      employee,
      totalBasicPay: round2(totalBasicPay),
      thirteenthMonthAmount,
    });
  }

  return results;
}

/** Create a 13th month payroll run. No gov deductions for 13th month (tax exempt up to 90k). */
export const create13thMonthRun = mutation({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    employeeIds: v.array(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const amounts = await compute13thMonthAmountsInternal(ctx, {
      organizationId: args.organizationId,
      year: args.year,
      employeeIds: args.employeeIds,
    });

    const amountMap = new Map(
      amounts.map((a: any) => [a.employeeId, a.thirteenthMonthAmount]),
    );

    const yearStart = new Date(args.year, 0, 1).getTime();
    const yearEnd = new Date(args.year, 11, 31, 23, 59, 59, 999).getTime();

    const now = Date.now();
    const period = `13th Month Pay ${args.year}`;

    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId: args.organizationId,
      cutoffStart: yearStart,
      cutoffEnd: yearEnd,
      period,
      runType: "13th_month",
      year: args.year,
      status: "draft",
      processedBy: userRecord._id,
      deductionsEnabled: false,
      draftConfig: { employeeIds: args.employeeIds },
      createdAt: now,
      updatedAt: now,
    });

    for (const employeeId of args.employeeIds) {
      const amt = amountMap.get(employeeId) ?? 0;
      if (amt <= 0) continue;

      await ctx.db.insert("payslips", {
        organizationId: args.organizationId,
        employeeId,
        payrollRunId,
        period,
        grossPay: amt,
        basicPay: amt,
        deductions: [],
        netPay: amt,
        daysWorked: 0,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: now,
      });
    }

    await ctx.db.patch(payrollRunId, {
      processedAt: now,
      updatedAt: now,
    });

    return payrollRunId;
  },
});

async function computeLeaveConversionAmountsInternal(
  ctx: any,
  args: {
    organizationId: any;
    year: number;
    employeeIds: any[];
  },
) {
    await checkAuth(ctx, args.organizationId);

    const settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const employees = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const employeeIds =
      args.employeeIds ??
      employees.filter((e: any) => e.employment?.status === "active").map((e: any) => e._id);

    const byYear = settings?.leaveTrackerByYear ?? [];
    const yearData = byYear.find((e: any) => e.year === args.year);
    const legacyRows = settings?.leaveTrackerRows ?? [];
    const currentYear = new Date().getFullYear();
    const rowsForYear =
      yearData?.rows ??
      (args.year === currentYear ? legacyRows : []);

    const rowsMap = new Map(
      rowsForYear.map((r: any) => [r.employeeId, r]),
    );

    const annualSil = settings?.annualSil ?? 8;
    const proratedLeave = settings?.proratedLeave !== false;
    const grantLeaveUponRegularization =
      settings?.grantLeaveUponRegularization !== false;
    const maxConvertibleLeaveDays = settings?.maxConvertibleLeaveDays ?? 5;

    const referenceDate = new Date(args.year, 11, 31).getTime();

    function getCompletedYearsSince(startDate: number | undefined, ref: number) {
      if (!startDate) return 0;
      const start = new Date(startDate);
      const end = new Date(ref);
      let years = end.getFullYear() - start.getFullYear();
      const monthDiff = end.getMonth() - start.getMonth();
      const dayDiff = end.getDate() - start.getDate();
      if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years -= 1;
      return Math.max(0, years);
    }

    function getAccrualStartMonth(startDate: number) {
      const date = new Date(startDate);
      const month = date.getMonth() + 1;
      return date.getDate() <= 15 ? month : month + 1;
    }

    function getProratedAnnualSil(
      base: number,
      startDate: number | undefined,
      ref: number,
    ) {
      if (!startDate) return base;
      const start = new Date(startDate);
      const refDate = new Date(ref);
      if (start.getFullYear() < refDate.getFullYear()) return base;
      if (start.getFullYear() > refDate.getFullYear()) return 0;
      const accrualStartMonth = getAccrualStartMonth(startDate);
      if (accrualStartMonth > 12) return 0;
      const monthsRemaining = 13 - accrualStartMonth;
      return Math.round((base / 12) * monthsRemaining * 100) / 100;
    }

    const amounts = await compute13thMonthAmountsInternal(ctx, {
      organizationId: args.organizationId,
      year: args.year,
      employeeIds,
    });

    const workingDaysPerYear = 261;
    const results: Array<{
      employeeId: any;
      employee: any;
      convertibleDays: number;
      dailyRate: number;
      leaveConversionAmount: number;
    }> = [];

    for (const empId of employeeIds) {
      const employee = employees.find((e: any) => e._id === empId);
      if (!employee) continue;

      const amt13 = amounts.find((a: any) => a.employeeId === empId);
      const totalBasicPay = amt13?.totalBasicPay ?? 0;
      const dailyRate =
        totalBasicPay > 0 ? totalBasicPay / workingDaysPerYear : 0;

      const regDate =
        employee?.employment?.regularizationDate ?? employee?.employment?.hireDate;
      const hireDate = employee?.employment?.hireDate;
      const prorationStart =
        grantLeaveUponRegularization && regDate ? regDate : hireDate;

      const formulaAnnualSil = proratedLeave
        ? getProratedAnnualSil(annualSil, prorationStart, referenceDate)
        : annualSil;
      const anniversaryLeave = getCompletedYearsSince(regDate, referenceDate);

      const savedRow = rowsMap.get(empId) as
        | { annualSilOverride?: number; availed?: number }
        | undefined;
      const annualSilValue = savedRow?.annualSilOverride ?? formulaAnnualSil;
      const defaultAvailed =
        args.year < currentYear
          ? 0
          : (employee?.leaveCredits?.vacation?.used ?? 0) +
            (employee?.leaveCredits?.sick?.used ?? 0);
      const availed = savedRow?.availed ?? defaultAvailed;

      const total = Math.round((annualSilValue + anniversaryLeave) * 100) / 100;
      const balance = Math.max(0, Math.round((total - availed) * 100) / 100);
      const convertibleDays = Math.min(maxConvertibleLeaveDays, balance);
      const leaveConversionAmount = round2(convertibleDays * dailyRate);

      results.push({
        employeeId: empId,
        employee,
        convertibleDays,
        dailyRate: round2(dailyRate),
        leaveConversionAmount,
      });
    }

    return results;
}

/** Compute leave conversion amounts: first 5 days of unused leave × daily rate. */
export const computeLeaveConversionAmounts = query({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    employeeIds: v.optional(v.array(v.id("employees"))),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);
    const employees = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const employeeIds =
      args.employeeIds ??
      employees
        .filter((e: any) => e.employment?.status === "active")
        .map((e: any) => e._id);
    return computeLeaveConversionAmountsInternal(ctx, {
      organizationId: args.organizationId,
      year: args.year,
      employeeIds,
    });
  },
});

/** Create a leave conversion payroll run. No gov deductions. */
export const createLeaveConversionRun = mutation({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    employeeIds: v.array(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const amounts = await computeLeaveConversionAmountsInternal(ctx, {
      organizationId: args.organizationId,
      year: args.year,
      employeeIds: args.employeeIds,
    });

    const amountMap = new Map(
      amounts.map((a: any) => [a.employeeId, a.leaveConversionAmount]),
    );

    const yearStart = new Date(args.year, 0, 1).getTime();
    const yearEnd = new Date(args.year, 11, 31, 23, 59, 59, 999).getTime();

    const now = Date.now();
    const period = `Leave Conversion ${args.year}`;

    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId: args.organizationId,
      cutoffStart: yearStart,
      cutoffEnd: yearEnd,
      period,
      runType: "leave_conversion",
      year: args.year,
      status: "draft",
      processedBy: userRecord._id,
      deductionsEnabled: false,
      draftConfig: { employeeIds: args.employeeIds },
      createdAt: now,
      updatedAt: now,
    });

    for (const employeeId of args.employeeIds) {
      const amt = amountMap.get(employeeId) ?? 0;
      if (amt <= 0) continue;

      await ctx.db.insert("payslips", {
        organizationId: args.organizationId,
        employeeId,
        payrollRunId,
        period,
        grossPay: amt,
        basicPay: amt,
        deductions: [],
        netPay: amt,
        daysWorked: 0,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: now,
      });
    }

    await ctx.db.patch(payrollRunId, {
      processedAt: now,
      updatedAt: now,
    });

    return payrollRunId;
  },
});

// Get payroll run summary (attendance data for all employees)
export const getPayrollRunSummary = query({
  args: {
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);

    // Get all payslips for this payroll run to get employee IDs
    const payslips = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    const employeeIds = payslips.map((p: any) => p.employeeId);

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Fetch attendance the same way as the attendance page: by_organization then filter by date range
    // (getAttendance uses this so we get the same set of records the user sees on the attendance page)
    let periodAttendance = await (ctx.db.query("attendance") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId),
      )
      .collect();

    // Inclusive date range: include any record on or between cutoff start and end
    const rangeEnd =
      payrollRun.cutoffEnd +
      ONE_DAY_MS -
      1; /* include full last day (e.g. 23:59:59.999) */
    periodAttendance = periodAttendance.filter(
      (a: any) => a.date >= payrollRun.cutoffStart && a.date <= rangeEnd,
    );

    // Restrict to employees in this payroll run
    periodAttendance = periodAttendance.filter((a: any) =>
      employeeIds.includes(a.employeeId),
    );

    // Get all employees
    const employees = await Promise.all(
      employeeIds.map(async (id: any) => await ctx.db.get(id)),
    );

    // Generate one date slot per calendar day (same logic as attendance page: start + i*24h)
    const numDays =
      Math.floor((payrollRun.cutoffEnd - payrollRun.cutoffStart) / ONE_DAY_MS) +
      1;
    const dates: number[] = [];
    for (let i = 0; i < numDays; i++) {
      dates.push(payrollRun.cutoffStart + i * ONE_DAY_MS);
    }

    // Get payroll rates from organization settings (night diff, OT rates, etc.)
    const rates = await getPayrollRates(ctx, payrollRun.organizationId);

    // Get all approved leave requests for all employees in the period
    const allLeaveRequests = await (ctx.db.query("leaveRequests") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId),
      )
      .collect();

    const approvedLeaves = allLeaveRequests.filter(
      (lr: any) =>
        lr.status === "approved" &&
        lr.startDate <= payrollRun.cutoffEnd &&
        lr.endDate >= payrollRun.cutoffStart &&
        employeeIds.includes(lr.employeeId),
    );

    // Get leave types to check if leave is paid
    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId),
      )
      .collect();

    // Build summary data
    const payslipByEmployeeId = new Map(
      payslips.map((payslip: any) => [payslip.employeeId, payslip]),
    );
    const summary = employees
      .filter((e: any) => e)
      .map((employee: any) => {
        const empAttendance = periodAttendance.filter(
          (a: any) => a.employeeId === employee._id,
        );
        const payslip = payslipByEmployeeId.get(employee._id) as any;
        const employeeContributionBreakdown = {
          sss: getDeductionAmountByNames(payslip?.deductions ?? [], ["sss"]),
          philhealth: getDeductionAmountByNames(payslip?.deductions ?? [], [
            "philhealth",
          ]),
          pagibig: getDeductionAmountByNames(payslip?.deductions ?? [], [
            "pag-ibig",
            "pagibig",
          ]),
          tax: getDeductionAmountByNames(payslip?.deductions ?? [], [
            "withholding tax",
          ]),
        };
        const companyContributionBreakdown = {
          sss: payslip?.employerContributions?.sss ?? 0,
          philhealth: payslip?.employerContributions?.philhealth ?? 0,
          pagibig: payslip?.employerContributions?.pagibig ?? 0,
        };
        const totalEmployeeContribution = round2(
          employeeContributionBreakdown.sss +
            employeeContributionBreakdown.philhealth +
            employeeContributionBreakdown.pagibig +
            employeeContributionBreakdown.tax,
        );
        const totalCompanyContribution = round2(
          companyContributionBreakdown.sss +
            companyContributionBreakdown.philhealth +
            companyContributionBreakdown.pagibig,
        );

        // Get approved leaves for this employee
        const empApprovedLeaves = approvedLeaves.filter(
          (lr: any) => lr.employeeId === employee._id,
        );

        // Helper to check if a date falls within a paid leave
        const isPaidLeave = (date: number): boolean => {
          const dateObj = new Date(date);
          for (const leave of empApprovedLeaves) {
            const leaveStart = new Date(leave.startDate);
            const leaveEnd = new Date(leave.endDate);
            if (dateObj >= leaveStart && dateObj <= leaveEnd) {
              // Check if this leave type is paid
              if (leave.leaveType === "custom" && leave.customLeaveType) {
                const leaveType = leaveTypes.find(
                  (lt: any) => lt.name === leave.customLeaveType,
                );
                return leaveType?.isPaid ?? false;
              }
              // Default leave types: vacation and sick are typically paid
              return (
                leave.leaveType === "vacation" ||
                leave.leaveType === "sick" ||
                leave.leaveType === "maternity" ||
                leave.leaveType === "paternity"
              );
            }
          }
          return false;
        };

        // Calculate totals
        let totalLateMinutes = 0;
        let totalUndertimeMinutes = 0;
        let totalRegularOTHours = 0;
        let totalSpecialOTHours = 0;
        let totalNightDiffHours = 0;
        let totalAbsentDays = 0;

        // Helper to calculate time in minutes
        const timeToMinutes = (time: string): number => {
          if (!time) return 0;
          const [hours, minutes] = time.split(":").map(Number);
          return hours * 60 + minutes;
        };

        // Helper to calculate night differential hours (Philippines: 10pm-6am).
        // Only counts when SCHEDULED shift overlaps 10pm-6am (early clock-in doesn't qualify).
        const calculateNightDiffHours = (
          actualIn?: string,
          actualOut?: string,
          scheduleIn?: string,
          scheduleOut?: string,
        ): number => {
          if (!actualIn || !actualOut) return 0;
          if (!scheduleIn || !scheduleOut) {
            // No schedule: cannot verify shift overlaps 10pm-6am, so no night diff.
            return 0;
          }

          const norm = (start: number, end: number) => {
            let s = start;
            let e = end;
            if (s < 6 * 60) {
              s += 24 * 60;
              e += 24 * 60;
            } else if (e <= s) {
              e += 24 * 60;
            }
            return { start: s, end: e };
          };

          const nightStart = 22 * 60;
          const nightEnd = 24 * 60 + 6 * 60;

          const sched = norm(timeToMinutes(scheduleIn), timeToMinutes(scheduleOut));
          const schedNightStart = Math.max(sched.start, nightStart);
          const schedNightEnd = Math.min(sched.end, nightEnd);
          if (schedNightEnd <= schedNightStart) return 0;

          const act = norm(timeToMinutes(actualIn), timeToMinutes(actualOut));
          const actNightStart = Math.max(act.start, nightStart);
          const actNightEnd = Math.min(act.end, nightEnd);
          if (actNightEnd <= actNightStart) return 0;

          const overlapStart = Math.max(schedNightStart, actNightStart);
          const overlapEnd = Math.min(schedNightEnd, actNightEnd);
          if (overlapEnd <= overlapStart) return 0;
          return (overlapEnd - overlapStart) / 60;
        };

        // Build daily attendance data (match by 24h window so attendance aligns with summary dates)
        const dailyData = dates.map((dateTimestamp) => {
          const windowEnd = dateTimestamp + ONE_DAY_MS;
          const att = empAttendance.find(
            (a: any) => a.date >= dateTimestamp && a.date < windowEnd,
          );

          if (!att) {
            return {
              date: dateTimestamp,
              timeIn: null,
              timeOut: null,
              status: null,
              lateMinutes: 0,
              undertimeMinutes: 0,
              regularOTHours: 0,
              specialOTHours: 0,
              nightDiffHours: 0,
              isAbsent: false,
              note: null,
            };
          }

          let lateMinutes = 0;
          let undertimeMinutes = 0;
          let regularOTHours = 0;
          let specialOTHours = 0;
          let nightDiffHours = 0;

          if (att.status === "present") {
            if (att.lateManualOverride === true) {
              lateMinutes = att.late ?? 0;
              if (lateMinutes > 0) totalLateMinutes += lateMinutes;
            } else if (att.late !== undefined && att.late !== null) {
              lateMinutes = att.late;
              if (lateMinutes > 0) totalLateMinutes += lateMinutes;
            } else if (att.actualIn && att.scheduleIn) {
              const scheduleMinutes = timeToMinutes(att.scheduleIn);
              const actualMinutes = timeToMinutes(att.actualIn);
              if (actualMinutes > scheduleMinutes) {
                lateMinutes = actualMinutes - scheduleMinutes;
                totalLateMinutes += lateMinutes;
              }
            }
            if (att.undertimeManualOverride === true) {
              undertimeMinutes = Math.round((att.undertime ?? 0) * 60);
              if (undertimeMinutes > 0)
                totalUndertimeMinutes += undertimeMinutes;
            } else if (att.undertime !== undefined && att.undertime !== null) {
              undertimeMinutes = Math.round(att.undertime * 60);
              if (undertimeMinutes > 0)
                totalUndertimeMinutes += undertimeMinutes;
            } else if (att.actualOut && att.scheduleOut) {
              const scheduleMinutes = timeToMinutes(att.scheduleOut);
              const actualMinutes = timeToMinutes(att.actualOut);
              if (actualMinutes < scheduleMinutes) {
                undertimeMinutes = scheduleMinutes - actualMinutes;
                totalUndertimeMinutes += undertimeMinutes;
              }
            }
          }

          // Overtime: user-set only (no auto-calculation from time out)
          if (att.status === "present" && att.overtime && att.overtime > 0) {
            if (att.isHoliday && att.holidayType === "special") {
              totalSpecialOTHours += att.overtime;
              specialOTHours = att.overtime;
            } else {
              totalRegularOTHours += att.overtime;
              regularOTHours = att.overtime;
            }
          }

          // Calculate night differential: scheduled shift ∩ 10pm-6am ∩ actual worked
          if (att.status === "present") {
            nightDiffHours = calculateNightDiffHours(
              att.actualIn,
              att.actualOut,
              att.scheduleIn,
              att.scheduleOut,
            );
            totalNightDiffHours += nightDiffHours;
          }

          // Count absent and leave_without_pay as absent (deduction)
          if (att.status === "absent") {
            if (!isPaidLeave(dateTimestamp)) {
              totalAbsentDays += 1;
            }
          } else if (att.status === "leave_without_pay") {
            totalAbsentDays += 1;
          }

          return {
            date: dateTimestamp,
            timeIn: att.actualIn || null,
            timeOut: att.actualOut || null,
            status: att.status,
            lateMinutes,
            undertimeMinutes,
            regularOTHours,
            specialOTHours,
            nightDiffHours,
            isAbsent:
              att.status === "absent" ||
              att.status === "leave_without_pay",
            note: att.remarks || null,
          };
        });

        return {
          employee,
          payslipBreakdown: {
            grossPay: payslip?.grossPay ?? 0,
            nonTaxableAllowance: payslip?.nonTaxableAllowance ?? 0,
            netPay: payslip?.netPay ?? 0,
            totalEmployeeContribution,
            totalCompanyContribution,
            employeeContributions: employeeContributionBreakdown,
            companyContributions: companyContributionBreakdown,
          },
          dailyData,
          totals: {
            totalLateMinutes,
            totalUndertimeMinutes,
            totalRegularOTHours,
            totalSpecialOTHours,
            totalNightDiffHours,
            totalAbsentDays,
          },
        };
      });

    return {
      payrollRun,
      summary,
      dates,
    };
  },
});

// Add note to payroll run summary
export const addPayrollRunNote = mutation({
  args: {
    payrollRunId: v.id("payrollRuns"),
    employeeId: v.id("employees"),
    date: v.number(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);

    const notes = payrollRun.notes || [];
    notes.push({
      employeeId: args.employeeId,
      date: args.date,
      note: args.note,
      addedBy: userRecord._id,
      addedAt: Date.now(),
    });

    await ctx.db.patch(args.payrollRunId, {
      notes,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Get payslips by payroll run
export const getPayslipsByPayrollRun = query({
  args: {
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);

    const payslips = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    // Get employee details for each payslip
    const payslipsWithEmployees = await Promise.all(
      payslips.map(async (payslip: any) => {
        const employee = (await ctx.db.get(payslip.employeeId)) as any;
        if (!employee) {
          return {
            ...payslip,
            employee: null,
          };
        }
        return {
          ...payslip,
          employee: {
            _id: employee._id,
            personalInfo: employee.personalInfo,
            employment: employee.employment,
            compensation: employee.compensation,
          },
        };
      }),
    );

    return payslipsWithEmployees;
  },
});

// Get payslips for employee
export const getEmployeePayslips = query({
  args: {
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId);

    // Check authorization
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const payslips = await (ctx.db.query("payslips") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    payslips.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return payslips;
  },
});

// Get payslip by ID
export const getPayslip = query({
  args: {
    payslipId: v.id("payslips"),
  },
  handler: async (ctx, args) => {
    const payslip = await ctx.db.get(args.payslipId);
    if (!payslip) throw new Error("Payslip not found");

    const userRecord = await checkAuth(ctx, payslip.organizationId);

    // Check authorization
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== payslip.employeeId
    ) {
      throw new Error("Not authorized");
    }

    return payslip;
  },
});

// Update payslip
export const updatePayslip = mutation({
  args: {
    payslipId: v.id("payslips"),
    deductions: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.number(),
          type: v.string(),
        }),
      ),
    ),
    incentives: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.number(),
          type: v.string(),
        }),
      ),
    ),
    nonTaxableAllowance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const payslip = await ctx.db.get(args.payslipId);
    if (!payslip) throw new Error("Payslip not found");

    // Check auth - owner, admin, hr, or accounting can edit
    const userRecord = await checkAuth(ctx, payslip.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to edit payslips");
    }

    // Get user email for edit history
    const authUser = await authComponent.getAuthUser(ctx);
    const userEmail = authUser?.email || userRecord.email || "Unknown";

    // Calculate new totals
    const newDeductions = args.deductions || payslip.deductions;
    const newIncentives = args.incentives || payslip.incentives || [];
    const newNonTaxableAllowance =
      args.nonTaxableAllowance !== undefined
        ? args.nonTaxableAllowance
        : payslip.nonTaxableAllowance || 0;

    const totalDeductions = newDeductions.reduce((sum, d) => sum + d.amount, 0);
    const totalIncentives = newIncentives.reduce(
      (sum, inc) => sum + inc.amount,
      0,
    );

    // Recalculate gross pay and net pay
    // Get basic pay from original gross pay minus original incentives
    const originalIncentives = payslip.incentives || [];
    const originalTotalIncentives = originalIncentives.reduce(
      (sum, inc) => sum + inc.amount,
      0,
    );
    const basicPay = payslip.grossPay - originalTotalIncentives;

    const newGrossPay = round2(basicPay + totalIncentives);
    const newNetPay = round2(
      newGrossPay + newNonTaxableAllowance - totalDeductions,
    );
    const editedEmployeeSSSAmount = getDeductionAmountByNames(newDeductions, [
      "sss",
    ]);
    const editedEmployeePhilhealthAmount = getDeductionAmountByNames(
      newDeductions,
      ["philhealth"],
    );
    const editedEmployeePagibigAmount = getDeductionAmountByNames(newDeductions, [
      "pag-ibig",
      "pagibig",
    ]);
    const updatedEmployerContributions: {
      sss?: number;
      philhealth?: number;
      pagibig?: number;
    } = {};
    if (editedEmployeeSSSAmount > 0) {
      updatedEmployerContributions.sss = round2(
        getSSSContributionByEmployeeDeduction(editedEmployeeSSSAmount)
          .employerShare,
      );
    }
    if (editedEmployeePhilhealthAmount > 0) {
      updatedEmployerContributions.philhealth = round2(
        editedEmployeePhilhealthAmount,
      );
    }
    if (editedEmployeePagibigAmount > 0) {
      updatedEmployerContributions.pagibig = round2(editedEmployeePagibigAmount);
    }

    // Helper function to detect specific changes in arrays
    function detectArrayChanges(
      oldArray: Array<{ name: string; amount: number; type?: string }>,
      newArray: Array<{ name: string; amount: number; type?: string }>,
    ): string[] {
      const changeDetails: string[] = [];

      // Create maps for easier lookup
      const oldMap = new Map<
        string,
        { name: string; amount: number; type?: string }
      >();
      oldArray.forEach((item, idx) => {
        oldMap.set(`${item.name}_${idx}`, item);
      });

      const newMap = new Map<
        string,
        { name: string; amount: number; type?: string }
      >();
      newArray.forEach((item, idx) => {
        newMap.set(`${item.name}_${idx}`, item);
      });

      // Track which items we've already processed
      const processedOld = new Set<number>();
      const processedNew = new Set<number>();

      // Find modified items (same name, different amount)
      newArray.forEach((newItem, newIdx) => {
        const oldItemWithSameName = oldArray.find(
          (old, oldIdx) =>
            old.name === newItem.name && !processedOld.has(oldIdx),
        );
        if (oldItemWithSameName) {
          const oldIdx = oldArray.indexOf(oldItemWithSameName);
          if (oldItemWithSameName.amount !== newItem.amount) {
            changeDetails.push(
              `Modified "${newItem.name}": ₱${oldItemWithSameName.amount.toFixed(2)} → ₱${newItem.amount.toFixed(2)}`,
            );
            processedOld.add(oldIdx);
            processedNew.add(newIdx);
          } else if (
            (oldItemWithSameName.type || "") === (newItem.type || "")
          ) {
            // Same item, no change
            processedOld.add(oldIdx);
            processedNew.add(newIdx);
          }
        }
      });

      // Find added items (in new but not in old with same name/amount)
      newArray.forEach((newItem, newIdx) => {
        if (!processedNew.has(newIdx)) {
          const oldItemWithSameName = oldArray.find(
            (old) => old.name === newItem.name,
          );
          if (!oldItemWithSameName) {
            changeDetails.push(
              `Added "${newItem.name}": ₱${newItem.amount.toFixed(2)}`,
            );
            processedNew.add(newIdx);
          }
        }
      });

      // Find removed items (in old but not in new)
      oldArray.forEach((oldItem, oldIdx) => {
        if (!processedOld.has(oldIdx)) {
          const newItemWithSameName = newArray.find(
            (newItem) => newItem.name === oldItem.name,
          );
          if (!newItemWithSameName) {
            changeDetails.push(
              `Removed "${oldItem.name}": ₱${oldItem.amount.toFixed(2)}`,
            );
            processedOld.add(oldIdx);
          }
        }
      });

      return changeDetails;
    }

    // Track changes for edit history
    const changes: Array<{
      field: string;
      oldValue?: any;
      newValue?: any;
      details?: string[];
    }> = [];

    // Compare deductions
    const oldDeductions = payslip.deductions || [];
    const oldDeductionsStr = JSON.stringify(oldDeductions);
    const newDeductionsStr = JSON.stringify(newDeductions);
    if (oldDeductionsStr !== newDeductionsStr) {
      const deductionChanges = detectArrayChanges(oldDeductions, newDeductions);
      changes.push({
        field: "deductions",
        oldValue: oldDeductions,
        newValue: newDeductions,
        details: deductionChanges.length > 0 ? deductionChanges : undefined,
      });
    }

    // Compare incentives
    const oldIncentives = payslip.incentives || [];
    const oldIncentivesStr = JSON.stringify(oldIncentives);
    const newIncentivesStr = JSON.stringify(newIncentives);
    if (oldIncentivesStr !== newIncentivesStr) {
      const incentiveChanges = detectArrayChanges(oldIncentives, newIncentives);
      changes.push({
        field: "incentives",
        oldValue: oldIncentives,
        newValue: newIncentives,
        details: incentiveChanges.length > 0 ? incentiveChanges : undefined,
      });
    }

    // Compare non-taxable allowance
    if ((payslip.nonTaxableAllowance || 0) !== newNonTaxableAllowance) {
      changes.push({
        field: "nonTaxableAllowance",
        oldValue: payslip.nonTaxableAllowance || 0,
        newValue: newNonTaxableAllowance,
      });
    }

    // Only add to edit history if there are actual changes
    const existingEditHistory = payslip.editHistory || [];
    const updatedEditHistory =
      changes.length > 0
        ? [
            ...existingEditHistory,
            {
              editedBy: userRecord._id,
              editedByEmail: userEmail,
              editedAt: Date.now(),
              changes,
            },
          ]
        : existingEditHistory;

    await ctx.db.patch(args.payslipId, {
      deductions: newDeductions.map((d) => ({
        ...d,
        amount: round2(d.amount),
      })),
      incentives:
        newIncentives.length > 0
          ? newIncentives.map((i) => ({ ...i, amount: round2(i.amount) }))
          : undefined,
      nonTaxableAllowance:
        newNonTaxableAllowance > 0 ? round2(newNonTaxableAllowance) : undefined,
      grossPay: newGrossPay,
      netPay: newNetPay,
      employerContributions:
        Object.keys(updatedEmployerContributions).length > 0
          ? updatedEmployerContributions
          : undefined,
      editHistory:
        updatedEditHistory.length > 0 ? updatedEditHistory : undefined,
    });

    // Re-sync accounting cost items when deductions/incentives/allowance change
    // so that Payroll, SSS, PhilHealth, Pag-IBIG, Tax expense items reflect updated totals
    const payrollRun = payslip.payrollRunId
      ? await ctx.db.get(payslip.payrollRunId)
      : null;
    if (
      payrollRun &&
      (payrollRun.status === "finalized" || payrollRun.status === "paid")
    ) {
      await createExpenseItemsFromPayroll(ctx, payrollRun);
    }

    return { success: true };
  },
});

// Get messages/concerns linked to a payslip
export const getPayslipMessages = query({
  args: {
    payslipId: v.id("payslips"),
  },
  handler: async (ctx, args) => {
    const payslip = await ctx.db.get(args.payslipId);
    if (!payslip) throw new Error("Payslip not found");

    const userRecord = await checkAuth(ctx, payslip.organizationId);

    // Get all messages linked to this payslip
    const messages = await (ctx.db.query("messages") as any)
      .withIndex("by_payslip", (q: any) => q.eq("payslipId", args.payslipId))
      .order("desc")
      .collect();

    // Enrich with sender details
    const enriched = await Promise.all(
      messages.map(async (msg: any) => {
        const senderDoc = await ctx.db.get(msg.senderId);
        const sender = senderDoc as any; // Cast to any to access user properties

        // Get employee info if sender is an employee
        let employeeInfo = null;
        if (sender && sender.employeeId) {
          const employeeDoc = await ctx.db.get(sender.employeeId);
          const employee = employeeDoc as any; // Cast to any to access employee properties
          if (employee && employee.personalInfo) {
            employeeInfo = {
              name: `${employee.personalInfo?.firstName || ""} ${employee.personalInfo?.lastName || ""}`.trim(),
              employeeId: employee.employment?.employeeId,
            };
          }
        }
        return {
          ...msg,
          sender: sender
            ? {
                _id: sender._id,
                name: sender.name || sender.email || "Unknown",
                email: sender.email || "",
                employeeInfo,
              }
            : null,
        };
      }),
    );

    return enriched.reverse(); // Return in chronological order
  },
});

// Send payslip notification to employee
export const sendPayslipNotification = mutation({
  args: {
    payslipId: v.id("payslips"),
    method: v.union(v.literal("email"), v.literal("chat")),
  },
  handler: async (ctx, args) => {
    const payslip = await ctx.db.get(args.payslipId);
    if (!payslip) throw new Error("Payslip not found");

    const userRecord = await checkAuth(ctx, payslip.organizationId);

    const employee = await ctx.db.get(payslip.employeeId);
    if (!employee) throw new Error("Employee not found");

    // This will be handled by the server action
    return {
      success: true,
      payslipId: args.payslipId,
      employeeId: payslip.employeeId,
      method: args.method,
    };
  },
});
