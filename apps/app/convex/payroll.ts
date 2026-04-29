import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { decryptUtf8, isEncryptedPayload } from "./chatMessageBodyCrypto";
import { getChatMasterSecret, unwrapSessionKey } from "./chatSessionKey";
import {
  encryptPayslipRowForDb,
  decryptPayslipRowFromDb,
  encryptPayslipPartialForDb,
} from "./payslipCrypto";
import {
  encryptDraftConfigForDb,
  decryptDraftConfigFromDb,
  decryptPayrollRunFromDb,
} from "./payrollRunCrypto";
import { decryptEmployeeFromDb } from "./employeeCompensationCrypto";
import {
  getSSSContribution,
  getSSSContributionByEmployeeDeduction,
} from "./sss";
import {
  getScheduleWithLunch,
  type ScheduleLunchContext,
} from "./shifts";
import {
  calculateNightDiffWorkHoursForAttendance,
  calculatePayrollBaseFromRecords,
  getMatchingHolidayForDate,
  holidayAppliesToEmployee,
  holidayMatchesDate as holidayMatchesDateLib,
  type PayrollBaseResult,
} from "@/lib/payroll-calculations";
import { formatManilaNumericDate } from "@/lib/manila-date";
import {
  getVariableEarningsFromPayslip,
  recomputeGrossAndBasicFromVariableEarnings,
  recomputeNetFromEarningsAndLines,
  type VariableEarnings,
} from "./payrollVariableEarningsMath";

function buildDraftPayrollConfig(args: {
  employeeIds: any[];
  manualDeductions?: any[];
  incentives?: any[];
  governmentDeductionSettings?: any[];
  /** Per-employee non-taxable allowance override when edited on payslip vs employee profile default */
  nonTaxableAllowanceOverrides?: Array<{
    employeeId: any;
    amount: number;
  }>;
}) {
  return {
    employeeIds: args.employeeIds,
    manualDeductions: args.manualDeductions,
    incentives: args.incentives,
    governmentDeductionSettings: args.governmentDeductionSettings,
    nonTaxableAllowanceOverrides: args.nonTaxableAllowanceOverrides,
  };
}

type DraftDependencySnapshot = {
  attendance: number;
  holidays: number;
  payrollSettings: number;
  leaveTypes: number;
  shifts: number;
  employees: number;
};

function maxTs(current: number, next: any): number {
  const v =
    typeof next?.updatedAt === "number"
      ? next.updatedAt
      : typeof next?.createdAt === "number"
        ? next.createdAt
        : 0;
  return v > current ? v : current;
}

async function resolveDraftEmployeeIdsForRun(ctx: any, payrollRun: any) {
  const cfg = decryptDraftConfigFromDb(payrollRun.draftConfig);
  const fromConfig = Array.isArray(cfg?.employeeIds) ? cfg.employeeIds : [];
  if (fromConfig.length > 0) return fromConfig;
  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) => q.eq("payrollRunId", payrollRun._id))
    .collect();
  return Array.from(new Set(payslips.map((p: any) => p.employeeId)));
}

async function captureDraftDependencySnapshot(ctx: any, args: {
  organizationId: any;
  cutoffStart: number;
  cutoffEnd: number;
  employeeIds: any[];
}): Promise<DraftDependencySnapshot> {
  let attendance = 0;
  let employees = 0;
  const _rangeEnd = args.cutoffEnd + 24 * 60 * 60 * 1000 - 1;
  for (const employeeId of args.employeeIds) {
    const emp = await ctx.db.get(employeeId);
    employees = maxTs(employees, emp);
    const rows = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee_date", (q: any) =>
        q
          .eq("employeeId", employeeId)
          .gte("date", args.cutoffStart)
          .lte("date", _rangeEnd),
      )
      .collect();
    for (const row of rows) {
      attendance = maxTs(attendance, row);
    }
  }

  let holidays = 0;
  const holidayRows = await (ctx.db.query("holidays") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", args.organizationId))
    .collect();
  for (const row of holidayRows) holidays = maxTs(holidays, row);

  let leaveTypes = 0;
  const leaveTypeRows = await (ctx.db.query("leaveTypes") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", args.organizationId))
    .collect();
  for (const row of leaveTypeRows) leaveTypes = maxTs(leaveTypes, row);

  let shifts = 0;
  const shiftRows = await (ctx.db.query("shifts") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", args.organizationId))
    .collect();
  for (const row of shiftRows) shifts = maxTs(shifts, row);

  const settingsRow = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) => q.eq("organizationId", args.organizationId))
    .first();
  const payrollSettings = maxTs(0, settingsRow);

  return {
    attendance,
    holidays,
    payrollSettings,
    leaveTypes,
    shifts,
    employees,
  };
}

function hasDraftDependenciesChanged(
  snapshot: DraftDependencySnapshot | undefined,
  current: DraftDependencySnapshot,
): boolean {
  if (!snapshot) return true;
  return (
    current.attendance > snapshot.attendance ||
    current.holidays > snapshot.holidays ||
    current.payrollSettings > snapshot.payrollSettings ||
    current.leaveTypes > snapshot.leaveTypes ||
    current.shifts > snapshot.shifts ||
    current.employees > snapshot.employees
  );
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

function isAttendanceDeductionName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  // Accept legacy/variant labels too (e.g. "Absent(1 day)", "No-work (1 day)").
  const isAbsentLike = /^absent(?:\b|\s|\()/.test(n);
  const isNoWorkLike = /^no[\s-]*work(?:\b|\s|\()/.test(n);
  return (
    n === "late" ||
    n === "regular day late" ||
    n === "regular holiday late" ||
    n === "special holiday late" ||
    n === "undertime" ||
    isAbsentLike ||
    isNoWorkLike
  );
}

function isAttendanceDeductionEntry(d: { name?: string; type?: string }): boolean {
  return (d?.type || "").toLowerCase() === "attendance" || isAttendanceDeductionName(d?.name || "");
}

/** Regenerated payslip rows recompute this from prior cutoffs; do not carry over from old payslip into manual merge. */
const PENDING_PREVIOUS_CUTOFF_DEDUCTION_NAME =
  "Pending Deductions (Previous Cutoff)";

/** Round to 2 decimal places for currency */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildEmployeeSnapshot(employee: any) {
  return {
    personalInfo: {
      firstName: employee?.personalInfo?.firstName,
      lastName: employee?.personalInfo?.lastName,
      email: employee?.personalInfo?.email,
    },
    employment: {
      employeeId: employee?.employment?.employeeId,
      hireDate:
        typeof employee?.employment?.hireDate === "number"
          ? employee.employment.hireDate
          : undefined,
      position: employee?.employment?.position,
    },
    compensation: {
      salaryType: employee?.compensation?.salaryType,
      basicSalary:
        typeof employee?.compensation?.basicSalary === "number"
          ? employee.compensation.basicSalary
          : undefined,
      allowance:
        typeof employee?.compensation?.allowance === "number"
          ? employee.compensation.allowance
          : undefined,
    },
    payslipPdfPassword:
      typeof employee?.payslipPdfPassword === "string"
        ? employee.payslipPdfPassword
        : undefined,
  };
}

function getPayslipEmployeeFromSnapshot(payslip: any): any {
  const snapshot = payslip?.employeeSnapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    _id: payslip.employeeId,
    organizationId: payslip.organizationId,
    personalInfo: snapshot.personalInfo ?? {},
    employment: snapshot.employment ?? {},
    compensation: snapshot.compensation ?? {},
    payslipPdfPassword:
      typeof snapshot.payslipPdfPassword === "string"
        ? snapshot.payslipPdfPassword
        : undefined,
  };
}

function normalizeConcernSummary(summary: any) {
  if (!summary || typeof summary !== "object") {
    return {
      messageCount: 0,
      lastMessageAt: undefined,
    };
  }
  return {
    messageCount:
      typeof summary.messageCount === "number" && summary.messageCount > 0
        ? summary.messageCount
        : 0,
    lastMessageAt:
      typeof summary.lastMessageAt === "number"
        ? summary.lastMessageAt
        : undefined,
  };
}

async function computeConcernSummaryForPayslip(
  ctx: any,
  payslipId: any,
  storedSummary?: any,
) {
  const normalized = normalizeConcernSummary(storedSummary);
  if (normalized.messageCount > 0 || normalized.lastMessageAt != null) {
    return normalized;
  }

  const messages = await (ctx.db.query("messages") as any)
    .withIndex("by_payslip", (q: any) => q.eq("payslipId", payslipId))
    .collect();

  if (messages.length === 0) {
    return normalized;
  }

  let lastMessageAt = 0;
  for (const message of messages) {
    if (
      typeof message?.createdAt === "number" &&
      message.createdAt > lastMessageAt
    ) {
      lastMessageAt = message.createdAt;
    }
  }

  return {
    messageCount: messages.length,
    lastMessageAt: lastMessageAt || undefined,
  };
}

type PreviousPayslipRecord = {
  pendingDeductions?: number;
  periodStart?: number;
  period?: string;
  payrollRunId?: any;
  [key: string]: any;
};

/**
 * Parse the legacy `period` string ("M/D/YYYY to M/D/YYYY") into a UTC-ms start.
 * Used only to support rows created before `periodStart` existed.
 */
function parseLegacyPayslipPeriodStart(period: string | undefined): number | null {
  if (!period || typeof period !== "string") return null;
  const parts = period.split(" to ");
  if (parts.length !== 2) return null;
  const parsed = new Date(parts[0]);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Return payslips whose cutoff starts in the same calendar month as `cutoffStart`
 * and strictly before it. Uses the `by_employee_periodStart` compound index so we
 * avoid the old "read the employee's entire payslip history" pattern.
 *
 * Legacy rows without `periodStart` are intentionally not returned here — run the
 * `backfillPayslipPeriodRange` mutation once to populate them. The only user-visible
 * impact of a not-yet-backfilled row is that its carry-over pending deductions are
 * skipped on the next run until backfilled.
 */
async function findSameMonthPreviousPayslips(
  ctx: any,
  args: {
    employeeId: any;
    cutoffStart: number;
    excludePayrollRunId?: any;
  },
): Promise<PreviousPayslipRecord[]> {
  const start = new Date(args.cutoffStart);
  const monthStart = new Date(
    start.getFullYear(),
    start.getMonth(),
    1,
  ).getTime();
  const rangeEnd = args.cutoffStart - 1;
  if (rangeEnd < monthStart) return [];

  const rawRows = await (ctx.db.query("payslips") as any)
    .withIndex("by_employee_periodStart", (q: any) =>
      q
        .eq("employeeId", args.employeeId)
        .gte("periodStart", monthStart)
        .lte("periodStart", rangeEnd),
    )
    .collect();

  const decrypted: PreviousPayslipRecord[] = rawRows
    .map((raw: any) => decryptPayslipRowFromDb(raw) as PreviousPayslipRecord)
    .filter((p: PreviousPayslipRecord | null): p is PreviousPayslipRecord => {
      if (!p) return false;
      if (
        args.excludePayrollRunId &&
        p.payrollRunId === args.excludePayrollRunId
      ) {
        return false;
      }
      return (p.pendingDeductions ?? 0) > 0;
    });

  return decrypted;
}

/**
 * Given candidate previous payslips in the same month, return the most recent
 * pending-deductions amount to carry over.
 */
function pickMostRecentPendingDeductions(
  previousPayslips: PreviousPayslipRecord[],
): number {
  if (previousPayslips.length === 0) return 0;
  const sorted = [...previousPayslips].sort((a, b) => {
    const aStart =
      typeof a.periodStart === "number"
        ? a.periodStart
        : (parseLegacyPayslipPeriodStart(a.period) ?? 0);
    const bStart =
      typeof b.periodStart === "number"
        ? b.periodStart
        : (parseLegacyPayslipPeriodStart(b.period) ?? 0);
    return bStart - aStart;
  });
  return sorted[0]?.pendingDeductions ?? 0;
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
const DEFAULT_NIGHT_DIFF_RATE = 1.1; // 110% (NIGHT_DIFF)
const DEFAULT_REGULAR_HOLIDAY = 2.0; // 200%
const DEFAULT_SPECIAL_HOLIDAY = 1.3; // 130%
const DEFAULT_REST_DAY_PREMIUM = 1.3; // 130% (REST_DAY_PREMIUM); OT on rest day/holiday = +30% on top

const DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR = 261;

// 30% on top for rest day OT and holiday OT (per PH labor: 25% regular day OT, 30% rest day/holiday OT)
const OT_PREMIUM_REST_DAY_AND_HOLIDAY = 1.3;

export type BasePayrollConfig = {
  nightDiffPercent: number; // 1.10 = 110%
  regularHolidayRate: number; // 2.0 = 200%
  specialHolidayRate: number; // 1.3 = 130%
  overtimeRegularRate: number; // 1.25 = 125%
  // REST_DAY_PREMIUM = 130%. Stored as overtimeRestDayRate for backward compat. First 8h on rest day at 130%; excess at 130%×1.30=169%. Holiday OT = holiday%×1.30.
  overtimeRestDayRate: number;
  dailyRateIncludesAllowance: boolean;
  dailyRateWorkingDaysPerYear: number;
  holidayNoWorkNoPay: boolean;
  absentBeforeHolidayNoHolidayPay: boolean;
};

function derivePayrollRatesFromBase(base: BasePayrollConfig): PayrollRates {
  const nd = base.nightDiffPercent ?? DEFAULT_NIGHT_DIFF_RATE;
  const regHol = base.regularHolidayRate ?? DEFAULT_REGULAR_HOLIDAY;
  const specHol = base.specialHolidayRate ?? DEFAULT_SPECIAL_HOLIDAY;
  const otReg = base.overtimeRegularRate ?? DEFAULT_REGULAR_OT;
  // Backward compat: value > 1.5 treated as legacy rest day OT rate (169%); infer premium = value/1.30
  const rawRest = base.overtimeRestDayRate ?? DEFAULT_REST_DAY_PREMIUM;
  const restDayPremiumRate =
    rawRest > 1.5 ? rawRest / OT_PREMIUM_REST_DAY_AND_HOLIDAY : rawRest;

  return {
    regularOt: otReg,
    restDayPremiumRate,
    restDayOt: restDayPremiumRate * OT_PREMIUM_REST_DAY_AND_HOLIDAY,
    regularHolidayOt: regHol * OT_PREMIUM_REST_DAY_AND_HOLIDAY,
    specialHolidayOt: specHol * OT_PREMIUM_REST_DAY_AND_HOLIDAY,
    nightDiffRate: nd,
    nightDiffOnOtRate: otReg * nd,
    nightDiffRegularHolidayRate: regHol * nd,
    nightDiffSpecialHolidayRate: specHol * nd,
    nightDiffRegularHolidayOtRate:
      regHol * OT_PREMIUM_REST_DAY_AND_HOLIDAY * nd,
    nightDiffSpecialHolidayOtRate:
      specHol * OT_PREMIUM_REST_DAY_AND_HOLIDAY * nd,
    nightDiffRestDayRate: restDayPremiumRate * nd,
    nightDiffRestDayOtRate:
      restDayPremiumRate * OT_PREMIUM_REST_DAY_AND_HOLIDAY * nd,
    dailyRateIncludesAllowance: base.dailyRateIncludesAllowance ?? true,
    dailyRateWorkingDaysPerYear:
      base.dailyRateWorkingDaysPerYear ??
      DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR,
    holidayNoWorkNoPay: base.holidayNoWorkNoPay ?? false,
    absentBeforeHolidayNoHolidayPay:
      base.absentBeforeHolidayNoHolidayPay ?? true,
    regularHolidayRate: regHol,
    specialHolidayRate: specHol,
  };
}

export type PayrollRates = {
  regularOt: number;
  restDayPremiumRate: number;
  restDayOt: number;
  specialHolidayOt: number;
  regularHolidayOt: number;
  nightDiffRate: number;
  nightDiffOnOtRate: number;
  nightDiffRegularHolidayRate: number;
  nightDiffSpecialHolidayRate: number;
  nightDiffRegularHolidayOtRate: number;
  nightDiffSpecialHolidayOtRate: number;
  nightDiffRestDayRate: number;
  nightDiffRestDayOtRate: number;
  dailyRateIncludesAllowance: boolean;
  dailyRateWorkingDaysPerYear: number;
  holidayNoWorkNoPay: boolean;
  absentBeforeHolidayNoHolidayPay: boolean;
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
    taxDeductionFrequency: ps?.taxDeductionFrequency ?? "twice_per_month",
    taxDeductOnPay: ps?.taxDeductOnPay ?? "first",
  };
}

async function getPayrollRates(
  ctx: any,
  organizationId: any,
): Promise<{ rates: PayrollRates; base: BasePayrollConfig }> {
  const settings = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .first();
  const ps = settings?.payrollSettings ?? {};
  const base: BasePayrollConfig = {
    nightDiffPercent: ps.nightDiffPercent ?? DEFAULT_NIGHT_DIFF_RATE,
    regularHolidayRate: ps.regularHolidayRate ?? DEFAULT_REGULAR_HOLIDAY,
    specialHolidayRate: ps.specialHolidayRate ?? DEFAULT_SPECIAL_HOLIDAY,
    overtimeRegularRate: ps.overtimeRegularRate ?? DEFAULT_REGULAR_OT,
    overtimeRestDayRate: ps.overtimeRestDayRate ?? DEFAULT_REST_DAY_PREMIUM,
    dailyRateIncludesAllowance: ps.dailyRateIncludesAllowance ?? true,
    dailyRateWorkingDaysPerYear:
      ps.dailyRateWorkingDaysPerYear ??
      DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR,
    holidayNoWorkNoPay: ps.holidayNoWorkNoPay ?? false,
    absentBeforeHolidayNoHolidayPay:
      ps.absentBeforeHolidayNoHolidayPay ?? true,
  };
  return { rates: derivePayrollRatesFromBase(base), base };
}

/**
 * Merge employee's 5 base config overrides with org base, then derive full payroll rates.
 */
function getEmployeePayrollRates(
  employee: any,
  orgBase: BasePayrollConfig,
): PayrollRates {
  const c = employee.compensation || {};
  let regularHolidayRate = c.regularHolidayRate ?? orgBase.regularHolidayRate;
  let specialHolidayRate = c.specialHolidayRate ?? orgBase.specialHolidayRate;
  if (regularHolidayRate <= 1.5) regularHolidayRate = 2.0;
  if (specialHolidayRate <= 0.5) specialHolidayRate = 1.3;
  regularHolidayRate = Math.max(regularHolidayRate, 1.0);

  const mergedBase: BasePayrollConfig = {
    nightDiffPercent: c.nightDiffPercent ?? orgBase.nightDiffPercent,
    regularHolidayRate,
    specialHolidayRate,
    overtimeRegularRate: c.overtimeRegularRate ?? orgBase.overtimeRegularRate,
    overtimeRestDayRate: c.overtimeRestDayRate ?? orgBase.overtimeRestDayRate,
    dailyRateIncludesAllowance: orgBase.dailyRateIncludesAllowance,
    dailyRateWorkingDaysPerYear: orgBase.dailyRateWorkingDaysPerYear,
    holidayNoWorkNoPay: orgBase.holidayNoWorkNoPay,
    absentBeforeHolidayNoHolidayPay: orgBase.absentBeforeHolidayNoHolidayPay,
  };
  return derivePayrollRatesFromBase(mergedBase);
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
  _attendanceRecord?: any,
): { isHoliday: boolean; holidayType?: HolidayType } {
  // Use holiday list as source of truth so editing holiday type (special ↔ regular) applies to payroll.
  const holiday = holidays.find((entry) => holidayMatchesDate(entry, date));
  if (holiday) {
    return { isHoliday: true, holidayType: holiday.type };
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

  // Clock-out after midnight (e.g. 00:00 when schedule out is 23:00) → treat as next day so OT is not undertime.
  const scheduleInM = timeStringToMinutes(att.scheduleIn);
  const actualOutAdjusted =
    scheduleInM !== null &&
    scheduleInM < scheduleOutM &&
    actualOutM < scheduleOutM &&
    actualOutM <= 12 * 60
      ? actualOutM + 24 * 60
      : actualOutM;

  const lunchStartM =
    att.lunchStart != null ? timeStringToMinutes(att.lunchStart) : null;
  const lunchEndM =
    att.lunchEnd != null ? timeStringToMinutes(att.lunchEnd) : null;
  const actualInM = timeStringToMinutes(att.actualIn);

  if (
    lunchStartM !== null &&
    lunchEndM !== null &&
    scheduleInM !== null &&
    actualInM !== null &&
    lunchEndM > lunchStartM
  ) {
    const breakMins = lunchEndM - lunchStartM;
    const requiredWorkMins = Math.max(
      0,
      scheduleOutM - scheduleInM - breakMins,
    );
    const breakDeducted =
      actualInM >= lunchEndM
        ? 0
        : Math.max(
            0,
            Math.min(actualOutAdjusted, lunchEndM) -
              Math.max(actualInM, lunchStartM),
          );
    const actualWorkMins = Math.max(
      0,
      actualOutAdjusted - actualInM - breakDeducted,
    );
    const undertimeMins = Math.max(0, requiredWorkMins - actualWorkMins);
    return undertimeMins / 60;
  }

  return Math.max(0, scheduleOutM - actualOutAdjusted) / 60;
}

/** Merge shift default lunch/schedule onto attendance for payroll (night diff, undertime). */
async function enrichAttendanceRecordWithSchedule(
  ctx: any,
  employee: any,
  att: any,
  scheduleLunchContext?: ScheduleLunchContext,
): Promise<any> {
  let lunchStart: string | null = att.lunchStart ?? null;
  let lunchEnd: string | null = att.lunchEnd ?? null;
  let scheduleIn: string | null = att.scheduleIn ?? null;
  let scheduleOut: string | null = att.scheduleOut ?? null;

  const scheduleWithLunch = await getScheduleWithLunch(
    ctx,
    employee,
    att.date,
    employee.organizationId,
    scheduleLunchContext,
  );
  if (scheduleWithLunch) {
    lunchStart = lunchStart ?? scheduleWithLunch.lunchStart;
    lunchEnd = lunchEnd ?? scheduleWithLunch.lunchEnd;
    scheduleIn = scheduleIn ?? scheduleWithLunch.scheduleIn;
    scheduleOut = scheduleOut ?? scheduleWithLunch.scheduleOut;
  }
  if (
    (lunchStart == null ||
      lunchEnd == null ||
      scheduleIn == null ||
      scheduleOut == null) &&
    employee.shiftId
  ) {
    const shift = await ctx.db.get(employee.shiftId);
    if (shift) {
      lunchStart = lunchStart ?? shift.lunchStart ?? null;
      lunchEnd = lunchEnd ?? shift.lunchEnd ?? null;
      scheduleIn = scheduleIn ?? shift.scheduleIn ?? null;
      scheduleOut = scheduleOut ?? shift.scheduleOut ?? null;
    }
  }
  if (lunchStart == null || lunchEnd == null) {
    if (scheduleLunchContext) {
      lunchStart = lunchStart ?? scheduleLunchContext.defaultLunchStart;
      lunchEnd = lunchEnd ?? scheduleLunchContext.defaultLunchEnd;
    } else {
      const settings = await (ctx.db.query("settings") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", employee.organizationId),
        )
        .first();
      const attSettings = settings?.attendanceSettings;
      lunchStart = lunchStart ?? attSettings?.defaultLunchStart ?? "12:00";
      lunchEnd = lunchEnd ?? attSettings?.defaultLunchEnd ?? "13:00";
    }
  }

  const updates: Record<string, unknown> = {};
  if (att.lunchStart == null && lunchStart != null)
    updates.lunchStart = lunchStart;
  if (att.lunchEnd == null && lunchEnd != null) updates.lunchEnd = lunchEnd;
  if (att.scheduleIn == null && scheduleIn != null)
    updates.scheduleIn = scheduleIn;
  if (att.scheduleOut == null && scheduleOut != null)
    updates.scheduleOut = scheduleOut;
  if (Object.keys(updates).length === 0) return att;
  return { ...att, ...updates };
}

/** One load per org per payroll run / batch; avoids N× org shifts+settings per employee. */
async function loadScheduleLunchContextForOrg(
  ctx: any,
  organizationId: any,
): Promise<ScheduleLunchContext> {
  const [orgShifts, settingsRow] = await Promise.all([
    (ctx.db.query("shifts") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
    (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", organizationId),
      )
      .first(),
  ]);
  const att = settingsRow?.attendanceSettings;
  return {
    orgShifts,
    defaultLunchStart: att?.defaultLunchStart ?? "12:00",
    defaultLunchEnd: att?.defaultLunchEnd ?? "13:00",
  };
}

/**
 * Overlap: endDate >= cutoffStart && startDate <= cutoffEnd.
 * Uses by_employee_status_endDate to avoid reading every past leave for the employee.
 */
async function getApprovedLeaveRequestsForPayrollPeriod(
  ctx: any,
  employeeId: any,
  cutoffStart: number,
  cutoffEnd: number,
): Promise<any[]> {
  return await (ctx.db.query("leaveRequests") as any)
    .withIndex("by_employee_status_endDate", (q: any) =>
      q
        .eq("employeeId", employeeId)
        .eq("status", "approved")
        .gte("endDate", cutoffStart),
    )
    .filter((q: any) => q.lte(q.field("startDate"), cutoffEnd))
    .collect();
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

  const dailyRateNoAllowance = getDailyRateForEmployee(employee, 0, 0, {
    includeAllowance: false,
    workingDaysPerYear,
  });

  return dailyRateNoAllowance * (workingDaysPerYear / 12);
}

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
    /** When set, skips re-fetching all org shifts + settings (callers running many employees per org should set this). */
    scheduleLunchContext?: ScheduleLunchContext;
  },
): Promise<PayrollBaseResult> {
  const { cutoffStart, cutoffEnd, payFrequency } = args;
  const employee = decryptEmployeeFromDb(args.employee);
  let payrollRates: PayrollRates;
  if (args.payrollRates) {
    payrollRates = args.payrollRates;
  } else {
    const res = await getPayrollRates(ctx, employee.organizationId);
    payrollRates = getEmployeePayrollRates(employee, res.base);
  }

  const scheduleLunchContext: ScheduleLunchContext =
    args.scheduleLunchContext ??
    (await loadScheduleLunchContextForOrg(ctx, employee.organizationId));

  // Index range: pay period plus a small buffer so overnight / segment logic in calculatePayrollBaseFromRecords
  // still sees prior-day rows whose work extends into the period (we do not load full employment history).
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const attendanceQueryStart = cutoffStart - 5 * MS_PER_DAY;
  const attendanceQueryEnd = cutoffEnd + 2 * MS_PER_DAY;

  const attendance = await (ctx.db.query("attendance") as any)
    .withIndex("by_employee_date", (q: any) =>
      q
        .eq("employeeId", employee._id)
        .gte("date", attendanceQueryStart)
        .lte("date", attendanceQueryEnd),
    )
    .collect();

  const holidays =
    args.holidays ??
    (await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId),
      )
      .collect());

  const approvedLeaves = await getApprovedLeaveRequestsForPayrollPeriod(
    ctx,
    employee._id,
    cutoffStart,
    cutoffEnd,
  );

  const leaveTypes =
    args.leaveTypes ??
    (await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId),
      )
      .collect());

  // Enrich attendance with lunch and schedule when missing (for night diff and break exclusion).
  // Schedule fallback lets "early in / late timeout" records still get night diff from the scheduled shift.
  const attendanceEnriched = await Promise.all(
    attendance.map((att: any) =>
      enrichAttendanceRecordWithSchedule(
        ctx,
        employee,
        att,
        scheduleLunchContext,
      ),
    ),
  );

  return calculatePayrollBaseFromRecords({
    employee,
    cutoffStart,
    cutoffEnd,
    payFrequency,
    payrollRates,
    attendance: attendanceEnriched,
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

type PayrollLine = {
  name: string;
  amount: number;
  type: string;
  /** When false, paid out but excluded from taxable gross (withholding base). */
  taxable?: boolean;
};

function sumTaxableIncentiveAmounts(lines: PayrollLine[]): number {
  return round2(
    lines.reduce((sum, line) => {
      if (line.taxable === false) return sum;
      return sum + (line.amount || 0);
    }, 0),
  );
}

function sumNonTaxableIncentiveAmounts(lines: PayrollLine[]): number {
  return round2(
    lines.reduce((sum, line) => {
      if (line.taxable === false) return sum + (line.amount || 0);
      return sum;
    }, 0),
  );
}

function recalculatePersistedPayslipTotals(args: {
  grossPay: number;
  previousIncentives?: PayrollLine[];
  nextIncentives?: PayrollLine[];
  nextDeductions: PayrollLine[];
  nextNonTaxableAllowance: number;
}) {
  const prevTax = sumTaxableIncentiveAmounts(args.previousIncentives ?? []);
  const nextTax = sumTaxableIncentiveAmounts(args.nextIncentives ?? []);
  const nextNonTax = sumNonTaxableIncentiveAmounts(args.nextIncentives ?? []);
  const preservedTaxableBase = round2(args.grossPay - prevTax);
  const nextGrossPay = round2(preservedTaxableBase + nextTax);
  const totalDeductions = round2(sumLineAmounts(args.nextDeductions));
  const totalEarnings = round2(
    nextGrossPay + args.nextNonTaxableAllowance + nextNonTax,
  );
  const nextNetPay = round2(Math.max(0, totalEarnings - totalDeductions));

  return {
    grossPay: nextGrossPay,
    totalDeductions,
    totalEarnings,
    netPay: nextNetPay,
  };
}

function getExpectedCutoffAllowanceForEmployee(
  employee: any,
  payFrequency: PayFrequency,
): number {
  return round2(
    getPerCutoffAmount(employee?.compensation?.allowance || 0, payFrequency),
  );
}

function shouldTreatZeroAllowanceAsExplicitOverride(args: {
  employee: any;
  cutoffStart: number;
  cutoffEnd: number;
  actualAllowance: number;
}): boolean {
  if (args.actualAllowance > 0) return false;
  const hireDateRaw =
    typeof args.employee?.employment?.hireDate === "number"
      ? args.employee.employment.hireDate
      : null;
  if (hireDateRaw == null) return false;
  const hireDate = new Date(hireDateRaw);
  const cutoffStartDate = new Date(args.cutoffStart);
  const cutoffEndDate = new Date(args.cutoffEnd);
  const hireDay = new Date(
    hireDate.getFullYear(),
    hireDate.getMonth(),
    hireDate.getDate(),
  ).getTime();
  const cutoffStartDay = new Date(
    cutoffStartDate.getFullYear(),
    cutoffStartDate.getMonth(),
    cutoffStartDate.getDate(),
  ).getTime();
  const cutoffEndDay = new Date(
    cutoffEndDate.getFullYear(),
    cutoffEndDate.getMonth(),
    cutoffEndDate.getDate(),
  ).getTime();

  return hireDay >= cutoffStartDay && hireDay <= cutoffEndDay;
}

type EmployeeGovSettings = {
  employeeId: any;
  sss: { enabled: boolean; frequency: "full" | "half" };
  pagibig: { enabled: boolean; frequency: "full" | "half" };
  philhealth: { enabled: boolean; frequency: "full" | "half" };
  tax: { enabled: boolean; frequency: "full" | "half" };
};

type EmployeeLineSet = {
  employeeId: any;
  deductions?: PayrollLine[];
  incentives?: PayrollLine[];
};

const GOV_DEDUCTION_NAMES = new Set([
  "SSS",
  "PhilHealth",
  "Pag-IBIG",
  "Withholding Tax",
]);

const GOV_DEDUCTIONS_EXCEPT_TAX = new Set(["SSS", "PhilHealth", "Pag-IBIG"]);

function applyGovSettingAmount(
  enabled: boolean | undefined,
  frequency: "full" | "half" | undefined,
  amount: number,
): number {
  if (!amount || amount <= 0) return 0;
  if (enabled === false) return 0;
  if (frequency === "half") return round2(amount / 2);
  return round2(amount);
}

function isGovernmentDeductionName(name: string): boolean {
  return GOV_DEDUCTION_NAMES.has((name || "").trim());
}

function buildAttendanceDeductionLines(
  payrollBase: PayrollBaseResult,
): PayrollLine[] {
  const lines: PayrollLine[] = [];
  const hasHolidayLate =
    payrollBase.lateDeductionSpecialHoliday > 0 ||
    payrollBase.lateDeductionRegularHoliday > 0;

  if (payrollBase.lateDeductionSpecialHoliday > 0) {
    lines.push({
      name: "Special Holiday Late",
      amount: payrollBase.lateDeductionSpecialHoliday,
      type: "attendance",
    });
  }
  if (payrollBase.lateDeductionRegularHoliday > 0) {
    lines.push({
      name: "Regular Holiday Late",
      amount: payrollBase.lateDeductionRegularHoliday,
      type: "attendance",
    });
  }
  if (payrollBase.lateDeductionRegularDay > 0) {
    lines.push({
      name: hasHolidayLate ? "Regular day late" : "Late",
      amount: payrollBase.lateDeductionRegularDay,
      type: "attendance",
    });
  }
  if (payrollBase.undertimeDeduction > 0) {
    lines.push({
      name: "Undertime",
      amount: payrollBase.undertimeDeduction,
      type: "attendance",
    });
  }
  if (payrollBase.absentDeduction > 0) {
    const noWorkDays = payrollBase.noWorkNoPayDays ?? 0;
    const absentDays = Math.max(0, payrollBase.absences - noWorkDays);
    const absenceLabel =
      noWorkDays > 0 && absentDays === 0
        ? `No work on a holiday (${payrollBase.absences} ${payrollBase.absences === 1 ? "day" : "days"})`
        : `Absent (${payrollBase.absences} ${payrollBase.absences === 1 ? "day" : "days"})`;
    lines.push({
      name: absenceLabel,
      amount: payrollBase.absentDeduction,
      type: "attendance",
    });
  }

  return lines;
}

function sumLineAmounts(lines: PayrollLine[]): number {
  return lines.reduce((sum, line) => sum + (line.amount || 0), 0);
}

/** TRAIN Law: annual cap for non-taxable other benefits (with 13th month in full rule). */
const TRAIN_ANNUAL_NON_TAXABLE_BENEFIT_CAP_PHP = 90_000;

async function getTrainNinetyThousandCapOnAdditions(
  ctx: any,
  organizationId: any,
): Promise<boolean> {
  const settings = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .first();
  return settings?.payrollSettings?.trainNinetyThousandCapOnAdditions === true;
}

async function getYtdNonTaxableIncentiveTotalForTrainCap(
  ctx: any,
  args: {
    employeeId: any;
    calendarYear: number;
    beforePeriodStart: number;
    excludePayrollRunId?: any;
  },
): Promise<number> {
  const startOfYear = new Date(args.calendarYear, 0, 1).getTime();
  const endOfYear = new Date(
    args.calendarYear,
    11,
    31,
    23,
    59,
    59,
    999,
  ).getTime();
  const rows = await (ctx.db.query("payslips") as any)
    .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
    .collect();
  let sum = 0;
  for (const p of rows) {
    if (
      args.excludePayrollRunId &&
      p.payrollRunId === args.excludePayrollRunId
    ) {
      continue;
    }
    const end = p.periodEnd;
    if (end == null) continue;
    if (end < startOfYear || end > endOfYear) continue;
    if (end >= args.beforePeriodStart) continue;
    const run = await ctx.db.get(p.payrollRunId);
    if (!run || (run.status !== "finalized" && run.status !== "paid")) {
      continue;
    }
    const raw = p.incentives;
    if (!raw || typeof raw === "string") continue;
    for (const inc of raw) {
      if (inc.taxable === false) {
        sum += Number(inc.amount) || 0;
      }
    }
  }
  return round2(sum);
}

function applyTrainNinetyThousandCapToIncentiveLines(
  lines: PayrollLine[],
  ytdNonTaxableUsed: number,
): PayrollLine[] {
  let room = Math.max(
    0,
    TRAIN_ANNUAL_NON_TAXABLE_BENEFIT_CAP_PHP - ytdNonTaxableUsed,
  );
  const out: PayrollLine[] = [];
  for (const line of lines) {
    const amt = round2(line.amount || 0);
    if (amt <= 0) continue;
    if (line.taxable !== false) {
      out.push({ ...line, amount: amt, taxable: true });
      continue;
    }
    const exempt = Math.min(amt, room);
    const taxableExcess = round2(amt - exempt);
    room = round2(room - exempt);
    if (exempt > 0) {
      out.push({
        ...line,
        amount: exempt,
        taxable: false,
      });
    }
    if (taxableExcess > 0) {
      out.push({
        ...line,
        name: `${line.name} (taxable — TRAIN excess over ₱90,000)`,
        amount: taxableExcess,
        taxable: true,
      });
    }
  }
  return out;
}

function finalizeIncentiveLinesForPayroll(
  lines: PayrollLine[],
  trainCapEnabled: boolean,
  ytdNonTaxableUsed: number,
): PayrollLine[] {
  if (trainCapEnabled) {
    return applyTrainNinetyThousandCapToIncentiveLines(
      lines,
      ytdNonTaxableUsed,
    );
  }
  return lines
    .map((line) => {
      const amt = round2(line.amount || 0);
      if (amt <= 0) return null;
      const taxable = line.taxable !== false;
      return { ...line, amount: amt, taxable } as PayrollLine;
    })
    .filter((x: PayrollLine | null): x is PayrollLine => x != null);
}

function getEmployeeIncentiveLines(
  employee: any,
  payFrequency: PayFrequency,
  manualIncentives?: PayrollLine[],
): PayrollLine[] {
  if (manualIncentives) {
    return manualIncentives.map((line) => ({
      name: line.name,
      amount: round2(line.amount || 0),
      type: line.type || "incentive",
      taxable: line.taxable,
    }));
  }

  const lines: PayrollLine[] = [];
  if (!employee.incentives) return lines;

  for (const incentive of employee.incentives) {
    if (!incentive.isActive) continue;
    let amount = 0;
    if (incentive.frequency === "monthly") {
      amount = getPerCutoffAmount(incentive.amount, payFrequency);
    } else if (incentive.frequency === "per-cutoff") {
      amount = incentive.amount;
    }
    if (amount > 0) {
      lines.push({
        name: incentive.name,
        amount: round2(amount),
        type: incentive.type || "incentive",
        taxable: true,
      });
    }
  }

  return lines;
}

async function buildCanonicalPayrollResult(ctx: any, args: {
  employeeId: any;
  employee: any;
  cutoffStart: number;
  cutoffEnd: number;
  payFrequency: PayFrequency;
  payrollBase: PayrollBaseResult;
  deductionsEnabled: boolean;
  taxSettings: {
    taxDeductionFrequency: "once_per_month" | "twice_per_month";
    taxDeductOnPay: "first" | "second";
  };
  govSettings?: EmployeeGovSettings;
  manualDeductionEntry?: { employeeId: any; deductions: PayrollLine[] };
  incentiveEntry?: { employeeId: any; incentives: PayrollLine[] };
  excludePayrollRunId?: any;
  nonTaxableAllowanceOverride?: number;
}) {
  const employee = args.employee;
  const payrollBase = args.payrollBase;
  const now = Date.now();
  const hasWorkedAtLeastOneDay = payrollBase.daysWorked > 0;
  const attendanceDeductions = buildAttendanceDeductionLines(payrollBase);

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

  const baseGovAmounts = {
    sss: getGovDeductionAmount(
      sssContribution.employeeShare,
      args.cutoffStart,
      args.payFrequency,
    ),
    philhealth: getGovDeductionAmount(
      PHILHEALTH_EMPLOYEE_MONTHLY,
      args.cutoffStart,
      args.payFrequency,
    ),
    pagibig: getGovDeductionAmount(
      PAGIBIG_EMPLOYEE_MONTHLY,
      args.cutoffStart,
      args.payFrequency,
    ),
    tax: getTaxDeductionAmount(
      monthlyTax,
      args.cutoffStart,
      args.payFrequency,
      args.taxSettings.taxDeductionFrequency,
      args.taxSettings.taxDeductOnPay,
    ),
  };

  let deductions: PayrollLine[] = [];
  const manualDeductionLines = args.manualDeductionEntry?.deductions ?? [];
  const hasOverrideGovernmentDeductions = manualDeductionLines.some((line) =>
    isGovernmentDeductionName(line.name),
  );

  if (hasOverrideGovernmentDeductions) {
    let nonAttendanceOverrideLines = manualDeductionLines.filter(
      (line) => !isAttendanceDeductionEntry(line),
    );
    // When Step 4 / payslip already lists government lines, that list is authoritative
    // for *which* lines exist—do not re-inject Withholding Tax if the user removed it.
    // Still honor Step 3 toggles by dropping disabled government rows.
    if (args.govSettings) {
      if (args.deductionsEnabled !== false) {
        if (!args.govSettings.sss.enabled) {
          nonAttendanceOverrideLines = nonAttendanceOverrideLines.filter(
            (line) => line.name !== "SSS",
          );
        }
        if (!args.govSettings.philhealth.enabled) {
          nonAttendanceOverrideLines = nonAttendanceOverrideLines.filter(
            (line) => line.name !== "PhilHealth",
          );
        }
        if (!args.govSettings.pagibig.enabled) {
          nonAttendanceOverrideLines = nonAttendanceOverrideLines.filter(
            (line) => line.name !== "Pag-IBIG",
          );
        }
      }
      if (!args.govSettings.tax.enabled) {
        nonAttendanceOverrideLines = nonAttendanceOverrideLines.filter(
          (line) => line.name !== "Withholding Tax",
        );
      }
    }
    deductions =
      args.deductionsEnabled === false
        ? nonAttendanceOverrideLines.filter(
            (line) => !GOV_DEDUCTIONS_EXCEPT_TAX.has(line.name),
          )
        : [...nonAttendanceOverrideLines];
  } else {
    if (args.deductionsEnabled) {
      const sssAmount = applyGovSettingAmount(
        args.govSettings?.sss.enabled,
        args.govSettings?.sss.frequency,
        baseGovAmounts.sss,
      );
      const philhealthAmount = applyGovSettingAmount(
        args.govSettings?.philhealth.enabled,
        args.govSettings?.philhealth.frequency,
        baseGovAmounts.philhealth,
      );
      const pagibigAmount = applyGovSettingAmount(
        args.govSettings?.pagibig.enabled,
        args.govSettings?.pagibig.frequency,
        baseGovAmounts.pagibig,
      );

      if (sssAmount > 0) {
        deductions.push({ name: "SSS", amount: sssAmount, type: "government" });
      }
      if (philhealthAmount > 0) {
        deductions.push({
          name: "PhilHealth",
          amount: philhealthAmount,
          type: "government",
        });
      }
      if (pagibigAmount > 0) {
        deductions.push({
          name: "Pag-IBIG",
          amount: pagibigAmount,
          type: "government",
        });
      }
    }

    const taxEnabled = !args.govSettings
      ? baseGovAmounts.tax > 0
      : args.govSettings.tax.enabled && baseGovAmounts.tax > 0;
    if (taxEnabled) {
      deductions.push({
        name: "Withholding Tax",
        amount: round2(baseGovAmounts.tax),
        type: "government",
      });
    }

    for (const line of manualDeductionLines.filter(
      (entry) => !isAttendanceDeductionEntry(entry),
    )) {
      deductions.push({
        name: line.name,
        amount: round2(line.amount || 0),
        type: line.type,
      });
    }

    if (employee.deductions) {
      for (const deduction of employee.deductions) {
        if (!deduction.isActive) continue;
        if (isAttendanceDeductionName(deduction.name || "")) continue;
        if (
          deduction.startDate > now ||
          (deduction.endDate && deduction.endDate < now)
        ) {
          continue;
        }
        deductions.push({
          name: deduction.name,
          amount: round2(
            deduction.frequency === "monthly"
              ? getPerCutoffAmount(deduction.amount, args.payFrequency)
              : deduction.amount,
          ),
          type: deduction.type,
        });
      }
    }
  }

  deductions.push(...attendanceDeductions);

  const orgId = employee.organizationId;
  const trainCapEnabled = await getTrainNinetyThousandCapOnAdditions(
    ctx,
    orgId,
  );
  const calendarYear = new Date(args.cutoffEnd).getFullYear();
  const ytdTrain = trainCapEnabled
    ? await getYtdNonTaxableIncentiveTotalForTrainCap(ctx, {
        employeeId: args.employeeId,
        calendarYear,
        beforePeriodStart: args.cutoffStart,
        excludePayrollRunId: args.excludePayrollRunId,
      })
    : 0;
  const rawIncentiveLines = getEmployeeIncentiveLines(
    employee,
    args.payFrequency,
    args.incentiveEntry?.incentives,
  );
  const incentives = finalizeIncentiveLinesForPayroll(
    rawIncentiveLines,
    trainCapEnabled,
    ytdTrain,
  );
  const totalTaxableIncentives = sumTaxableIncentiveAmounts(incentives);
  const totalNonTaxableIncentives = sumNonTaxableIncentiveAmounts(incentives);

  const isDailyizedFirstCutoff = payrollBase.dailyizedFirstCutoff === true;
  let nonTaxableAllowance =
    args.nonTaxableAllowanceOverride !== undefined
      ? round2(args.nonTaxableAllowanceOverride)
      : isDailyizedFirstCutoff
        ? 0
        : round2(
            getPerCutoffAmount(
              employee.compensation.allowance || 0,
              args.payFrequency,
            ) * (payrollBase.employmentProrationRatio ?? 1),
          );

  const grossPay = round2(
    payrollBase.basicPay +
      payrollBase.holidayPay +
      payrollBase.nightDiffPay +
      totalTaxableIncentives,
  );

  const qualifiesForFirstCutoffTax =
    !isDailyizedFirstCutoff || grossPay > 20_833;
  if (!qualifiesForFirstCutoffTax) {
    deductions = deductions.filter((line) => line.name !== "Withholding Tax");
  }

  const sameMonthPreviousPayslips = await findSameMonthPreviousPayslips(ctx, {
    employeeId: args.employeeId,
    cutoffStart: args.cutoffStart,
    excludePayrollRunId: args.excludePayrollRunId,
  });
  const previousPendingDeductions = pickMostRecentPendingDeductions(
    sameMonthPreviousPayslips,
  );

  let pendingDeductions = 0;
  if (!hasWorkedAtLeastOneDay) {
    const govTotal = deductions
      .filter((line) => isGovernmentDeductionName(line.name))
      .reduce((sum, line) => sum + line.amount, 0);
    pendingDeductions = round2(govTotal);
    deductions = deductions.filter(
      (line) => !isGovernmentDeductionName(line.name),
    );
  }

  if (hasWorkedAtLeastOneDay && previousPendingDeductions > 0) {
    deductions.push({
      name: PENDING_PREVIOUS_CUTOFF_DEDUCTION_NAME,
      amount: round2(previousPendingDeductions),
      type: "government",
    });
  } else if (previousPendingDeductions > 0) {
    pendingDeductions = round2(
      pendingDeductions + previousPendingDeductions,
    );
  }

  deductions = deductions
    .map((line) => ({
      name: line.name,
      amount: round2(line.amount || 0),
      type: line.type,
    }))
    .filter((line) => line.amount > 0);

  const totalDeductions = sumLineAmounts(deductions);
  const attendanceDeductionsTotal = sumLineAmounts(
    deductions.filter((line) => line.type === "attendance"),
  );
  const nonAttendanceDeductionsTotal = round2(
    totalDeductions - attendanceDeductionsTotal,
  );
  const totalEarnings = round2(
    grossPay + nonTaxableAllowance + totalNonTaxableIncentives,
  );
  const earnedAfterAttendance = round2(totalEarnings - attendanceDeductionsTotal);

  let netPay = round2(earnedAfterAttendance - nonAttendanceDeductionsTotal);

  if (
    nonAttendanceDeductionsTotal > earnedAfterAttendance &&
    earnedAfterAttendance > 0
  ) {
    const excessDeductions = round2(
      nonAttendanceDeductionsTotal - earnedAfterAttendance,
    );
    pendingDeductions = round2(pendingDeductions + excessDeductions);
    const pendingIndex = deductions.findIndex(
      (line) => line.name === PENDING_PREVIOUS_CUTOFF_DEDUCTION_NAME,
    );
    if (pendingIndex >= 0) {
      const remaining = round2(deductions[pendingIndex].amount - excessDeductions);
      if (remaining <= 0) {
        deductions.splice(pendingIndex, 1);
      } else {
        deductions[pendingIndex].amount = remaining;
      }
    }
    netPay = 0;
  } else if (earnedAfterAttendance <= 0) {
    pendingDeductions = round2(
      pendingDeductions + nonAttendanceDeductionsTotal,
    );
    deductions = deductions.filter((line) => line.type === "attendance");
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

  return {
    grossPay,
    basicPay: round2(payrollBase.basicPay),
    deductions,
    incentives,
    nonTaxableAllowance:
      nonTaxableAllowance > 0 ? round2(nonTaxableAllowance) : undefined,
    totalEarnings,
    totalDeductions: round2(sumLineAmounts(deductions)),
    taxableGrossEarnings: grossPay,
    netPay: round2(Math.max(0, netPay)),
    pendingDeductions:
      pendingDeductions > 0 ? round2(pendingDeductions) : undefined,
    hasWorkedAtLeastOneDay,
    employerContributions:
      Object.keys(employerContributions).length > 0
        ? employerContributions
        : undefined,
    dailyizedFirstCutoff: isDailyizedFirstCutoff,
  };
}

// Compute payroll for employee
export const computeEmployeePayroll = query({
  args: {
    employeeId: v.id("employees"),
    cutoffStart: v.number(),
    cutoffEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const employeeRaw = await ctx.db.get(args.employeeId);
    if (!employeeRaw) throw new Error("Employee not found");
    const employee = decryptEmployeeFromDb(employeeRaw);

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
    const taxSettings = await getTaxDeductionSettings(
      ctx,
      employee.organizationId,
    );
    const canonical = await buildCanonicalPayrollResult(ctx, {
      employeeId: args.employeeId,
      employee,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      payFrequency,
      payrollBase,
      deductionsEnabled: true,
      taxSettings,
    });

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
      restDayPay: payrollBase.restDayPremiumPay ?? 0,
      nightDiffPay: payrollBase.nightDiffPay,
      nightDiffBreakdown: payrollBase.nightDiffBreakdown,
      overtimeRegular: payrollBase.overtimeRegular,
      overtimeRestDay: payrollBase.overtimeRestDay,
      overtimeRestDayExcess: payrollBase.overtimeRestDayExcess,
      overtimeSpecialHoliday: payrollBase.overtimeSpecialHoliday,
      overtimeSpecialHolidayExcess: payrollBase.overtimeSpecialHolidayExcess,
      overtimeLegalHoliday: payrollBase.overtimeLegalHoliday,
      overtimeLegalHolidayExcess: payrollBase.overtimeLegalHolidayExcess,
      lateDeduction: payrollBase.lateDeduction,
      lateDeductionRegularDay: payrollBase.lateDeductionRegularDay,
      lateDeductionRegularHoliday: payrollBase.lateDeductionRegularHoliday,
      lateDeductionSpecialHoliday: payrollBase.lateDeductionSpecialHoliday,
      absentDeduction: payrollBase.absentDeduction,
      undertimeDeduction: payrollBase.undertimeDeduction,
      deductions: canonical.deductions,
      incentives: canonical.incentives,
      incentiveTotal: sumLineAmounts(canonical.incentives),
      grossPay: canonical.grossPay,
      taxableGrossEarnings: canonical.taxableGrossEarnings,
      totalEarnings: canonical.totalEarnings,
      totalDeductions: canonical.totalDeductions,
      nonTaxableAllowance: canonical.nonTaxableAllowance ?? 0,
      netPay: canonical.netPay,
      pendingDeductions: canonical.pendingDeductions,
      hasWorkedAtLeastOneDay: canonical.hasWorkedAtLeastOneDay,
      dailyizedFirstCutoff: canonical.dailyizedFirstCutoff,
    };
  },
});

export const computePayrollPreviewBatch = query({
  args: {
    organizationId: v.id("organizations"),
    cutoffStart: v.number(),
    cutoffEnd: v.number(),
    employeeIds: v.array(v.id("employees")),
    deductionsEnabled: v.optional(v.boolean()),
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
              taxable: v.optional(v.boolean()),
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
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    const organization = await ctx.db.get(args.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    const payFrequency = getOrganizationPayFrequency(organization);
    const baseRates = (await getPayrollRates(ctx, args.organizationId)).base;
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
    const scheduleLunchContext = await loadScheduleLunchContextForOrg(
      ctx,
      args.organizationId,
    );
    const taxSettings = await getTaxDeductionSettings(ctx, args.organizationId);
    const deductionsEnabled = args.deductionsEnabled ?? true;

    const results = await Promise.all(
      args.employeeIds.map(async (employeeId) => {
        const employeeRow = await ctx.db.get(employeeId);
        if (
          !employeeRow ||
          employeeRow.organizationId !== args.organizationId
        ) {
          return null;
        }

        const employee = decryptEmployeeFromDb(employeeRow);
        const employeeRates = getEmployeePayrollRates(employee, baseRates);
        const payrollBase = await buildEmployeePayrollBase(ctx, {
          employee: employeeRow,
          cutoffStart: args.cutoffStart,
          cutoffEnd: args.cutoffEnd,
          payFrequency,
          payrollRates: employeeRates,
          holidays,
          leaveTypes,
          scheduleLunchContext,
        });

        const canonical = await buildCanonicalPayrollResult(ctx, {
          employeeId,
          employee,
          cutoffStart: args.cutoffStart,
          cutoffEnd: args.cutoffEnd,
          payFrequency,
          payrollBase,
          deductionsEnabled,
          taxSettings,
          govSettings: args.governmentDeductionSettings?.find(
            (entry) => entry.employeeId === employeeId,
          ),
          manualDeductionEntry: args.manualDeductions?.find(
            (entry) => entry.employeeId === employeeId,
          ),
          incentiveEntry: args.incentives?.find(
            (entry) => entry.employeeId === employeeId,
          ),
        });

        return {
          employeeId,
          employee,
          ...payrollBase,
          ...canonical,
        };
      }),
    );

    return results.filter(Boolean);
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
              taxable: v.optional(v.boolean()),
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
    const period = `${formatManilaNumericDate(args.cutoffStart)} to ${formatManilaNumericDate(args.cutoffEnd)}`;

    const deductionsEnabled = args.deductionsEnabled ?? true;
    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId: args.organizationId,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      period,
      status: "draft",
      processedBy: userRecord._id,
      deductionsEnabled,
      draftConfig: encryptDraftConfigForDb(
        buildDraftPayrollConfig({
          employeeIds: args.employeeIds,
          manualDeductions: args.manualDeductions,
          incentives: args.incentives,
          governmentDeductionSettings: args.governmentDeductionSettings,
        }),
      ),
      createdAt: now,
      updatedAt: now,
    });

    const { rates } = await getPayrollRates(ctx, args.organizationId);
    const taxSettings = await getTaxDeductionSettings(ctx, args.organizationId);
    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Backfill isHoliday/holidayType on attendance. Only set when holiday applies to this employee's province.
    const _cutRangeEnd = args.cutoffEnd + 24 * 60 * 60 * 1000 - 1;
    for (const employeeId of args.employeeIds) {
      const employeeRow = await ctx.db.get(employeeId);
      const employee = employeeRow
        ? decryptEmployeeFromDb(employeeRow)
        : null;
      const attendance = await (ctx.db.query("attendance") as any)
        .withIndex("by_employee_date", (q: any) =>
          q
            .eq("employeeId", employeeId)
            .gte("date", args.cutoffStart)
            .lte("date", _cutRangeEnd),
        )
        .collect();
      for (const rec of attendance) {
        const holiday = holidays.find((h: any) =>
          holidayMatchesDateLib(h, rec.date),
        );
        if (
          holiday &&
          employee &&
          holidayAppliesToEmployee(holiday, employee)
        ) {
          await ctx.db.patch(rec._id, {
            isHoliday: true,
            holidayType: holiday.type,
            updatedAt: now,
          });
        } else if (rec.isHoliday || rec.holidayType) {
          // Holiday deleted or doesn't apply to this employee's province — clear
          await ctx.db.patch(rec._id, {
            isHoliday: false,
            holidayType: undefined,
            updatedAt: now,
          });
        }
      }
    }
    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const createRunScheduleLunchContext = await loadScheduleLunchContextForOrg(
      ctx,
      args.organizationId,
    );

    // Compute and create payslips for each employee
    for (const employeeId of args.employeeIds) {
      const employeeRow = await ctx.db.get(employeeId);
      if (!employeeRow || employeeRow.organizationId !== args.organizationId) {
        continue;
      }
      const employee = decryptEmployeeFromDb(employeeRow);

      const payrollBase = await buildEmployeePayrollBase(ctx, {
        employee: employeeRow,
        cutoffStart: args.cutoffStart,
        cutoffEnd: args.cutoffEnd,
        payFrequency,
        payrollRates: rates,
        holidays,
        leaveTypes,
        scheduleLunchContext: createRunScheduleLunchContext,
      });

      // Get government deduction settings for this employee
      const govSettings = args.governmentDeductionSettings?.find(
        (gs) => gs.employeeId === employeeId,
      );
      const manualDeductionEntry = args.manualDeductions?.find(
        (md) => md.employeeId === employeeId,
      );
      const incentiveEntry = args.incentives?.find(
        (inc) => inc.employeeId === employeeId,
      );
      const canonical = await buildCanonicalPayrollResult(ctx, {
        employeeId,
        employee,
        cutoffStart: args.cutoffStart,
        cutoffEnd: args.cutoffEnd,
        payFrequency,
        payrollBase,
        deductionsEnabled,
        taxSettings,
        govSettings,
        manualDeductionEntry,
        incentiveEntry,
      });
      await ctx.db.insert(
        "payslips",
        encryptPayslipRowForDb({
          organizationId: args.organizationId,
          employeeId,
          employeeSnapshot: buildEmployeeSnapshot(employee),
          payrollRunId,
          period,
          periodStart: args.cutoffStart,
          periodEnd: args.cutoffEnd,
          grossPay: canonical.grossPay,
          basicPay: canonical.basicPay,
          deductions: canonical.deductions,
          incentives:
            canonical.incentives.length > 0 ? canonical.incentives : undefined,
          nonTaxableAllowance: canonical.nonTaxableAllowance,
          netPay: canonical.netPay,
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
          nightDiffBreakdown: payrollBase.nightDiffBreakdown,
          restDayPay:
            (payrollBase.restDayPremiumPay ?? 0) > 0
              ? round2(payrollBase.restDayPremiumPay!)
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
          pendingDeductions: canonical.pendingDeductions,
          noWorkNoPayDays:
            (payrollBase.noWorkNoPayDays ?? 0) > 0
              ? payrollBase.noWorkNoPayDays
              : undefined,
          hasWorkedAtLeastOneDay: canonical.hasWorkedAtLeastOneDay,
          employerContributions: canonical.employerContributions,
          concernSummary: {
            messageCount: 0,
          },
          createdAt: now,
        }) as any,
      );
    }

    // Keep status as "draft" - user can review and finalize later
    // Mark that deductions (gov + attendance) were applied when saving this draft
    const draftDependencySnapshot = await captureDraftDependencySnapshot(ctx, {
      organizationId: args.organizationId,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      employeeIds: args.employeeIds,
    });
    await ctx.db.patch(payrollRunId, {
      processedAt: now,
      deductionsEnabled,
      draftDependencySnapshot,
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
              taxable: v.optional(v.boolean()),
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
    type GovSettingsEntry = {
      employeeId: any;
      sss: { enabled: boolean; frequency: "full" | "half" };
      pagibig: { enabled: boolean; frequency: "full" | "half" };
      philhealth: { enabled: boolean; frequency: "full" | "half" };
      tax: { enabled: boolean; frequency: "full" | "half" };
    };
    type ManualDeductionEntry = {
      employeeId: any;
      deductions: Array<{ name: string; amount: number; type: string }>;
    };
    type IncentiveEntry = {
      employeeId: any;
      incentives: Array<{ name: string; amount: number; type: string }>;
    };

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
    const previousDraftConfig = decryptDraftConfigFromDb(
      payrollRun.draftConfig,
    ) ?? {
      employeeIds: [],
    };
    const resolvedGovernmentDeductionSettings: GovSettingsEntry[] = Array.isArray(
      args.governmentDeductionSettings,
    )
      ? (args.governmentDeductionSettings as GovSettingsEntry[])
      : Array.isArray(previousDraftConfig.governmentDeductionSettings)
        ? (previousDraftConfig.governmentDeductionSettings as GovSettingsEntry[])
        : [];
    const resolvedManualDeductions: ManualDeductionEntry[] = Array.isArray(
      args.manualDeductions,
    )
      ? (args.manualDeductions as ManualDeductionEntry[])
      : Array.isArray(previousDraftConfig.manualDeductions)
        ? (previousDraftConfig.manualDeductions as ManualDeductionEntry[])
        : [];
    const resolvedIncentives: IncentiveEntry[] = Array.isArray(args.incentives)
      ? (args.incentives as IncentiveEntry[])
      : Array.isArray(previousDraftConfig.incentives)
        ? (previousDraftConfig.incentives as IncentiveEntry[])
        : [];

    const existingPayslipsBeforeRegenerate = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    let mergedManualDeductions: ManualDeductionEntry[] = resolvedManualDeductions;
    let mergedIncentives: IncentiveEntry[] = resolvedIncentives;
    let mergedNonTaxableAllowanceOverrides: Array<{
      employeeId: any;
      amount: number;
    }> = Array.isArray(previousDraftConfig.nonTaxableAllowanceOverrides)
      ? [...previousDraftConfig.nonTaxableAllowanceOverrides]
      : [];

    if (existingPayslipsBeforeRegenerate.length > 0) {
      // When the client sends explicit manualDeductions / incentives, those override
      // (e.g. Step 4 edits). Only merge from old payslips for allowance detection.
      const explicitManual = args.manualDeductions !== undefined;
      const explicitIncentives = args.incentives !== undefined;
      const organizationForAllowance = await ctx.db.get(
        payrollRun.organizationId,
      );
      const payFrequencyForAllowance: PayFrequency =
        getOrganizationPayFrequency(organizationForAllowance);

      const manualByEmp = new Map<string, ManualDeductionEntry>();
      for (const m of resolvedManualDeductions) {
        manualByEmp.set(String(m.employeeId), {
          employeeId: m.employeeId,
          deductions: [...(m.deductions || [])],
        });
      }
      const incByEmp = new Map<string, IncentiveEntry>();
      for (const i of resolvedIncentives) {
        incByEmp.set(String(i.employeeId), {
          employeeId: i.employeeId,
          incentives: [...(i.incentives || [])],
        });
      }
      const allowanceOverridesByEmp = new Map<string, number>();
      for (const o of mergedNonTaxableAllowanceOverrides) {
        allowanceOverridesByEmp.set(String(o.employeeId), o.amount);
      }

      for (const raw of existingPayslipsBeforeRegenerate) {
        const p = decryptPayslipRowFromDb(raw);
        if (!p) continue;
        const empId = p.employeeId;
        if (!explicitManual) {
          const preservedDeductions = (p.deductions || []).filter(
            (d: { name?: string; type?: string }) =>
              !isAttendanceDeductionEntry(d) &&
              (d.name || "") !== PENDING_PREVIOUS_CUTOFF_DEDUCTION_NAME,
          );
          manualByEmp.set(String(empId), {
            employeeId: empId,
            deductions: preservedDeductions,
          });
        }
        if (!explicitIncentives) {
          incByEmp.set(String(empId), {
            employeeId: empId,
            incentives: p.incentives ? [...p.incentives] : [],
          });
        }

        const empRow = await ctx.db.get(empId);
        if (empRow) {
          const employee = decryptEmployeeFromDb(empRow as any);
          const defaultAllow = getExpectedCutoffAllowanceForEmployee(
            employee,
            payFrequencyForAllowance,
          );
          const actualAllow = p.nonTaxableAllowance ?? 0;
          const monthlyAllowance = round2(employee.compensation.allowance || 0);
          const maxReasonableAllowance = Math.max(defaultAllow, monthlyAllowance);
          if (actualAllow > maxReasonableAllowance) {
            allowanceOverridesByEmp.delete(String(empId));
            continue;
          }
          if (
            actualAllow <= 0 &&
            defaultAllow > 0 &&
            !shouldTreatZeroAllowanceAsExplicitOverride({
              employee,
              cutoffStart: args.cutoffStart ?? payrollRun.cutoffStart,
              cutoffEnd: args.cutoffEnd ?? payrollRun.cutoffEnd,
              actualAllowance: actualAllow,
            })
          ) {
            allowanceOverridesByEmp.delete(String(empId));
            continue;
          }
          if (
            Math.abs(round2(actualAllow) - round2(defaultAllow)) > 0.001
          ) {
            allowanceOverridesByEmp.set(String(empId), round2(actualAllow));
          } else {
            allowanceOverridesByEmp.delete(String(empId));
          }
        }
      }

      mergedManualDeductions = Array.from(manualByEmp.values());
      mergedIncentives = Array.from(incByEmp.values());
      mergedNonTaxableAllowanceOverrides = Array.from(
        allowanceOverridesByEmp.entries(),
      ).map(([employeeId, amount]) => ({
        employeeId: employeeId as any,
        amount,
      }));
    }

    await ctx.db.patch(args.payrollRunId, {
      cutoffStart: args.cutoffStart ?? payrollRun.cutoffStart,
      cutoffEnd: args.cutoffEnd ?? payrollRun.cutoffEnd,
      period,
      deductionsEnabled: runDeductionsEnabled,
      draftConfig: encryptDraftConfigForDb(
        buildDraftPayrollConfig({
          employeeIds: args.employeeIds ?? previousDraftConfig.employeeIds ?? [],
          manualDeductions: mergedManualDeductions,
          incentives: mergedIncentives,
          governmentDeductionSettings: resolvedGovernmentDeductionSettings,
          nonTaxableAllowanceOverrides:
            mergedNonTaxableAllowanceOverrides.length > 0
              ? mergedNonTaxableAllowanceOverrides
              : undefined,
        }),
      ),
      updatedAt: Date.now(),
    });

    // Always regenerate payslips for draft runs so late categorization (Regular Holiday Late vs Late) stays correct
    {
      const existingPayslips = existingPayslipsBeforeRegenerate;
      const existingEmployeeIds = existingPayslips.map(
        (p: any) => p.employeeId,
      );

      for (const payslip of existingPayslips) {
        await ctx.db.delete(payslip._id);
      }

      const employeeIds =
        args.employeeIds ??
        (existingEmployeeIds.length > 0
          ? existingEmployeeIds
          : (previousDraftConfig.employeeIds ?? []));
      const cutoffStart = args.cutoffStart ?? payrollRun.cutoffStart;
      const cutoffEnd = args.cutoffEnd ?? payrollRun.cutoffEnd;

      const { rates } = await getPayrollRates(ctx, payrollRun.organizationId);
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

      const nowUpdate = Date.now();
      const _MS = 24 * 60 * 60 * 1000;
      const rangeEnd = cutoffEnd + _MS - 1;
      for (const employeeId of employeeIds) {
        const attendance = await (ctx.db.query("attendance") as any)
          .withIndex("by_employee_date", (q: any) =>
            q
              .eq("employeeId", employeeId)
              .gte("date", cutoffStart)
              .lte("date", rangeEnd),
          )
          .collect();
        for (const rec of attendance) {
          const holiday = holidays.find((h: any) =>
            holidayMatchesDateLib(h, rec.date),
          );
          const empRow = (await ctx.db.get(employeeId)) as any;
          const emp = empRow ? decryptEmployeeFromDb(empRow) : null;
          if (holiday && emp && holidayAppliesToEmployee(holiday, emp)) {
            await ctx.db.patch(rec._id, {
              isHoliday: true,
              holidayType: holiday.type,
              updatedAt: nowUpdate,
            });
          } else if (rec.isHoliday || rec.holidayType) {
            await ctx.db.patch(rec._id, {
              isHoliday: false,
              holidayType: undefined,
              updatedAt: nowUpdate,
            });
          }
        }
      }

      const runScheduleLunchContext = await loadScheduleLunchContextForOrg(
        ctx,
        payrollRun.organizationId,
      );
      for (const employeeId of employeeIds) {
        const employeeRow = (await ctx.db.get(employeeId)) as any;
        if (
          !employeeRow ||
          employeeRow.organizationId !== payrollRun.organizationId
        ) {
          continue;
        }
        const employee = decryptEmployeeFromDb(employeeRow);

        const payrollBase = await buildEmployeePayrollBase(ctx, {
          employee: employeeRow,
          cutoffStart,
          cutoffEnd,
          payFrequency: payFrequencyUpdate,
          payrollRates: rates,
          holidays,
          leaveTypes,
          scheduleLunchContext: runScheduleLunchContext,
        });

        const govSettings = resolvedGovernmentDeductionSettings.find(
          (gs) => gs.employeeId === employeeId,
        );
        const manualDeductionEntry = mergedManualDeductions.find(
          (md) => md.employeeId === employeeId,
        );
        const allowanceOverrideEntry = mergedNonTaxableAllowanceOverrides.find(
          (entry: { employeeId: any }) => entry.employeeId === employeeId,
        );
        const incentiveEntry = mergedIncentives.find(
          (entry) => entry.employeeId === employeeId,
        );
        const canonical = await buildCanonicalPayrollResult(ctx, {
          employeeId,
          employee,
          cutoffStart,
          cutoffEnd,
          payFrequency: payFrequencyUpdate,
          payrollBase,
          deductionsEnabled: runDeductionsEnabled,
          taxSettings: taxSettingsUpdate,
          govSettings,
          manualDeductionEntry,
          incentiveEntry,
          excludePayrollRunId: args.payrollRunId,
          nonTaxableAllowanceOverride: allowanceOverrideEntry?.amount,
        });

        await ctx.db.insert(
          "payslips",
          encryptPayslipRowForDb({
            organizationId: payrollRun.organizationId,
            employeeId,
            employeeSnapshot: buildEmployeeSnapshot(employee),
            payrollRunId: args.payrollRunId,
            period,
            periodStart: cutoffStart,
            periodEnd: cutoffEnd,
            grossPay: canonical.grossPay,
            basicPay: canonical.basicPay,
            deductions: canonical.deductions,
            incentives:
              canonical.incentives.length > 0 ? canonical.incentives : undefined,
            nonTaxableAllowance: canonical.nonTaxableAllowance,
            netPay: canonical.netPay,
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
            nightDiffBreakdown: payrollBase.nightDiffBreakdown,
            restDayPay:
              (payrollBase.restDayPremiumPay ?? 0) > 0
                ? round2(payrollBase.restDayPremiumPay!)
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
            pendingDeductions: canonical.pendingDeductions,
            noWorkNoPayDays:
              (payrollBase.noWorkNoPayDays ?? 0) > 0
                ? payrollBase.noWorkNoPayDays
                : undefined,
            hasWorkedAtLeastOneDay: canonical.hasWorkedAtLeastOneDay,
            employerContributions: canonical.employerContributions,
            concernSummary: {
              messageCount: 0,
            },
            createdAt: Date.now(),
          }) as any,
        );
      }

      const refreshedSnapshot = await captureDraftDependencySnapshot(ctx, {
        organizationId: payrollRun.organizationId,
        cutoffStart,
        cutoffEnd,
        employeeIds,
      });
      await ctx.db.patch(args.payrollRunId, {
        draftDependencySnapshot: refreshedSnapshot,
        updatedAt: Date.now(),
      });
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

    if (
      args.status === "finalized" &&
      payrollRun.status === "draft" &&
      (payrollRun.runType ?? "regular") === "regular"
    ) {
      const employeeIds = await resolveDraftEmployeeIdsForRun(ctx, payrollRun);
      const currentSnapshot = await captureDraftDependencySnapshot(ctx, {
        organizationId: payrollRun.organizationId,
        cutoffStart: payrollRun.cutoffStart,
        cutoffEnd: payrollRun.cutoffEnd,
        employeeIds,
      });
      const savedSnapshot = payrollRun.draftDependencySnapshot as
        | DraftDependencySnapshot
        | undefined;
      if (hasDraftDependenciesChanged(savedSnapshot, currentSnapshot)) {
        throw new Error(
          "Draft is outdated due to attendance/holiday/rate/schedule changes. Regenerate payslips before finalizing.",
        );
      }
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

// Delete multiple payroll runs in one mutation (faster than many round-trips)
export const deletePayrollRuns = mutation({
  args: {
    payrollRunIds: v.array(v.id("payrollRuns")),
  },
  handler: async (ctx, args) => {
    const uniqueRunIds = Array.from(new Set(args.payrollRunIds.map(String)));
    if (uniqueRunIds.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const firstRun = (await ctx.db.get(uniqueRunIds[0] as any)) as any;
    if (!firstRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, firstRun.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to delete payroll runs");
    }

    let deletedCount = 0;
    for (const payrollRunId of uniqueRunIds) {
      const payrollRun = (await ctx.db.get(payrollRunId as any)) as any;
      if (!payrollRun) continue;
      if (payrollRun.organizationId !== firstRun.organizationId) continue;

      // Delete associated accounting cost items
      await deleteExpenseItemsFromPayroll(ctx, payrollRun);

      // Delete payslips
      const payslips = await (ctx.db.query("payslips") as any)
        .withIndex("by_payroll_run", (q: any) =>
          q.eq("payrollRunId", payrollRun._id),
        )
        .collect();
      for (const payslip of payslips) {
        await ctx.db.delete(payslip._id);
      }

      // Delete payroll run
      await ctx.db.delete(payrollRun._id);
      deletedCount += 1;
    }

    return { success: true, deletedCount };
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
  const payslipsRaw = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) =>
      q.eq("payrollRunId", payrollRun._id),
    )
    .collect();
  const payslips = payslipsRaw.map((p: any) => decryptPayslipRowFromDb(p)!);

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
  if (totalEmployeeSSS > 0 || totalSSSEmployer > 0)
    activeExpenseNames.add(sssExpenseName);
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
    const out: any[] = [];
    for (const run of runs) {
      const dec = decryptPayrollRunFromDb(run);
      if (
        dec.status === "draft" &&
        (dec.runType ?? "regular") === "regular"
      ) {
        const employeeIds = await resolveDraftEmployeeIdsForRun(ctx, run);
        const currentSnapshot = await captureDraftDependencySnapshot(ctx, {
          organizationId: dec.organizationId,
          cutoffStart: dec.cutoffStart,
          cutoffEnd: dec.cutoffEnd,
          employeeIds,
        });
        dec.isDraftOutdated = hasDraftDependenciesChanged(
          run.draftDependencySnapshot as DraftDependencySnapshot | undefined,
          currentSnapshot,
        );
      } else {
        dec.isDraftOutdated = false;
      }
      out.push(dec);
    }
    return out;
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
): Promise<
  Array<{
    employeeId: any;
    employee: any;
    totalBasicPay: number;
    thirteenthMonthAmount: number;
  }>
> {
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

  const results: Array<{
    employeeId: any;
    employee: any;
    totalBasicPay: number;
    thirteenthMonthAmount: number;
  }> = [];

  const { rates } = await getPayrollRates(ctx, args.organizationId);
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

  const thirteenthMonthScheduleLunchContext =
    await loadScheduleLunchContextForOrg(ctx, args.organizationId);

  const runsInYear = regularRuns.filter(
    (r: any) => r.cutoffStart >= yearStart && r.cutoffEnd <= yearEnd,
  );
  const payslipsInYear = (
    await Promise.all(
      runsInYear.map((run: any) =>
        (ctx.db.query("payslips") as any)
          .withIndex("by_payroll_run", (q: any) =>
            q.eq("payrollRunId", run._id),
          )
          .collect(),
      ),
    )
  ).flat() as any[];

  for (const employeeId of employeeIds) {
    const employee = employees.find((e: any) => e._id === employeeId);
    if (!employee) continue;

    let totalBasicPay = 0;

    const empPayslips = payslipsInYear.filter(
      (p: any) =>
        p.employeeId === employeeId && runIds.has(p.payrollRunId),
    );

    if (empPayslips.length > 0) {
      for (const p of empPayslips) {
        const pd = decryptPayslipRowFromDb(p)!;
        totalBasicPay += Math.max(0, getBasicPayFromPayslip(pd));
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
          scheduleLunchContext: thirteenthMonthScheduleLunchContext,
        });
        totalBasicPay += base.basicPay;
      }
    }

    const thirteenthMonthAmount = round2(totalBasicPay / 12);
    results.push({
      employeeId,
      employee: decryptEmployeeFromDb(employee),
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
      draftConfig: encryptDraftConfigForDb({ employeeIds: args.employeeIds }),
      createdAt: now,
      updatedAt: now,
    });

    for (const employeeId of args.employeeIds) {
      const amt = amountMap.get(employeeId) ?? 0;
      if (amt <= 0) continue;
      const employeeRow = await ctx.db.get(employeeId);
      const employee = employeeRow ? decryptEmployeeFromDb(employeeRow as any) : null;

      await ctx.db.insert(
        "payslips",
        encryptPayslipRowForDb({
          organizationId: args.organizationId,
          employeeId,
          employeeSnapshot: employee ? buildEmployeeSnapshot(employee) : undefined,
          payrollRunId,
          period,
          periodStart: yearStart,
          periodEnd: yearEnd,
          grossPay: amt,
          basicPay: amt,
          deductions: [],
          netPay: amt,
          daysWorked: 0,
          absences: 0,
          lateHours: 0,
          undertimeHours: 0,
          overtimeHours: 0,
          concernSummary: {
            messageCount: 0,
          },
          createdAt: now,
        }) as any,
      );
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
    employees
      .filter((e: any) => e.employment?.status === "active")
      .map((e: any) => e._id);

  const byYear = settings?.leaveTrackerByYear ?? [];
  const yearData = byYear.find((e: any) => e.year === args.year);
  const legacyRows = settings?.leaveTrackerRows ?? [];
  const currentYear = new Date().getFullYear();
  const rowsForYear =
    yearData?.rows ?? (args.year === currentYear ? legacyRows : []);

  const rowsMap = new Map(rowsForYear.map((r: any) => [r.employeeId, r]));

  const annualSil = settings?.annualSil ?? 8;
  const proratedLeave = settings?.proratedLeave !== false;
  const grantLeaveUponRegularization =
    settings?.grantLeaveUponRegularization !== false;
  const maxConvertibleLeaveDays = settings?.maxConvertibleLeaveDays ?? 5;
  const enableAnniversaryLeave = settings?.enableAnniversaryLeave !== false;

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

    const regularizationDate =
      employee?.employment?.regularizationDate ?? undefined;
    const hireDate = employee?.employment?.hireDate;
    const prorationStart = grantLeaveUponRegularization
      ? regularizationDate ?? hireDate
      : hireDate;
    const anniversaryStart = grantLeaveUponRegularization
      ? regularizationDate
      : hireDate;

    const formulaAnnualSil = proratedLeave
      ? getProratedAnnualSil(annualSil, prorationStart, referenceDate)
      : annualSil;
    const anniversaryLeave = enableAnniversaryLeave
      ? getCompletedYearsSince(anniversaryStart, referenceDate)
      : 0;

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
      employee: decryptEmployeeFromDb(employee),
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
      draftConfig: encryptDraftConfigForDb({ employeeIds: args.employeeIds }),
      createdAt: now,
      updatedAt: now,
    });

    for (const employeeId of args.employeeIds) {
      const amt = amountMap.get(employeeId) ?? 0;
      if (amt <= 0) continue;
      const employeeRow = await ctx.db.get(employeeId);
      const employee = employeeRow ? decryptEmployeeFromDb(employeeRow as any) : null;

      await ctx.db.insert(
        "payslips",
        encryptPayslipRowForDb({
          organizationId: args.organizationId,
          employeeId,
          employeeSnapshot: employee ? buildEmployeeSnapshot(employee) : undefined,
          payrollRunId,
          period,
          periodStart: yearStart,
          periodEnd: yearEnd,
          grossPay: amt,
          basicPay: amt,
          deductions: [],
          netPay: amt,
          daysWorked: 0,
          absences: 0,
          lateHours: 0,
          undertimeHours: 0,
          overtimeHours: 0,
          concernSummary: {
            messageCount: 0,
          },
          createdAt: now,
        }) as any,
      );
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
    const payrollRunRaw = await ctx.db.get(args.payrollRunId);
    if (!payrollRunRaw) throw new Error("Payroll run not found");
    const payrollRun = decryptPayrollRunFromDb(payrollRunRaw);

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);

    // Get all payslips for this payroll run to get employee IDs
    const payslipsRaw = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();
    const payslips = payslipsRaw.map((p: any) => decryptPayslipRowFromDb(p)!);

    const employeeIds = payslips.map((p: any) => p.employeeId);

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Per-employee date index + buffer (same as buildEmployeePayrollBase): avoids loading an entire org's history.
    const attQueryStart = payrollRun.cutoffStart - 5 * ONE_DAY_MS;
    const attQueryEnd = payrollRun.cutoffEnd + 2 * ONE_DAY_MS;
    const rangeEnd =
      payrollRun.cutoffEnd +
      ONE_DAY_MS -
      1; /* include full last day (e.g. 23:59:59.999) */
    const perEmployeeAttendance = await Promise.all(
      employeeIds.map((id: any) =>
        (ctx.db.query("attendance") as any)
          .withIndex("by_employee_date", (q: any) =>
            q
              .eq("employeeId", id)
              .gte("date", attQueryStart)
              .lte("date", attQueryEnd),
          )
          .collect(),
      ),
    );
    let periodAttendance = perEmployeeAttendance.flat();
    periodAttendance = periodAttendance.filter(
      (a: any) => a.date >= payrollRun.cutoffStart && a.date <= rangeEnd,
    );

    // Get all employees
    const employees = await Promise.all(
      employeeIds.map(async (id: any) => {
        const row = await ctx.db.get(id);
        return row ? decryptEmployeeFromDb(row) : null;
      }),
    );

    // Generate one date slot per calendar day (same logic as attendance page: start + i*24h)
    const numDays =
      Math.floor((payrollRun.cutoffEnd - payrollRun.cutoffStart) / ONE_DAY_MS) +
      1;
    const dates: number[] = [];
    for (let i = 0; i < numDays; i++) {
      dates.push(payrollRun.cutoffStart + i * ONE_DAY_MS);
    }

    // Org pay frequency + settings base (per-employee rates merged in loop)
    const organization = await ctx.db.get(payrollRun.organizationId);
    if (!organization) throw new Error("Organization not found");
    const payFrequency = getOrganizationPayFrequency(organization);
    const { base } = await getPayrollRates(ctx, payrollRun.organizationId);

    const holidaysForPayroll = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId),
      )
      .collect();

    const [orgShiftsForSummary, settingsRowSummary] = await Promise.all([
      (ctx.db.query("shifts") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", payrollRun.organizationId),
        )
        .collect(),
      (ctx.db.query("settings") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", payrollRun.organizationId),
        )
        .first(),
    ]);
    const attSetSummary = settingsRowSummary?.attendanceSettings;
    const scheduleLunchContextForSummary: ScheduleLunchContext = {
      orgShifts: orgShiftsForSummary,
      defaultLunchStart: attSetSummary?.defaultLunchStart ?? "12:00",
      defaultLunchEnd: attSetSummary?.defaultLunchEnd ?? "13:00",
    };

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
    const summary = await Promise.all(
      employees
        .filter((e: any) => e)
        .map(async (employee: any) => {
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

        // Build daily attendance data (match by 24h window so attendance aligns with summary dates)
        const dailyData = await Promise.all(
          dates.map(async (dateTimestamp) => {
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
              const scheduleInMin = att.scheduleIn
                ? timeToMinutes(att.scheduleIn)
                : null;
              const scheduleOutMin = timeToMinutes(att.scheduleOut);
              let actualOutMin = timeToMinutes(att.actualOut);
              if (
                scheduleInMin !== null &&
                scheduleInMin < scheduleOutMin &&
                actualOutMin < scheduleOutMin &&
                actualOutMin <= 12 * 60
              ) {
                actualOutMin += 24 * 60;
              }
              if (actualOutMin < scheduleOutMin) {
                undertimeMinutes = scheduleOutMin - actualOutMin;
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

          // Night diff: Manila segments, lunch excluded (same as payslip), schedule fallback
          if (att.status === "present") {
            const enriched = await enrichAttendanceRecordWithSchedule(
              ctx,
              employee,
              att,
              scheduleLunchContextForSummary,
            );
            nightDiffHours =
              calculateNightDiffWorkHoursForAttendance(enriched);
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
              att.status === "absent" || att.status === "leave_without_pay",
            note: att.remarks || null,
          };
          }),
        );

        const employeeRates = getEmployeePayrollRates(employee, base);
        const payrollBase = await buildEmployeePayrollBase(ctx, {
          employee,
          cutoffStart: payrollRun.cutoffStart,
          cutoffEnd: payrollRun.cutoffEnd,
          payFrequency,
          payrollRates: employeeRates,
          holidays: holidaysForPayroll,
          leaveTypes,
          scheduleLunchContext: scheduleLunchContextForSummary,
        });

        return {
          employee,
          /** Daily rate used by payroll for this period (monthly → prorated daily, daily/hourly → contract rate). */
          dailyPayRate: payrollBase.dailyRate,
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
      }),
    );

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

/** Resolve Plinth login email for payroll emails: linked employeeId on userOrganizations, else same work email + org membership. */
async function findPlinthAccountEmailForEmployee(
  ctx: any,
  organizationId: any,
  employeeId: any,
  workEmail: string,
): Promise<string | null> {
  const userOrgs = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .collect();

  for (const uo of userOrgs) {
    if (uo.employeeId !== employeeId) continue;
    const user = await ctx.db.get(uo.userId);
    if (!user) continue;
    if ((user as any).isActive === false) continue;
    const em = String((user as any).email || "").trim();
    if (em) return em;
  }

  const tryEmails = new Set<string>();
  const raw = (workEmail || "").trim();
  if (raw) {
    tryEmails.add(raw);
    tryEmails.add(raw.toLowerCase());
  }
  for (const em of tryEmails) {
    if (!em) continue;
    const user = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", em))
      .first();
    if (!user || (user as any).isActive === false) continue;
    const uo = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", user._id).eq("organizationId", organizationId),
      )
      .first();
    if (!uo) continue;
    if (uo.employeeId != null && uo.employeeId !== employeeId) continue;
    const loginEmail = String((user as any).email || "").trim();
    if (loginEmail) return loginEmail;
  }
  return null;
}

/** Who will receive emailed payslip PDFs when this run is finalized (Plinth accounts only). */
export const getPayrollFinalizePayslipRecipients = query({
  args: {
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const payrollRunRaw = await ctx.db.get(args.payrollRunId);
    if (!payrollRunRaw) throw new Error("Payroll run not found");
    const payrollRun = decryptPayrollRunFromDb(payrollRunRaw);

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["owner", "admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized");
    }

    const org = await ctx.db.get(payrollRun.organizationId);
    const organizationName = (org as any)?.name ?? "Organization";

    const payslipsRaw = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    const withAccount: Array<{
      payslipId: any;
      employeeId: any;
      name: string;
      email: string;
      workEmail: string;
    }> = [];
    const withoutAccount: Array<{
      employeeId: any;
      name: string;
      workEmail: string;
    }> = [];

    for (const raw of payslipsRaw) {
      const payslip = decryptPayslipRowFromDb(raw)!;
      let employee = getPayslipEmployeeFromSnapshot(payslip);
      if (!employee) {
        const employeeRow = await ctx.db.get(payslip.employeeId);
        if (!employeeRow) continue;
        const decrypted = decryptEmployeeFromDb(employeeRow as any);
        employee = {
          _id: decrypted._id,
          organizationId: decrypted.organizationId,
          personalInfo: decrypted.personalInfo,
          employment: decrypted.employment,
          compensation: decrypted.compensation,
          payslipPdfPassword: (decrypted as any).payslipPdfPassword,
        };
      }
      const workEmail = String(employee.personalInfo?.email || "").trim();
      const name =
        `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim();

      const accountEmail = await findPlinthAccountEmailForEmployee(
        ctx,
        payrollRun.organizationId,
        payslip.employeeId,
        workEmail,
      );

      if (accountEmail) {
        withAccount.push({
          payslipId: payslip._id,
          employeeId: payslip.employeeId,
          name,
          email: accountEmail,
          workEmail,
        });
      } else {
        withoutAccount.push({
          employeeId: payslip.employeeId,
          name,
          workEmail,
        });
      }
    }

    return {
      runStatus: payrollRun.status,
      organizationId: payrollRun.organizationId,
      organizationName,
      cutoffStart: payrollRun.cutoffStart,
      cutoffEnd: payrollRun.cutoffEnd,
      withAccount,
      withoutAccount,
    };
  },
});

export const getPayslipListByPayrollRun = query({
  args: {
    payrollRunId: v.id("payrollRuns"),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    await checkAuth(ctx, payrollRun.organizationId);

    const payslipsRaw = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    return Promise.all(
      payslipsRaw.map(async (raw: any) => {
        const payslip = decryptPayslipRowFromDb(raw)!;
        let employee = getPayslipEmployeeFromSnapshot(payslip);

        if (!employee) {
          const employeeRow = (await ctx.db.get(payslip.employeeId)) as any;
          if (employeeRow) {
            const decrypted = decryptEmployeeFromDb(employeeRow);
            employee = {
              _id: decrypted._id,
              organizationId: decrypted.organizationId,
              personalInfo: decrypted.personalInfo,
              employment: decrypted.employment,
              compensation: decrypted.compensation,
              payslipPdfPassword: (decrypted as any).payslipPdfPassword,
            };
          }
        }

        const concernSummary = await computeConcernSummaryForPayslip(
          ctx,
          payslip._id,
          payslip.concernSummary,
        );

        return {
          _id: payslip._id,
          organizationId: payslip.organizationId,
          employeeId: payslip.employeeId,
          payrollRunId: payslip.payrollRunId,
          period: payslip.period,
          periodStart: payslip.periodStart,
          periodEnd: payslip.periodEnd,
          grossPay: payslip.grossPay ?? 0,
          basicPay: payslip.basicPay ?? 0,
          nonTaxableAllowance: payslip.nonTaxableAllowance ?? 0,
          netPay: payslip.netPay ?? 0,
          createdAt: payslip.createdAt,
          employee,
          concernSummary,
        };
      }),
    );
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

    await checkAuth(ctx, payrollRun.organizationId);

    const payslipsRaw = await (ctx.db.query("payslips") as any)
      .withIndex("by_payroll_run", (q: any) =>
        q.eq("payrollRunId", args.payrollRunId),
      )
      .collect();

    return Promise.all(
      payslipsRaw.map(async (raw: any) => {
        const payslip = decryptPayslipRowFromDb(raw)!;
        let employee = getPayslipEmployeeFromSnapshot(payslip);
        if (!employee) {
          const employeeRow = (await ctx.db.get(payslip.employeeId)) as any;
          if (employeeRow) {
            const decrypted = decryptEmployeeFromDb(employeeRow);
            employee = {
              _id: decrypted._id,
              organizationId: decrypted.organizationId,
              personalInfo: decrypted.personalInfo,
              employment: decrypted.employment,
              compensation: decrypted.compensation,
              payslipPdfPassword: (decrypted as any).payslipPdfPassword,
            };
          }
        }

        return {
          ...payslip,
          employee,
          concernSummary: await computeConcernSummaryForPayslip(
            ctx,
            payslip._id,
            payslip.concernSummary,
          ),
        };
      }),
    );
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

    const payslipsRaw = await (ctx.db.query("payslips") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    const payslipsDecrypted = payslipsRaw
      .map((p: any) => decryptPayslipRowFromDb(p)!)
      .filter(Boolean);

    // Only show payslips from runs that are already finalized (or subsequently paid).
    const runIds = Array.from(
      new Set(
        payslipsDecrypted
          .map((p: any) => p.payrollRunId)
          .filter(Boolean),
      ),
    );
    const runStatusById = new Map<string, string>();
    await Promise.all(
      runIds.map(async (runId: any) => {
        const run = await ctx.db.get(runId);
        if (run) runStatusById.set(String(runId), (run as any).status || "");
      }),
    );

    const payslips = payslipsDecrypted.filter((p: any) => {
      const status = runStatusById.get(String(p.payrollRunId));
      return status === "finalized" || status === "paid";
    });
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
    const raw = await ctx.db.get(args.payslipId);
    if (!raw) throw new Error("Payslip not found");
    const payslip = decryptPayslipRowFromDb(raw)!;

    const userRecord = await checkAuth(ctx, payslip.organizationId);

    // Check authorization
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== payslip.employeeId
    ) {
      throw new Error("Not authorized");
    }

    let employee = getPayslipEmployeeFromSnapshot(payslip);
    if (!employee) {
      const employeeRow = (await ctx.db.get(payslip.employeeId)) as any;
      if (employeeRow) {
        const decrypted = decryptEmployeeFromDb(employeeRow);
        employee = {
          _id: decrypted._id,
          organizationId: decrypted.organizationId,
          personalInfo: decrypted.personalInfo,
          employment: decrypted.employment,
          compensation: decrypted.compensation,
          payslipPdfPassword: (decrypted as any).payslipPdfPassword,
        };
      }
    }

    return {
      ...payslip,
      employee,
      concernSummary: await computeConcernSummaryForPayslip(
        ctx,
        payslip._id,
        payslip.concernSummary,
      ),
    };
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
          taxable: v.optional(v.boolean()),
        }),
      ),
    ),
    nonTaxableAllowance: v.optional(v.number()),
    variableEarnings: v.optional(
      v.object({
        holidayPay: v.number(),
        nightDiffPay: v.number(),
        restDayPay: v.number(),
        overtimeRegular: v.number(),
        overtimeRestDay: v.number(),
        overtimeRestDayExcess: v.number(),
        overtimeSpecialHoliday: v.number(),
        overtimeSpecialHolidayExcess: v.number(),
        overtimeLegalHoliday: v.number(),
        overtimeLegalHolidayExcess: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    type PayslipLine = {
      name: string;
      amount: number;
      type: string;
      taxable?: boolean;
    };
    type EditChange = {
      field: string;
      oldValue?: unknown;
      newValue?: unknown;
      details?: string[];
    };
    const normalizeLine = (line: PayslipLine): PayslipLine => ({
      name: (line.name || "").trim(),
      amount: round2(Number(line.amount || 0)),
      type: (line.type || "custom").trim(),
    });
    const normalizeIncentiveLine = (line: PayslipLine): PayslipLine => ({
      ...normalizeLine(line),
      taxable: line.taxable === false ? false : true,
    });
    const normalizeLines = (lines: PayslipLine[] | undefined): PayslipLine[] =>
      (lines ?? []).map(normalizeLine);
    const normalizeIncentiveLines = (lines: PayslipLine[] | undefined): PayslipLine[] =>
      (lines ?? []).map(normalizeIncentiveLine);
    const lineIdentity = (line: PayslipLine): string =>
      `${line.name.toLowerCase()}|${line.type.toLowerCase()}|${line.taxable === false ? "nt" : "tx"}`;
    const lineExactKey = (line: PayslipLine): string =>
      `${lineIdentity(line)}|${line.amount.toFixed(2)}`;
    const sortedLines = (lines: PayslipLine[]): PayslipLine[] =>
      [...lines].sort((a, b) => {
        const aKey = lineExactKey(a);
        const bKey = lineExactKey(b);
        return aKey.localeCompare(bKey);
      });
    const areSameLines = (left: PayslipLine[], right: PayslipLine[]): boolean => {
      if (left.length !== right.length) return false;
      const l = sortedLines(left);
      const r = sortedLines(right);
      return l.every((line, idx) => lineExactKey(line) === lineExactKey(r[idx]));
    };
    const subtractLineMultiset = (
      source: PayslipLine[],
      minus: PayslipLine[],
    ): PayslipLine[] => {
      const counts = new Map<string, number>();
      for (const row of minus) {
        const key = lineExactKey(row);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const remainder: PayslipLine[] = [];
      for (const row of source) {
        const key = lineExactKey(row);
        const current = counts.get(key) ?? 0;
        if (current > 0) {
          counts.set(key, current - 1);
          continue;
        }
        remainder.push(row);
      }
      return remainder;
    };
    const buildLineDiffChange = (
      field: "deductions" | "incentives",
      oldRaw: PayslipLine[] | undefined,
      nextRaw: PayslipLine[] | undefined,
    ): EditChange | null => {
      const norm =
        field === "incentives" ? normalizeIncentiveLines : normalizeLines;
      const oldLines = norm(oldRaw);
      const newLines = norm(nextRaw);
      if (areSameLines(oldLines, newLines)) return null;

      const details: string[] = [];
      const oldByIdentity = new Map<string, PayslipLine[]>();
      const newByIdentity = new Map<string, PayslipLine[]>();
      for (const line of oldLines) {
        const key = lineIdentity(line);
        oldByIdentity.set(key, [...(oldByIdentity.get(key) ?? []), line]);
      }
      for (const line of newLines) {
        const key = lineIdentity(line);
        newByIdentity.set(key, [...(newByIdentity.get(key) ?? []), line]);
      }

      const identityKeys = new Set<string>([
        ...oldByIdentity.keys(),
        ...newByIdentity.keys(),
      ]);
      for (const key of identityKeys) {
        const previous = oldByIdentity.get(key) ?? [];
        const current = newByIdentity.get(key) ?? [];
        if (
          previous.length === 1 &&
          current.length === 1 &&
          previous[0].amount !== current[0].amount
        ) {
          details.push(
            `Changed ${previous[0].name} (${previous[0].type}): ${previous[0].amount.toFixed(2)} -> ${current[0].amount.toFixed(2)}`,
          );
        }
      }

      const added = subtractLineMultiset(newLines, oldLines);
      const removed = subtractLineMultiset(oldLines, newLines);

      for (const row of added) {
        details.push(
          `Added ${row.name} (${row.type}): ${row.amount.toFixed(2)}`,
        );
      }
      for (const row of removed) {
        details.push(
          `Removed ${row.name} (${row.type}): ${row.amount.toFixed(2)}`,
        );
      }

      return {
        field,
        oldValue: sortedLines(oldLines),
        newValue: sortedLines(newLines),
        details,
      };
    };

    const rawPayslip = await ctx.db.get(args.payslipId);
    if (!rawPayslip) throw new Error("Payslip not found");
    const payslip = decryptPayslipRowFromDb(rawPayslip)!;

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
    const newDeductions = normalizeLines(args.deductions || payslip.deductions);
    const newIncentives = normalizeIncentiveLines(
      args.incentives || payslip.incentives || [],
    );
    const newNonTaxableAllowance =
      args.nonTaxableAllowance !== undefined
        ? round2(args.nonTaxableAllowance)
        : round2(payslip.nonTaxableAllowance || 0);

    const originalIncentives = payslip.incentives || [];
    const t0 = sumTaxableIncentiveAmounts(originalIncentives);
    const t1 = sumTaxableIncentiveAmounts(newIncentives);

    let recalculatedGross: number;
    let recalculatedNet: number;
    const variableEarningsPatch: Record<string, unknown> = {};
    if (args.variableEarnings) {
      const atOpen = getVariableEarningsFromPayslip(
        payslip as unknown as Record<string, unknown>,
      );
      const ve = args.variableEarnings;
      const nextE: VariableEarnings = {
        holidayPay: round2(ve.holidayPay),
        nightDiffPay: round2(ve.nightDiffPay),
        restDayPay: round2(ve.restDayPay),
        overtimeRegular: round2(ve.overtimeRegular),
        overtimeRestDay: round2(ve.overtimeRestDay),
        overtimeRestDayExcess: round2(ve.overtimeRestDayExcess),
        overtimeSpecialHoliday: round2(ve.overtimeSpecialHoliday),
        overtimeSpecialHolidayExcess: round2(ve.overtimeSpecialHolidayExcess),
        overtimeLegalHoliday: round2(ve.overtimeLegalHoliday),
        overtimeLegalHolidayExcess: round2(ve.overtimeLegalHolidayExcess),
      };
      const gbb = recomputeGrossAndBasicFromVariableEarnings(
        {
          grossPay: Number(payslip.grossPay ?? 0),
          basicPay: Number(payslip.basicPay ?? 0),
        },
        atOpen,
        nextE,
        t0,
        t1,
      );
      const netB = recomputeNetFromEarningsAndLines(
        gbb.grossPay,
        newNonTaxableAllowance,
        newIncentives,
        newDeductions,
      );
      recalculatedGross = gbb.grossPay;
      recalculatedNet = netB.netPay;
      Object.assign(variableEarningsPatch, {
        basicPay: round2(gbb.basicPay),
        holidayPay: round2(nextE.holidayPay),
        nightDiffPay: round2(nextE.nightDiffPay),
        restDayPay: round2(nextE.restDayPay),
        overtimeRegular: round2(nextE.overtimeRegular),
        overtimeRestDay: round2(nextE.overtimeRestDay),
        overtimeRestDayExcess: round2(nextE.overtimeRestDayExcess),
        overtimeSpecialHoliday: round2(nextE.overtimeSpecialHoliday),
        overtimeSpecialHolidayExcess: round2(
          nextE.overtimeSpecialHolidayExcess,
        ),
        overtimeLegalHoliday: round2(nextE.overtimeLegalHoliday),
        overtimeLegalHolidayExcess: round2(
          nextE.overtimeLegalHolidayExcess,
        ),
      } as Record<string, unknown>);
    } else {
      const recalculatedTotals = recalculatePersistedPayslipTotals({
        grossPay: payslip.grossPay ?? 0,
        previousIncentives: originalIncentives,
        nextIncentives: newIncentives,
        nextDeductions: newDeductions,
        nextNonTaxableAllowance: newNonTaxableAllowance,
      });
      recalculatedGross = recalculatedTotals.grossPay;
      recalculatedNet = recalculatedTotals.netPay;
    }

    const editedEmployeeSSSAmount = getDeductionAmountByNames(newDeductions, [
      "sss",
    ]);
    const editedEmployeePhilhealthAmount = getDeductionAmountByNames(
      newDeductions,
      ["philhealth"],
    );
    const editedEmployeePagibigAmount = getDeductionAmountByNames(
      newDeductions,
      ["pag-ibig", "pagibig"],
    );
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
      updatedEmployerContributions.pagibig = round2(
        editedEmployeePagibigAmount,
      );
    }

    // Track changes for edit history (lightweight summaries — line-by-line diffs were O(n²) and slow)
    const changes: EditChange[] = [];
    const deductionChange = buildLineDiffChange(
      "deductions",
      payslip.deductions,
      newDeductions,
    );
    if (deductionChange) changes.push(deductionChange);
    const incentiveChange = buildLineDiffChange(
      "incentives",
      payslip.incentives || [],
      newIncentives,
    );
    if (incentiveChange) changes.push(incentiveChange);

    // Compare non-taxable allowance
    const previousNonTaxableAllowance = round2(payslip.nonTaxableAllowance || 0);
    if (previousNonTaxableAllowance !== newNonTaxableAllowance) {
      changes.push({
        field: "nonTaxableAllowance",
        oldValue: previousNonTaxableAllowance,
        newValue: newNonTaxableAllowance,
        details: [
          `Changed non-taxable allowance: ${previousNonTaxableAllowance.toFixed(2)} -> ${newNonTaxableAllowance.toFixed(2)}`,
        ],
      });
    }

    if (args.variableEarnings) {
      const atOpen = getVariableEarningsFromPayslip(
        payslip as unknown as Record<string, unknown>,
      );
      const ve = args.variableEarnings;
      const nextE: VariableEarnings = {
        holidayPay: round2(ve.holidayPay),
        nightDiffPay: round2(ve.nightDiffPay),
        restDayPay: round2(ve.restDayPay),
        overtimeRegular: round2(ve.overtimeRegular),
        overtimeRestDay: round2(ve.overtimeRestDay),
        overtimeRestDayExcess: round2(ve.overtimeRestDayExcess),
        overtimeSpecialHoliday: round2(ve.overtimeSpecialHoliday),
        overtimeSpecialHolidayExcess: round2(ve.overtimeSpecialHolidayExcess),
        overtimeLegalHoliday: round2(ve.overtimeLegalHoliday),
        overtimeLegalHolidayExcess: round2(ve.overtimeLegalHolidayExcess),
      };
      const atOpenKey = JSON.stringify(atOpen);
      const nextKey = JSON.stringify(nextE);
      if (atOpenKey !== nextKey) {
        changes.push({
          field: "variableEarnings",
          oldValue: atOpen,
          newValue: nextE,
          details: ["Updated holiday, night diff, rest day, or overtime line amounts."],
        });
      }
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

    await ctx.db.patch(
      args.payslipId,
      encryptPayslipPartialForDb({
        deductions: newDeductions.map((d: { name: string; amount: number; type: string }) => ({
          ...d,
          amount: round2(d.amount),
        })),
        incentives:
          newIncentives.length > 0
            ? newIncentives.map(
                (i: { name: string; amount: number; type: string; taxable?: boolean }) => ({
                  name: i.name,
                  type: i.type,
                  amount: round2(i.amount),
                  taxable: i.taxable === false ? false : true,
                }),
              )
            : undefined,
        nonTaxableAllowance:
          newNonTaxableAllowance > 0
            ? round2(newNonTaxableAllowance)
            : undefined,
        grossPay: recalculatedGross,
        netPay: recalculatedNet,
        ...(Object.keys(variableEarningsPatch).length > 0
          ? variableEarningsPatch
          : {}),
        employerContributions:
          Object.keys(updatedEmployerContributions).length > 0
            ? updatedEmployerContributions
            : undefined,
        editHistory:
          updatedEditHistory.length > 0 ? updatedEditHistory : undefined,
      }) as any,
    );

    // Re-sync accounting cost items when deductions/incentives/allowance change
    // so that Payroll, SSS, PhilHealth, Pag-IBIG, Tax expense items reflect updated totals
    const payrollRun = payslip.payrollRunId
      ? ((await ctx.db.get(payslip.payrollRunId)) as any)
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

        let content = msg.content;
        if (
          typeof content === "string" &&
          isEncryptedPayload(content) &&
          getChatMasterSecret() &&
          msg.conversationId
        ) {
          const conv = await ctx.db.get(msg.conversationId);
          if (conv && (conv as any).chatSessionKeyEnc) {
            try {
              const sk = unwrapSessionKey(
                (conv as any).chatSessionKeyEnc,
                (conv as any).organizationId,
                conv._id,
              );
              content = decryptUtf8(content, sk);
            } catch {
              content = "[Encrypted message]";
            }
          }
        }

        return {
          ...msg,
          content,
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

/**
 * One-shot backfill for the `periodStart`/`periodEnd` fields on existing payslip rows
 * so they can be range-queried via the `by_employee_periodStart` index.
 *
 * Strategy: prefer the exact cutoff from the parent `payrollRuns` row. Fall back to
 * parsing the legacy locale-formatted `period` string only if the run is missing
 * (shouldn't happen, but kept as a safety net).
 *
 * Only payroll owners/admins can invoke this; it's idempotent so re-runs are safe.
 */
export const backfillPayslipPeriodRange = mutation({
  args: {
    organizationId: v.id("organizations"),
    /** Optional cap so a single invocation stays within Convex's mutation budget. */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    if (userRecord.role !== "owner" && userRecord.role !== "admin") {
      throw new Error("Only owner or admin can backfill payslip period range");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 500, 2000));
    const payslips = await (ctx.db.query("payslips") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const runCache = new Map<string, { cutoffStart: number; cutoffEnd: number } | null>();
    let updated = 0;
    let skippedAlreadySet = 0;
    let skippedNoCutoff = 0;

    for (const row of payslips) {
      if (updated >= limit) break;
      if (
        typeof row.periodStart === "number" &&
        typeof row.periodEnd === "number"
      ) {
        skippedAlreadySet += 1;
        continue;
      }

      const runKey = String(row.payrollRunId);
      let runCutoff = runCache.get(runKey);
      if (runCutoff === undefined) {
        const runRow = (await ctx.db.get(row.payrollRunId)) as
          | { cutoffStart?: number; cutoffEnd?: number }
          | null;
        runCutoff =
          runRow &&
          typeof runRow.cutoffStart === "number" &&
          typeof runRow.cutoffEnd === "number"
            ? { cutoffStart: runRow.cutoffStart, cutoffEnd: runRow.cutoffEnd }
            : null;
        runCache.set(runKey, runCutoff);
      }

      let periodStart: number | null = runCutoff?.cutoffStart ?? null;
      let periodEnd: number | null = runCutoff?.cutoffEnd ?? null;
      if (periodStart == null || periodEnd == null) {
        const legacyStart = parseLegacyPayslipPeriodStart(row.period);
        if (legacyStart != null) {
          periodStart = legacyStart;
          // Legacy rows had no explicit end; use start of day + 1 day as a conservative end
          // (only used for indexing, not for display).
          periodEnd = legacyStart + 24 * 60 * 60 * 1000 - 1;
        }
      }
      if (periodStart == null || periodEnd == null) {
        skippedNoCutoff += 1;
        continue;
      }

      await ctx.db.patch(row._id, {
        periodStart,
        periodEnd,
      });
      updated += 1;
    }

    return {
      total: payslips.length,
      updated,
      skippedAlreadySet,
      skippedNoCutoff,
      hasMore: updated >= limit,
    };
  },
});
