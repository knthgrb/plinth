import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { getSSSContribution } from "./sss";

/** Round to 2 decimal places for currency */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Helper to check authorization with organization context
// Allows admin, hr, and accounting roles for payroll access
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr" | "accounting"
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
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
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

// Helper to check if a date is a rest day for an employee
function isRestDay(date: number, employeeSchedule: any): boolean {
  const dayName = getDayName(date);
  const daySchedule =
    employeeSchedule.defaultSchedule[
      dayName as keyof typeof employeeSchedule.defaultSchedule
    ];

  // Check if there's a schedule override for this date
  if (employeeSchedule.scheduleOverrides) {
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) =>
        new Date(o.date).toDateString() === new Date(date).toDateString()
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
  employeeSchedule: any
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
  employeeSchedule: any
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
  options?: DailyRateOptions
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

// Government contributions (monthly). Per cutoff = monthly / 2 for semi-monthly.
const PHILHEALTH_EMPLOYEE_MONTHLY = 500;
const PHILHEALTH_EMPLOYER_MONTHLY = 500;
const PAGIBIG_EMPLOYEE_MONTHLY = 200;
const PAGIBIG_EMPLOYER_MONTHLY = 200;
/** Withholding tax: 12% of basic salary when monthly basic >= threshold. */
const TAX_RATE = 0.12;
const WITHHOLDING_TAX_THRESHOLD = 23000; // No tax when monthly basic below this

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
};

/** Load payroll rates from organization settings (with defaults). */
async function getPayrollRates(
  ctx: any,
  organizationId: any
): Promise<PayrollRates> {
  const settings = await (ctx.db.query("settings") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId)
    )
    .first();
  const ps = settings?.payrollSettings;
  return {
    regularOt: ps?.overtimeRegularRate ?? DEFAULT_REGULAR_OT,
    specialHolidayOt: ps?.specialHolidayOtRate ?? DEFAULT_SPECIAL_HOLIDAY_OT,
    regularHolidayOt: ps?.regularHolidayOtRate ?? DEFAULT_REGULAR_HOLIDAY_OT,
    restDayOt: ps?.overtimeRestDayRate ?? DEFAULT_REST_DAY_OT,
    nightDiffRate: ps?.nightDiffPercent ?? DEFAULT_NIGHT_DIFF_RATE,
    dailyRateIncludesAllowance: ps?.dailyRateIncludesAllowance ?? false,
    dailyRateWorkingDaysPerYear:
      ps?.dailyRateWorkingDaysPerYear ?? DEFAULT_DAILY_RATE_WORKING_DAYS_PER_YEAR,
  };
}

/**
 * Get hours worked after 10 PM from actualOut time string "HH:mm".
 * Used for night differential (10% per hour). Treats 00:00-05:59 as same night (next day).
 */
function getNightDiffHoursFromActualOut(actualOut: string | undefined): number {
  if (!actualOut || typeof actualOut !== "string") return 0;
  const parts = actualOut.trim().split(":");
  const hour = parseInt(parts[0], 10);
  const min = (parts.length > 1 ? parseInt(parts[1], 10) : 0) / 60;
  if (isNaN(hour)) return 0;
  const totalHours = hour + min;
  // 10 PM = 22. From 22:00 to 24:00 = 2 hours. From 00:00 to 06:00 = 6 hours (same work night).
  if (totalHours >= 22) return totalHours - 22; // e.g. 23.5 - 22 = 1.5
  if (totalHours < 6) return 2 + totalHours; // 00-06 next day: 2 (22-24) + 0-6
  return 0;
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

    const userRecord = await checkAuth(ctx, employee.organizationId);

    // Get attendance for the period
    const attendance = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    const periodAttendance = attendance.filter(
      (a: any) => a.date >= args.cutoffStart && a.date <= args.cutoffEnd
    );

    // Use employee-specific rates if set, otherwise use defaults
    const regularHolidayRate = employee.compensation.regularHolidayRate ?? 1.0; // Default 100%
    const specialHolidayRate = employee.compensation.specialHolidayRate ?? 0.3; // Default 30%

    // Get holidays for the period
    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId)
      )
      .collect();

    const periodHolidays = holidays.filter(
      (h: any) => h.date >= args.cutoffStart && h.date <= args.cutoffEnd
    );

    const rates = await getPayrollRates(ctx, employee.organizationId);

    // Calculate basic pay
    let basicPay = 0;
    let daysWorked = 0;
    let absences = 0;
    let lateHours = 0;
    let undertimeHours = 0;
    let overtimeHours = 0;
    let holidayPay = 0;
    let restDayPay = 0;
    let nightDiffPay = 0;
    let overtimeRegular = 0;
    let overtimeRestDay = 0;
    let overtimeRestDayExcess = 0;
    let overtimeSpecialHoliday = 0;
    let overtimeSpecialHolidayExcess = 0;
    let overtimeLegalHoliday = 0;
    let overtimeLegalHolidayExcess = 0;
    let lateDeduction = 0;
    let undertimeDeduction = 0;
    let absentDeduction = 0;

    // Derive daily rate from salary type (monthly: (basic + allowance?) × 12/workingDaysPerYear)
    const dailyRate = getDailyRateForEmployee(
      employee,
      args.cutoffStart,
      args.cutoffEnd,
      {
        includeAllowance: rates.dailyRateIncludesAllowance,
        workingDaysPerYear: rates.dailyRateWorkingDaysPerYear,
      }
    );
    const hourlyRate = dailyRate / 8;

    // For monthly employees, start with semi-monthly base pay (monthly / 2)
    // For daily/hourly employees, start at 0 and accumulate based on days worked
    const salaryType = employee.compensation.salaryType || "monthly";
    if (salaryType === "monthly") {
      const monthlySalary = employee.compensation.basicSalary || 0;
      basicPay = monthlySalary / 2; // Semi-monthly base pay
    }

    // Get approved leave requests for the period to check for paid leave
    const leaveRequests = await (ctx.db.query("leaveRequests") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    const approvedLeaves = leaveRequests.filter(
      (lr: any) =>
        lr.status === "approved" &&
        lr.startDate <= args.cutoffEnd &&
        lr.endDate >= args.cutoffStart
    );

    // Get leave types to check if leave is paid
    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", employee.organizationId)
      )
      .collect();

    // Helper to check if a date falls within a paid leave
    const isPaidLeave = (date: number): boolean => {
      const dateObj = new Date(date);
      for (const leave of approvedLeaves) {
        const leaveStart = new Date(leave.startDate);
        const leaveEnd = new Date(leave.endDate);
        if (dateObj >= leaveStart && dateObj <= leaveEnd) {
          // Check if this leave type is paid
          if (leave.leaveType === "custom" && leave.customLeaveType) {
            const leaveType = leaveTypes.find(
              (lt: any) => lt.name === leave.customLeaveType
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

    // Helper to automatically detect if a date is a holiday
    const getHolidayInfo = (
      date: number,
      attendanceRecord?: any
    ): { isHoliday: boolean; holidayType?: "regular" | "special" } => {
      // First check if attendance record has holiday info
      if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
        return { isHoliday: true, holidayType: attendanceRecord.holidayType };
      }

      // Otherwise, check against organization holidays
      const dateObj = new Date(date);
      const holiday = periodHolidays.find((h: any) => {
        const holidayDate = new Date(h.date);
        return (
          holidayDate.getFullYear() === dateObj.getFullYear() &&
          holidayDate.getMonth() === dateObj.getMonth() &&
          holidayDate.getDate() === dateObj.getDate()
        );
      });

      if (holiday) {
        return { isHoliday: true, holidayType: holiday.type };
      }

      return { isHoliday: false };
    };

    // Process attendance records for days that have explicit records
    for (const att of periodAttendance) {
      if (att.status === "present" || att.status === "half-day") {
        const isRestDayForEmployee = isRestDay(att.date, employee.schedule);
        const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
        daysWorked += dayMultiplier;

        // Automatically detect holiday
        const holidayInfo = getHolidayInfo(att.date, att);
        const isHolidayDay = holidayInfo.isHoliday;
        const holidayType = holidayInfo.holidayType;

        // For daily/hourly employees, add daily rate per day worked
        // For monthly employees, we already have the base pay, so we don't add here
        if (salaryType !== "monthly") {
          basicPay += dayMultiplier * dailyRate;
        }

        // Rest day premium: 30% of daily rate for working on rest day
        if (isRestDayForEmployee) {
          restDayPay += dayMultiplier * dailyRate * 0.3;
        }

        // Calculate overtime with proper rates based on day type
        // Overtime hours get additional premium on top of the base day rate
        // Uses employee-specific holiday rates
        // Track different overtime types separately
        // "Excess of 8 hrs" means overtime beyond 8 hours total worked in a day
        if (att.overtime && att.overtime > 0) {
          overtimeHours += att.overtime;
          
          // Calculate if total hours worked exceed 8 (assuming 8 regular hours + overtime)
          // For "excess of 8 hrs", we track overtime beyond the first 8 hours of work
          // If overtime <= 8, it's regular OT; if > 8, the excess is tracked separately
          const regularOTHours = Math.min(att.overtime, 8);
          const excessOTHours = Math.max(0, att.overtime - 8);

          // Check combinations: Rest Day + Holiday takes precedence. Rates from labor rules.
          if (isRestDayForEmployee && isHolidayDay) {
            if (holidayType === "regular") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.regularHolidayOt;
              overtimeLegalHoliday += regularOTAmount;
              if (excessOTHours > 0) {
                overtimeLegalHolidayExcess += excessOTHours * hourlyRate * rates.regularHolidayOt;
              }
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.regularHolidayOt : 0);
            } else if (holidayType === "special") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.specialHolidayOt;
              overtimeSpecialHoliday += regularOTAmount;
              if (excessOTHours > 0) {
                overtimeSpecialHolidayExcess += excessOTHours * hourlyRate * rates.specialHolidayOt;
              }
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.specialHolidayOt : 0);
            }
          } else if (isHolidayDay) {
            if (holidayType === "regular") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.regularHolidayOt;
              overtimeLegalHoliday += regularOTAmount;
              if (excessOTHours > 0) {
                overtimeLegalHolidayExcess += excessOTHours * hourlyRate * rates.regularHolidayOt;
              }
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.regularHolidayOt : 0);
            } else if (holidayType === "special") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.specialHolidayOt;
              overtimeSpecialHoliday += regularOTAmount;
              if (excessOTHours > 0) {
                overtimeSpecialHolidayExcess += excessOTHours * hourlyRate * rates.specialHolidayOt;
              }
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.specialHolidayOt : 0);
            }
          } else if (isRestDayForEmployee) {
            const regularOTAmount = regularOTHours * hourlyRate * rates.restDayOt;
            overtimeRestDay += regularOTAmount;
            if (excessOTHours > 0) {
              overtimeRestDayExcess += excessOTHours * hourlyRate * rates.restDayOt;
            }
            basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.restDayOt : 0);
          } else {
            const regularOTAmount = att.overtime * hourlyRate * rates.regularOt;
            overtimeRegular += regularOTAmount;
            basicPay += regularOTAmount;
          }
        }

        // Night diff: 10% per hour for work from 10 PM onwards (from actualOut)
        const dayNightDiffHours = getNightDiffHoursFromActualOut(att.actualOut);
        if (dayNightDiffHours > 0) {
          nightDiffPay += dayNightDiffHours * hourlyRate * rates.nightDiffRate;
        }

        // Calculate late/undertime - track as deductions, don't subtract from basicPay
        if (att.actualIn && att.scheduleIn) {
          const [scheduleHour, scheduleMin] = att.scheduleIn
            .split(":")
            .map(Number);
          const [actualHour, actualMin] = att.actualIn.split(":").map(Number);
          const scheduleTime = scheduleHour * 60 + scheduleMin;
          const actualTime = actualHour * 60 + actualMin;
          if (actualTime > scheduleTime) {
            const lateMinutes = actualTime - scheduleTime;
            const lateHoursForDay = lateMinutes / 60;
            lateHours += lateHoursForDay;
            lateDeduction += lateHoursForDay * hourlyRate;
          }
        }

        if (att.actualOut && att.scheduleOut) {
          const [scheduleHour, scheduleMin] = att.scheduleOut
            .split(":")
            .map(Number);
          const [actualHour, actualMin] = att.actualOut.split(":").map(Number);
          const scheduleTime = scheduleHour * 60 + scheduleMin;
          const actualTime = actualHour * 60 + actualMin;
          if (actualTime < scheduleTime) {
            const undertimeMinutes = scheduleTime - actualTime;
            const undertimeHoursForDay = undertimeMinutes / 60;
            undertimeHours += undertimeHoursForDay;
            undertimeDeduction += undertimeHoursForDay * hourlyRate;
          }
        }

        // Holiday pay (if employee worked on holiday) - use automatically detected holiday
        if (isHolidayDay) {
          if (holidayType === "regular") {
            // Regular holiday: configurable additional pay (default 100%)
            holidayPay += dailyRate * regularHolidayRate * dayMultiplier;
          } else if (holidayType === "special") {
            // Special holiday: configurable rate (default 30%, can be set to 100%)
            holidayPay += dailyRate * specialHolidayRate * dayMultiplier;
          }
        }
      } else if (att.status === "leave") {
        // Leave with pay: don't count as absent, but don't add to days worked either
        // For monthly employees, they still get paid (no deduction)
        // For daily/hourly employees, they don't get paid unless it's a paid leave
        if (isPaidLeave(att.date)) {
          // Paid leave: for monthly employees, no deduction needed (already included in base)
          // For daily/hourly, add the daily rate
          if (salaryType !== "monthly") {
            basicPay += dailyRate;
          }
          daysWorked += 1; // Count as worked day for paid leave
        }
        // Unpaid leave: don't count as absent, but don't add pay either
      } else if (att.status === "absent") {
        // Check if this absence is actually a paid leave (in case status wasn't set correctly)
        if (isPaidLeave(att.date)) {
          // Treat as paid leave
          if (salaryType !== "monthly") {
            basicPay += dailyRate;
          }
          daysWorked += 1;
        } else {
          // For monthly employees, track absent deduction separately
          // For daily/hourly employees, absences don't affect basic pay (they just don't get paid)
          absences += 1;
          if (salaryType === "monthly") {
            absentDeduction += dailyRate;
          }
        }
      }
    }

    // Handle working days in the cutoff that have NO attendance record
    // For monthly employees this is where we treat unrecorded working days as absences
    const allDatesInCutoff: number[] = [];
    const cutoffStartDate = new Date(args.cutoffStart);
    const cutoffEndDate = new Date(args.cutoffEnd);
    const currentDate = new Date(cutoffStartDate);

    while (currentDate <= cutoffEndDate) {
      allDatesInCutoff.push(new Date(currentDate).setHours(0, 0, 0, 0));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    for (const dateTs of allDatesInCutoff) {
      const dateObj = new Date(dateTs);
      const hasAttendance = periodAttendance.some((att: any) => {
        const attDate = new Date(att.date);
        return (
          attDate.getFullYear() === dateObj.getFullYear() &&
          attDate.getMonth() === dateObj.getMonth() &&
          attDate.getDate() === dateObj.getDate()
        );
      });

      if (hasAttendance) continue;

      const isRest = isRestDay(dateTs, employee.schedule);
      const holidayInfo = getHolidayInfo(dateTs);

      // Rest days are not counted as absences
      if (isRest) continue;

      // Regular holidays with no attendance are handled separately in the
      // holidayPay loop below and should not be treated as absences
      if (holidayInfo.isHoliday && holidayInfo.holidayType === "regular") {
        continue;
      }

      // Paid leave without an attendance record
      if (isPaidLeave(dateTs)) {
        if (salaryType !== "monthly") {
          basicPay += dailyRate;
        }
        daysWorked += 1;
        continue;
      }

      // Otherwise, this is an unpaid working day (absence)
      absences += 1;
      if (salaryType === "monthly") {
        absentDeduction += dailyRate;
      }
    }

    // Calculate holiday pay for holidays in period (even if employee didn't work)
    // Regular holidays: employee gets 100% pay even if absent
    // Special holidays: no pay if absent (only if worked)
    for (const holiday of periodHolidays) {
      const holidayDate = new Date(holiday.date);
      const holidayAttendance = periodAttendance.find(
        (att: any) =>
          new Date(att.date).toDateString() === holidayDate.toDateString()
      );

      if (holiday.type === "regular") {
        // Regular holiday: employee gets 100% pay even if absent
        if (!holidayAttendance || holidayAttendance.status === "absent") {
          holidayPay += dailyRate; // 100% holiday pay
        }
        // If employee worked, holiday pay was already added above
      }
      // Special holidays: only pay if employee worked (already handled above)
    }

    // Night differential already accumulated per day from actualOut (10% per hour from 10 PM)

    // Add incentives
    let incentiveTotal = 0;
    if (employee.incentives) {
      for (const incentive of employee.incentives) {
        if (incentive.isActive) {
          if (incentive.frequency === "monthly") {
            incentiveTotal += incentive.amount / 2; // Semi-monthly
          } else if (incentive.frequency === "per-cutoff") {
            incentiveTotal += incentive.amount;
          }
        }
      }
    }

    // Calculate gross pay (total earnings before any deductions)
    const grossPay =
      basicPay + holidayPay + restDayPay + nightDiffPay + incentiveTotal;

    // Check if employee worked at least 1 day
    const hasWorkedAtLeastOneDay = daysWorked > 0;

    // Government deductions: full monthly amounts (SSS from table; PhilHealth 500, Pag-IBIG 200; tax 12% of basic)
    const monthlyBasic = employee.compensation.basicSalary ?? 0;
    const sssMonthly = getSSSContribution(monthlyBasic);
    const sssAmount = sssMonthly.employeeShare;
    const philhealthAmount = PHILHEALTH_EMPLOYEE_MONTHLY;
    const pagibigAmount = PAGIBIG_EMPLOYEE_MONTHLY;
    const withholdingTaxAmount =
      monthlyBasic >= WITHHOLDING_TAX_THRESHOLD
        ? round2(monthlyBasic * TAX_RATE)
        : 0;

    // Total deductions = attendance deductions + government deductions + custom deductions
    // If employee didn't work at least 1 day, no government deductions (they'll be pending)
    let totalDeductions = lateDeduction + undertimeDeduction + absentDeduction;
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
              totalDeductions += deduction.amount / 2; // Semi-monthly
            } else if (deduction.frequency === "per-cutoff") {
              totalDeductions += deduction.amount;
            }
          }
        }
      }
    }

    // Tax: 12% of basic when monthly basic >= 23k
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
      basicPay,
      daysWorked,
      absences,
      lateHours,
      undertimeHours,
      overtimeHours,
      holidayPay,
      restDayPay,
      nightDiffPay,
      overtimeRegular,
      overtimeRestDay,
      overtimeRestDayExcess,
      overtimeSpecialHoliday,
      overtimeSpecialHolidayExcess,
      overtimeLegalHoliday,
      overtimeLegalHolidayExcess,
      incentiveTotal,
      grossPay,
      deductions: {
        sss: sssAmount,
        philhealth: philhealthAmount,
        pagibig: pagibigAmount,
        withholdingTax: withholdingTaxAmount,
        custom:
          totalDeductions -
          lateDeduction -
          undertimeDeduction -
          absentDeduction -
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
            })
          ),
        })
      )
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
            })
          ),
        })
      )
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
        })
      )
    ),
    /** Run-level: enable government deductions for this run. When false, no SSS/PhilHealth/Pag-IBIG/Tax. Override per employee via governmentDeductionSettings. */
    deductionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

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
      createdAt: now,
      updatedAt: now,
    });

    const rates = await getPayrollRates(ctx, args.organizationId);

    // Compute and create payslips for each employee
    for (const employeeId of args.employeeIds) {
      const employee = await ctx.db.get(employeeId);
      if (!employee || employee.organizationId !== args.organizationId)
        continue;

      // Get attendance
      const attendance = await (ctx.db.query("attendance") as any)
        .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
        .collect();

      const periodAttendance = attendance.filter(
        (a: any) => a.date >= args.cutoffStart && a.date <= args.cutoffEnd
      );

      // Use employee-specific rates if set, otherwise use defaults
      const regularHolidayRate =
        employee.compensation.regularHolidayRate ?? 1.0; // Default 100%
      const specialHolidayRate =
        employee.compensation.specialHolidayRate ?? 0.3; // Default 30%

      // Get holidays for the period
      const holidays = await (ctx.db.query("holidays") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", employee.organizationId)
        )
        .collect();

      const periodHolidays = holidays.filter(
        (h: any) => h.date >= args.cutoffStart && h.date <= args.cutoffEnd
      );

      // Helper to automatically detect if a date is a holiday
      const getHolidayInfo = (
        date: number,
        attendanceRecord?: any
      ): { isHoliday: boolean; holidayType?: "regular" | "special" } => {
        // First check if attendance record has holiday info
        if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
          return { isHoliday: true, holidayType: attendanceRecord.holidayType };
        }

        // Otherwise, check against organization holidays
        const dateObj = new Date(date);
        const holiday = periodHolidays.find((h: any) => {
          const holidayDate = new Date(h.date);
          return (
            holidayDate.getFullYear() === dateObj.getFullYear() &&
            holidayDate.getMonth() === dateObj.getMonth() &&
            holidayDate.getDate() === dateObj.getDate()
          );
        });

        if (holiday) {
          return { isHoliday: true, holidayType: holiday.type };
        }

        return { isHoliday: false };
      };

      // Calculate (simplified version - in production, use the full computation)
      // Use salaryType + schedule-aware daily rate: (basic + allowance?) × 12/workingDaysPerYear
      const dailyRate = getDailyRateForEmployee(
        employee,
        args.cutoffStart,
        args.cutoffEnd,
        {
          includeAllowance: rates.dailyRateIncludesAllowance,
          workingDaysPerYear: rates.dailyRateWorkingDaysPerYear,
        }
      );
      let daysWorked = 0;
      let absences = 0;
      let lateHours = 0;
      let undertimeHours = 0;
      let overtimeHours = 0;
      let holidayPay = 0;
      let restDayPay = 0;
      let nightDiffPay = 0;
      let overtimeRegular = 0;
      let overtimeRestDay = 0;
      let overtimeRestDayExcess = 0;
      let overtimeSpecialHoliday = 0;
      let overtimeSpecialHolidayExcess = 0;
      let overtimeLegalHoliday = 0;
      let overtimeLegalHolidayExcess = 0;
      let lateDeduction = 0;
      let undertimeDeduction = 0;
      let absentDeduction = 0;

      // Get approved leave requests for the period to check for paid leave
      const leaveRequests = await (ctx.db.query("leaveRequests") as any)
        .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
        .collect();

      const approvedLeaves = leaveRequests.filter(
        (lr: any) =>
          lr.status === "approved" &&
          lr.startDate <= args.cutoffEnd &&
          lr.endDate >= args.cutoffStart
      );

      // Get leave types to check if leave is paid
      const leaveTypes = await (ctx.db.query("leaveTypes") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", employee.organizationId)
        )
        .collect();

      // Helper to check if a date falls within a paid leave
      const isPaidLeave = (date: number): boolean => {
        const dateObj = new Date(date);
        for (const leave of approvedLeaves) {
          const leaveStart = new Date(leave.startDate);
          const leaveEnd = new Date(leave.endDate);
          if (dateObj >= leaveStart && dateObj <= leaveEnd) {
            // Check if this leave type is paid
            if (leave.leaveType === "custom" && leave.customLeaveType) {
              const leaveType = leaveTypes.find(
                (lt: any) => lt.name === leave.customLeaveType
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

      const salaryType = employee.compensation.salaryType || "monthly";
      const hourlyRate = dailyRate / 8;

      // Process attendance records that exist for this employee
      for (const att of periodAttendance) {
        if (att.status === "present" || att.status === "half-day") {
          const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
          daysWorked += dayMultiplier;

          // Check if this is a rest day for the employee
          const isRestDayForEmployee = isRestDay(att.date, employee.schedule);

          // Rest day premium: 30% of daily rate for working on rest day
          if (isRestDayForEmployee) {
            restDayPay += dailyRate * 0.3 * dayMultiplier;
          }

          // Automatically detect holiday
          const holidayInfo = getHolidayInfo(att.date, att);
          const isHolidayDay = holidayInfo.isHoliday;
          const holidayType = holidayInfo.holidayType;

          // Calculate overtime with proper rates based on day type
          // Overtime hours get additional premium on top of the base day rate
          // Uses employee-specific holiday rates
          if (att.overtime) {
            overtimeHours += att.overtime;
            let overtimeMultiplier = rates.regularOt;
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isRestDayForEmployee) {
              overtimeMultiplier = rates.restDayOt;
            }
          }

          // Calculate late/undertime - track as deductions, don't subtract from basicPay
          if (att.actualIn && att.scheduleIn) {
            const [scheduleHour, scheduleMin] = att.scheduleIn
              .split(":")
              .map(Number);
            const [actualHour, actualMin] = att.actualIn.split(":").map(Number);
            const scheduleTime = scheduleHour * 60 + scheduleMin;
            const actualTime = actualHour * 60 + actualMin;
            if (actualTime > scheduleTime) {
              const lateMinutes = actualTime - scheduleTime;
              const lateHoursForDay = lateMinutes / 60;
              lateHours += lateHoursForDay;
              lateDeduction += lateHoursForDay * hourlyRate;
            }
          }

          if (att.actualOut && att.scheduleOut) {
            const [scheduleHour, scheduleMin] = att.scheduleOut
              .split(":")
              .map(Number);
            const [actualHour, actualMin] = att.actualOut
              .split(":")
              .map(Number);
            const scheduleTime = scheduleHour * 60 + scheduleMin;
            const actualTime = actualHour * 60 + actualMin;
            if (actualTime < scheduleTime) {
              const undertimeMinutes = scheduleTime - actualTime;
              const undertimeHoursForDay = undertimeMinutes / 60;
              undertimeHours += undertimeHoursForDay;
              undertimeDeduction += undertimeHoursForDay * hourlyRate;
            }
          }

          // Holiday pay (if employee worked on holiday) - use automatically detected holiday
          if (isHolidayDay) {
            if (holidayType === "regular") {
              holidayPay += dailyRate * regularHolidayRate * dayMultiplier;
            } else if (holidayType === "special") {
              holidayPay += dailyRate * specialHolidayRate * dayMultiplier;
            }
          }

          // Night diff: 10% per hour for work from 10 PM onwards (from actualOut)
          const dayNightDiffHours = getNightDiffHoursFromActualOut(att.actualOut);
          if (dayNightDiffHours > 0) {
            nightDiffPay += dayNightDiffHours * hourlyRate * rates.nightDiffRate;
          }
        } else if (att.status === "leave") {
          // Leave with pay: don't count as absent, but don't add to days worked either
          // For monthly employees, they still get paid (no deduction)
          // For daily/hourly employees, they don't get paid unless it's a paid leave
          if (isPaidLeave(att.date)) {
            // Paid leave: for monthly employees, no deduction needed (already included in base)
            // For daily/hourly, add the daily rate
            if (salaryType !== "monthly") {
              // Will be added to basicPay calculation below
            }
            daysWorked += 1; // Count as worked day for paid leave
          }
          // Unpaid leave: don't count as absent, but don't add pay either
        } else if (att.status === "absent") {
          // Check if this absence is actually a paid leave (in case status wasn't set correctly)
          if (isPaidLeave(att.date)) {
            // Treat as paid leave
            if (salaryType !== "monthly") {
              // Will be added to basicPay calculation below
            }
            daysWorked += 1;
          } else {
            // For monthly employees, track absent deduction separately
            // For daily/hourly employees, absences don't affect basic pay (they just don't get paid)
            absences += 1;
            if (salaryType === "monthly") {
              absentDeduction += dailyRate;
            }
          }
        }
      }

      // Handle working days in the cutoff that have NO attendance record
      // For monthly employees this is where we treat unrecorded working days as absences
      const allDatesInCutoffForEmployee: number[] = [];
      const cutoffStartForEmployee = new Date(args.cutoffStart);
      const cutoffEndForEmployee = new Date(args.cutoffEnd);
      const currentDateForEmployee = new Date(cutoffStartForEmployee);

      while (currentDateForEmployee <= cutoffEndForEmployee) {
        allDatesInCutoffForEmployee.push(
          new Date(currentDateForEmployee).setHours(0, 0, 0, 0)
        );
        currentDateForEmployee.setDate(currentDateForEmployee.getDate() + 1);
      }

      for (const dateTs of allDatesInCutoffForEmployee) {
        const dateObj = new Date(dateTs);
        const hasAttendance = periodAttendance.some((att: any) => {
          const attDate = new Date(att.date);
          return (
            attDate.getFullYear() === dateObj.getFullYear() &&
            attDate.getMonth() === dateObj.getMonth() &&
            attDate.getDate() === dateObj.getDate()
          );
        });

        if (hasAttendance) continue;

        const isRest = isRestDay(dateTs, employee.schedule);
        const holidayInfo = getHolidayInfo(dateTs);

        // Rest days are not counted as absences
        if (isRest) continue;

        // Regular holidays with no attendance are handled separately in the
        // holidayPay loop below and should not be treated as absences
        if (holidayInfo.isHoliday && holidayInfo.holidayType === "regular") {
          continue;
        }

        // Paid leave without an attendance record
        if (isPaidLeave(dateTs)) {
          if (salaryType !== "monthly") {
            // For daily/hourly employees this would be paid leave; for monthly
            // employees it's already covered by base pay
          }
          daysWorked += 1;
          continue;
        }

        // Otherwise, this is an unpaid working day (absence)
        absences += 1;
        if (salaryType === "monthly") {
          absentDeduction += dailyRate;
        }
      }

      // Calculate holiday pay for regular holidays even if employee didn't work
      for (const holiday of periodHolidays) {
        if (holiday.type === "regular") {
          const holidayDate = new Date(holiday.date);
          const holidayAttendance = periodAttendance.find(
            (att: any) =>
              new Date(att.date).toDateString() === holidayDate.toDateString()
          );

          // Regular holiday: employee gets pay even if absent (based on employee rate)
          // But not if it's a paid leave (already handled)
          if (!holidayAttendance || holidayAttendance.status === "absent") {
            if (!isPaidLeave(holiday.date)) {
              holidayPay += dailyRate * regularHolidayRate;
            }
          }
          // If employee worked, holiday pay was already added above
        }
      }

      // Calculate basic pay (full amount, without subtracting absent/late/undertime)
      let basicPay = 0;
      if (salaryType === "monthly") {
        const monthlySalary = employee.compensation.basicSalary || 0;
        basicPay = monthlySalary / 2; // Semi-monthly base pay (full amount)
        // Absent deductions are tracked separately and will be added to totalDeductions
      } else {
        // For daily/hourly employees, calculate based on days worked
        basicPay = daysWorked * dailyRate;
      }

      // Add overtime pay for all salary types
      // Overtime hours get additional premium on top of the base day rate
      // Uses employee-specific holiday rates and automatically detects holidays
      // Track different overtime types separately
      for (const att of periodAttendance) {
        if (
          (att.status === "present" || att.status === "half-day") &&
          att.overtime &&
          att.overtime > 0
        ) {
          overtimeHours += att.overtime;
          const isRestDayForEmployee = isRestDay(att.date, employee.schedule);

          // Automatically detect holiday
          const holidayInfo = getHolidayInfo(att.date, att);
          const isHolidayDay = holidayInfo.isHoliday;
          const holidayType = holidayInfo.holidayType;

          // Calculate regular OT (up to 8 hours) and excess OT (beyond 8 hours)
          const regularOTHours = Math.min(att.overtime, 8);
          const excessOTHours = Math.max(0, att.overtime - 8);

          // Rest Day + Holiday / Holiday / Rest day / Regular — use labor-rule multipliers
          if (isRestDayForEmployee && isHolidayDay) {
            if (holidayType === "regular") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.regularHolidayOt;
              overtimeLegalHoliday += regularOTAmount;
              if (excessOTHours > 0) overtimeLegalHolidayExcess += excessOTHours * hourlyRate * rates.regularHolidayOt;
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.regularHolidayOt : 0);
            } else if (holidayType === "special") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.specialHolidayOt;
              overtimeSpecialHoliday += regularOTAmount;
              if (excessOTHours > 0) overtimeSpecialHolidayExcess += excessOTHours * hourlyRate * rates.specialHolidayOt;
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.specialHolidayOt : 0);
            }
          } else if (isHolidayDay) {
            if (holidayType === "regular") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.regularHolidayOt;
              overtimeLegalHoliday += regularOTAmount;
              if (excessOTHours > 0) overtimeLegalHolidayExcess += excessOTHours * hourlyRate * rates.regularHolidayOt;
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.regularHolidayOt : 0);
            } else if (holidayType === "special") {
              const regularOTAmount = regularOTHours * hourlyRate * rates.specialHolidayOt;
              overtimeSpecialHoliday += regularOTAmount;
              if (excessOTHours > 0) overtimeSpecialHolidayExcess += excessOTHours * hourlyRate * rates.specialHolidayOt;
              basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.specialHolidayOt : 0);
            }
          } else if (isRestDayForEmployee) {
            const regularOTAmount = regularOTHours * hourlyRate * rates.restDayOt;
            overtimeRestDay += regularOTAmount;
            if (excessOTHours > 0) overtimeRestDayExcess += excessOTHours * hourlyRate * rates.restDayOt;
            basicPay += regularOTAmount + (excessOTHours > 0 ? excessOTHours * hourlyRate * rates.restDayOt : 0);
          } else {
            const regularOTAmount = att.overtime * hourlyRate * rates.regularOt;
            overtimeRegular += regularOTAmount;
            basicPay += regularOTAmount;
          }
        }

        const dayNightDiffHours = getNightDiffHoursFromActualOut(att.actualOut);
        if (dayNightDiffHours > 0) {
          nightDiffPay += dayNightDiffHours * hourlyRate * rates.nightDiffRate;
        }
      }

      // For daily/hourly employees, also add pay for paid leaves
      if (salaryType !== "monthly") {
        for (const att of periodAttendance) {
          if (
            (att.status === "leave" || att.status === "absent") &&
            isPaidLeave(att.date)
          ) {
            // Paid leave pay will be added to grossPay below
          }
        }
      }

      // Get government deduction settings for this employee
      const govSettings = args.governmentDeductionSettings?.find(
        (gs) => gs.employeeId === employeeId
      );

      // Check if manual deductions are provided for this employee
      const manualDeductionEntry = args.manualDeductions?.find(
        (md) => md.employeeId === employeeId
      );

      let deductions: Array<{ name: string; amount: number; type: string }> =
        [];

      const basicSalary = employee.compensation.basicSalary ?? 0;
      // Full monthly amounts only (no semi-monthly split). Run-level deductionsEnabled and per-employee override control what's applied.
      const sssContribution = getSSSContribution(basicSalary);
      const sssEmployeeAmount = sssContribution.employeeShare;
      const sssEmployerAmount = sssContribution.employerShare;
      const philhealthEmployeeAmount = PHILHEALTH_EMPLOYEE_MONTHLY;
      const philhealthEmployerAmount = PHILHEALTH_EMPLOYER_MONTHLY;
      const pagibigEmployeeAmount = PAGIBIG_EMPLOYEE_MONTHLY;
      const pagibigEmployerAmount = PAGIBIG_EMPLOYER_MONTHLY;
      const taxAmount =
        basicSalary >= WITHHOLDING_TAX_THRESHOLD
          ? round2(basicSalary * TAX_RATE)
          : 0;

      const runDeductionsEnabled = deductionsEnabled;

      // Add government deductions only when run has deductions enabled; per-employee override via govSettings (enabled: false = skip that type)
      if (runDeductionsEnabled) {
        if (govSettings) {
          if (govSettings.sss.enabled) {
            deductions.push({ name: "SSS", amount: sssEmployeeAmount, type: "government" });
          }
          if (govSettings.philhealth.enabled) {
            deductions.push({ name: "PhilHealth", amount: philhealthEmployeeAmount, type: "government" });
          }
          if (govSettings.pagibig.enabled) {
            deductions.push({ name: "Pag-IBIG", amount: pagibigEmployeeAmount, type: "government" });
          }
          if (govSettings.tax.enabled) {
            deductions.push({ name: "Withholding Tax", amount: taxAmount, type: "government" });
          }
        } else if (manualDeductionEntry) {
          deductions = [...manualDeductionEntry.deductions];
        } else {
          deductions = [
            { name: "SSS", amount: sssEmployeeAmount, type: "government" },
            { name: "PhilHealth", amount: philhealthEmployeeAmount, type: "government" },
            { name: "Pag-IBIG", amount: pagibigEmployeeAmount, type: "government" },
            { name: "Withholding Tax", amount: taxAmount, type: "government" },
          ];
        }
      } else if (manualDeductionEntry) {
        deductions = [...manualDeductionEntry.deductions];
      }

      // Add manual/custom deductions (loans, etc.) - these are separate from government deductions
      if (manualDeductionEntry && manualDeductionEntry.deductions) {
        // Add all manual deductions (loans, etc.) - these are inputted by accounting
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
                amount: deduction.amount,
                type: deduction.type,
              });
            }
          }
        }
      }

      // Add attendance-based deductions to deductions array
      if (lateDeduction > 0) {
        deductions.push({
          name: "Late",
          amount: lateDeduction,
          type: "attendance",
        });
      }
      if (undertimeDeduction > 0) {
        deductions.push({
          name: "Undertime",
          amount: undertimeDeduction,
          type: "attendance",
        });
      }
      if (absentDeduction > 0) {
        deductions.push({
          name: `Absent (${absences} ${absences === 1 ? "day" : "days"})`,
          amount: absentDeduction,
          type: "attendance",
        });
      }

      // Calculate total deductions (government + custom + attendance deductions)
      const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

      // Get incentives for this employee
      const incentiveEntry = args.incentives?.find(
        (inc) => inc.employeeId === employeeId
      );
      const incentives = incentiveEntry?.incentives || [];
      const totalIncentives = incentives.reduce(
        (sum, inc) => sum + inc.amount,
        0
      );

      // Non-taxable allowance: monthly value, half per semi-monthly cutoff
      const nonTaxableAllowance = (employee.compensation.allowance || 0) / 2;

      // Calculate gross pay (total earnings: basic pay + holiday pay + rest day pay + overtime + incentives)
      // Note: overtime is already included in basicPay from the calculation above
      let grossPay = basicPay + holidayPay + restDayPay + totalIncentives;

      // For daily/hourly employees, add pay for paid leaves to gross pay
      if (salaryType !== "monthly") {
        for (const att of periodAttendance) {
          if (
            (att.status === "leave" || att.status === "absent") &&
            isPaidLeave(att.date)
          ) {
            grossPay += dailyRate;
          }
        }
      }

      // Check if employee worked at least 1 day
      const hasWorkedAtLeastOneDay = daysWorked > 0;

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
              d.name === "Withholding Tax"
          )
          .reduce((sum, d) => sum + d.amount, 0);
        pendingDeductions = govTotal;
        deductions = deductions.filter(
          (d) =>
            d.name !== "SSS" &&
            d.name !== "PhilHealth" &&
            d.name !== "Pag-IBIG" &&
            d.name !== "Withholding Tax"
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
        0
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
          (d) => d.name === "Pending Deductions (Previous Cutoff)"
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

      const hasSSSDeduction = deductions.some(
        (d) => d.name.toLowerCase() === "sss"
      );
      const hasPhilhealthDeduction = deductions.some(
        (d) => d.name.toLowerCase() === "philhealth"
      );
      const hasPagibigDeduction = deductions.some(
        (d) => d.name.toLowerCase() === "pag-ibig" || d.name.toLowerCase() === "pagibig"
      );
      const employerContributions: { sss?: number; philhealth?: number; pagibig?: number } = {};
      if (hasSSSDeduction && sssEmployerAmount > 0) employerContributions.sss = round2(sssEmployerAmount);
      if (hasPhilhealthDeduction && philhealthEmployerAmount > 0) employerContributions.philhealth = round2(philhealthEmployerAmount);
      if (hasPagibigDeduction && pagibigEmployerAmount > 0) employerContributions.pagibig = round2(pagibigEmployerAmount);
      await ctx.db.insert("payslips", {
        organizationId: args.organizationId,
        employeeId,
        payrollRunId,
        period,
        grossPay: round2(grossPay),
        deductions: deductions.map((d) => ({
          ...d,
          amount: round2(d.amount),
        })),
        incentives: incentives.length > 0 ? incentives : undefined,
        nonTaxableAllowance:
          nonTaxableAllowance > 0 ? round2(nonTaxableAllowance) : undefined,
        netPay: round2(netPay),
        daysWorked,
        absences,
        lateHours,
        undertimeHours,
        overtimeHours,
        holidayPay: holidayPay > 0 ? round2(holidayPay) : undefined,
        restDayPay: restDayPay > 0 ? round2(restDayPay) : undefined,
        nightDiffPay: nightDiffPay > 0 ? round2(nightDiffPay) : undefined,
        overtimeRegular: overtimeRegular > 0 ? round2(overtimeRegular) : undefined,
        overtimeRestDay: overtimeRestDay > 0 ? round2(overtimeRestDay) : undefined,
        overtimeRestDayExcess: overtimeRestDayExcess > 0 ? round2(overtimeRestDayExcess) : undefined,
        overtimeSpecialHoliday: overtimeSpecialHoliday > 0 ? round2(overtimeSpecialHoliday) : undefined,
        overtimeSpecialHolidayExcess: overtimeSpecialHolidayExcess > 0 ? round2(overtimeSpecialHolidayExcess) : undefined,
        overtimeLegalHoliday: overtimeLegalHoliday > 0 ? round2(overtimeLegalHoliday) : undefined,
        overtimeLegalHolidayExcess: overtimeLegalHolidayExcess > 0 ? round2(overtimeLegalHolidayExcess) : undefined,
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
      deductionsEnabled: true,
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
            })
          ),
        })
      )
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
            })
          ),
        })
      )
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
        })
      )
    ),
    deductionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    // Only allow editing draft payroll runs
    if (payrollRun.status !== "draft") {
      throw new Error("Can only edit payroll runs in draft status");
    }

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to update payroll run");
    }

    // Update period if dates changed
    let period = payrollRun.period;
    if (args.cutoffStart || args.cutoffEnd) {
      const startDate = new Date(args.cutoffStart || payrollRun.cutoffStart);
      const endDate = new Date(args.cutoffEnd || payrollRun.cutoffEnd);
      period = `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
    }

    const runDeductionsEnabled = args.deductionsEnabled ?? payrollRun.deductionsEnabled ?? true;
    await ctx.db.patch(args.payrollRunId, {
      cutoffStart: args.cutoffStart ?? payrollRun.cutoffStart,
      cutoffEnd: args.cutoffEnd ?? payrollRun.cutoffEnd,
      period,
      deductionsEnabled: runDeductionsEnabled,
      updatedAt: Date.now(),
    });

    // If employees, deductions, incentives, or deductionsEnabled changed, regenerate payslips
    if (
      args.employeeIds ||
      args.manualDeductions ||
      args.incentives ||
      args.governmentDeductionSettings ||
      args.deductionsEnabled !== undefined
    ) {
      // Delete existing payslips
      const existingPayslips = await (ctx.db.query("payslips") as any)
        .withIndex("by_payroll_run", (q: any) =>
          q.eq("payrollRunId", args.payrollRunId)
        )
        .collect();

      for (const payslip of existingPayslips) {
        await ctx.db.delete(payslip._id);
      }

      // Regenerate payslips with new data
      const employeeIds = args.employeeIds || [];
      const cutoffStart = args.cutoffStart || payrollRun.cutoffStart;
      const cutoffEnd = args.cutoffEnd || payrollRun.cutoffEnd;

      const rates = await getPayrollRates(ctx, payrollRun.organizationId);

      for (const employeeId of employeeIds) {
        const employee = await ctx.db.get(employeeId);
        if (!employee || employee.organizationId !== payrollRun.organizationId)
          continue;

        // Get attendance
        const attendance = await (ctx.db.query("attendance") as any)
          .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
          .collect();

        const periodAttendance = attendance.filter(
          (a: any) => a.date >= cutoffStart && a.date <= cutoffEnd
        );

        // Use employee-specific rates if set, otherwise use defaults
        const regularHolidayRate =
          employee.compensation.regularHolidayRate ?? 1.0;
        const specialHolidayRate =
          employee.compensation.specialHolidayRate ?? 0.3;

        // Get holidays for the period
        const holidays = await (ctx.db.query("holidays") as any)
          .withIndex("by_organization", (q: any) =>
            q.eq("organizationId", employee.organizationId)
          )
          .collect();

        const periodHolidays = holidays.filter(
          (h: any) => h.date >= cutoffStart && h.date <= cutoffEnd
        );

        // Calculate using salary type and schedule: (basic + allowance?) × 12/workingDaysPerYear
        const dailyRate = getDailyRateForEmployee(
          employee,
          cutoffStart,
          cutoffEnd,
          {
            includeAllowance: rates.dailyRateIncludesAllowance,
            workingDaysPerYear: rates.dailyRateWorkingDaysPerYear,
          }
        );
        let daysWorked = 0;
        let absences = 0;
        let lateHours = 0;
        let undertimeHours = 0;
        let overtimeHours = 0;
        let holidayPay = 0;
        let restDayPay = 0;
        let nightDiffPay = 0;
        let lateDeduction = 0;
        let undertimeDeduction = 0;
        let absentDeduction = 0;

        // Get approved leave requests for the period to check for paid leave
        const leaveRequests = await (ctx.db.query("leaveRequests") as any)
          .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
          .collect();

        const approvedLeaves = leaveRequests.filter(
          (lr: any) =>
            lr.status === "approved" &&
            lr.startDate <= cutoffEnd &&
            lr.endDate >= cutoffStart
        );

        // Get leave types to check if leave is paid
        const leaveTypes = await (ctx.db.query("leaveTypes") as any)
          .withIndex("by_organization", (q: any) =>
            q.eq("organizationId", employee.organizationId)
          )
          .collect();

        // Helper to check if a date falls within a paid leave
        const isPaidLeave = (date: number): boolean => {
          const dateObj = new Date(date);
          for (const leave of approvedLeaves) {
            const leaveStart = new Date(leave.startDate);
            const leaveEnd = new Date(leave.endDate);
            if (dateObj >= leaveStart && dateObj <= leaveEnd) {
              // Check if this leave type is paid
              if (leave.leaveType === "custom" && leave.customLeaveType) {
                const leaveType = leaveTypes.find(
                  (lt: any) => lt.name === leave.customLeaveType
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

        const salaryType = employee.compensation.salaryType || "monthly";
        const hourlyRate = dailyRate / 8;

        // Helper to automatically detect if a date is a holiday
        const getHolidayInfo = (
          date: number,
          attendanceRecord?: any
        ): { isHoliday: boolean; holidayType?: "regular" | "special" } => {
          // First check if attendance record has holiday info
          if (attendanceRecord?.isHoliday && attendanceRecord?.holidayType) {
            return {
              isHoliday: true,
              holidayType: attendanceRecord.holidayType,
            };
          }

          // Otherwise, check against organization holidays
          const dateObj = new Date(date);
          const holiday = periodHolidays.find((h: any) => {
            const holidayDate = new Date(h.date);
            return (
              holidayDate.getFullYear() === dateObj.getFullYear() &&
              holidayDate.getMonth() === dateObj.getMonth() &&
              holidayDate.getDate() === dateObj.getDate()
            );
          });

          if (holiday) {
            return { isHoliday: true, holidayType: holiday.type };
          }

          return { isHoliday: false };
        };

        for (const att of periodAttendance) {
          if (att.status === "present" || att.status === "half-day") {
            const dayMultiplier = att.status === "half-day" ? 0.5 : 1;
            daysWorked += dayMultiplier;

            // Check if this is a rest day for the employee
            const isRestDayForEmployee = isRestDay(att.date, employee.schedule);

            // Automatically detect holiday
            const holidayInfo = getHolidayInfo(att.date, att);
            const isHolidayDay = holidayInfo.isHoliday;
            const holidayType = holidayInfo.holidayType;

            // Rest day premium: 30% of daily rate for working on rest day
            if (isRestDayForEmployee) {
              restDayPay += dailyRate * 0.3 * dayMultiplier;
            }

            // Calculate overtime with proper rates based on day type
            // Overtime hours get additional premium on top of the base day rate
            // Uses employee-specific holiday rates
            if (att.overtime) {
              overtimeHours += att.overtime;
              let overtimeMultiplier = rates.regularOt;
              if (isRestDayForEmployee && isHolidayDay) {
                if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
                else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
              } else if (isHolidayDay) {
                if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
                else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
              } else if (isRestDayForEmployee) {
                overtimeMultiplier = rates.restDayOt;
              }
            }

            // Calculate late/undertime - track as deductions, don't subtract from basicPay
            if (att.actualIn && att.scheduleIn) {
              const [scheduleHour, scheduleMin] = att.scheduleIn
                .split(":")
                .map(Number);
              const [actualHour, actualMin] = att.actualIn
                .split(":")
                .map(Number);
              const scheduleTime = scheduleHour * 60 + scheduleMin;
              const actualTime = actualHour * 60 + actualMin;
              if (actualTime > scheduleTime) {
                const lateMinutes = actualTime - scheduleTime;
                const lateHoursForDay = lateMinutes / 60;
                lateHours += lateHoursForDay;
                lateDeduction += lateHoursForDay * hourlyRate;
              }
            }

            if (att.actualOut && att.scheduleOut) {
              const [scheduleHour, scheduleMin] = att.scheduleOut
                .split(":")
                .map(Number);
              const [actualHour, actualMin] = att.actualOut
                .split(":")
                .map(Number);
              const scheduleTime = scheduleHour * 60 + scheduleMin;
              const actualTime = actualHour * 60 + actualMin;
              if (actualTime < scheduleTime) {
                const undertimeMinutes = scheduleTime - actualTime;
                const undertimeHoursForDay = undertimeMinutes / 60;
                undertimeHours += undertimeHoursForDay;
                undertimeDeduction += undertimeHoursForDay * hourlyRate;
              }
            }

            // Holiday pay (if employee worked on holiday) - use automatically detected holiday
            if (isHolidayDay) {
              if (holidayType === "regular") {
                holidayPay += dailyRate * regularHolidayRate * dayMultiplier;
              } else if (holidayType === "special") {
                holidayPay += dailyRate * specialHolidayRate * dayMultiplier;
              }
            }

            const dayNightDiffHours = getNightDiffHoursFromActualOut(att.actualOut);
            if (dayNightDiffHours > 0) {
              nightDiffPay += dayNightDiffHours * hourlyRate * rates.nightDiffRate;
            }
          } else if (att.status === "leave") {
            // Leave with pay: don't count as absent
            if (isPaidLeave(att.date)) {
              daysWorked += 1; // Count as worked day for paid leave
            }
          } else if (att.status === "absent") {
            // Check if this absence is actually a paid leave (in case status wasn't set correctly)
            if (isPaidLeave(att.date)) {
              daysWorked += 1;
            } else {
              // For monthly employees, track absent deduction separately
              // For daily/hourly employees, absences don't affect basic pay (they just don't get paid)
              absences += 1;
              if (salaryType === "monthly") {
                absentDeduction += dailyRate;
              }
            }
          }
        }

        // Calculate holiday pay for regular holidays even if employee didn't work
        for (const holiday of periodHolidays) {
          if (holiday.type === "regular") {
            const holidayDate = new Date(holiday.date);
            const holidayAttendance = periodAttendance.find(
              (att: any) =>
                new Date(att.date).toDateString() === holidayDate.toDateString()
            );

            // Regular holiday: employee gets pay even if absent (based on employee rate)
            // But not if it's a paid leave (already handled)
            if (!holidayAttendance || holidayAttendance.status === "absent") {
              if (!isPaidLeave(holiday.date)) {
                holidayPay += dailyRate * regularHolidayRate;
              }
            }
            // If employee worked, holiday pay was already added above
          }
        }

        // Calculate basic pay (full amount, without subtracting absent/late/undertime)
        let basicPay = 0;
        if (salaryType === "monthly") {
          const monthlySalary = employee.compensation.basicSalary || 0;
          basicPay = monthlySalary / 2; // Semi-monthly base pay (full amount)
          // Absent deductions are tracked separately and will be added to totalDeductions
        } else {
          // For daily/hourly employees, calculate based on days worked
          basicPay = daysWorked * dailyRate;
        }

        // Add overtime pay for all salary types
        // Overtime hours get additional premium on top of the base day rate
        // Uses employee-specific holiday rates and automatically detects holidays
        for (const att of periodAttendance) {
          if (
            (att.status === "present" || att.status === "half-day") &&
            att.overtime
          ) {
            const isRestDayForEmployee = isRestDay(att.date, employee.schedule);

            // Automatically detect holiday
            const holidayInfo = getHolidayInfo(att.date, att);
            const isHolidayDay = holidayInfo.isHoliday;
            const holidayType = holidayInfo.holidayType;

            let overtimeMultiplier = rates.regularOt;
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isRestDayForEmployee) {
              overtimeMultiplier = rates.restDayOt;
            }
          }
        }

        // For daily/hourly employees, also add pay for paid leaves
        if (salaryType !== "monthly") {
          for (const att of periodAttendance) {
            if (
              (att.status === "leave" || att.status === "absent") &&
              isPaidLeave(att.date)
            ) {
              // Paid leave pay will be added to grossPay below
            }
          }
        }

        // Get government deduction settings for this employee
        const govSettings = args.governmentDeductionSettings?.find(
          (gs) => gs.employeeId === employeeId
        );

        // Check if manual deductions are provided for this employee
        const manualDeductionEntry = args.manualDeductions?.find(
          (md) => md.employeeId === employeeId
        );

        let deductions: Array<{ name: string; amount: number; type: string }> =
          [];

        const basicSalaryUpdate = employee.compensation.basicSalary ?? 0;
        const sssContributionUpdate = getSSSContribution(basicSalaryUpdate);
        const sssEmployeeAmountUpdate = sssContributionUpdate.employeeShare;
        const sssEmployerAmountUpdate = sssContributionUpdate.employerShare;
        const philhealthEmployeeAmountUpdate = PHILHEALTH_EMPLOYEE_MONTHLY;
        const philhealthEmployerAmountUpdate = PHILHEALTH_EMPLOYER_MONTHLY;
        const pagibigEmployeeAmountUpdate = PAGIBIG_EMPLOYEE_MONTHLY;
        const pagibigEmployerAmountUpdate = PAGIBIG_EMPLOYER_MONTHLY;
        const taxAmountUpdate =
          basicSalaryUpdate >= WITHHOLDING_TAX_THRESHOLD
            ? round2(basicSalaryUpdate * TAX_RATE)
            : 0;

        if (runDeductionsEnabled) {
          if (govSettings) {
            if (govSettings.sss.enabled) {
              deductions.push({ name: "SSS", amount: sssEmployeeAmountUpdate, type: "government" });
            }
            if (govSettings.philhealth.enabled) {
              deductions.push({ name: "PhilHealth", amount: philhealthEmployeeAmountUpdate, type: "government" });
            }
            if (govSettings.pagibig.enabled) {
              deductions.push({ name: "Pag-IBIG", amount: pagibigEmployeeAmountUpdate, type: "government" });
            }
            if (govSettings.tax.enabled) {
              deductions.push({ name: "Withholding Tax", amount: taxAmountUpdate, type: "government" });
            }
          } else {
            deductions = [
              { name: "SSS", amount: sssEmployeeAmountUpdate, type: "government" },
              { name: "PhilHealth", amount: philhealthEmployeeAmountUpdate, type: "government" },
              { name: "Pag-IBIG", amount: pagibigEmployeeAmountUpdate, type: "government" },
              { name: "Withholding Tax", amount: taxAmountUpdate, type: "government" },
            ];
          }
        }


        // Add manual/custom deductions
        if (manualDeductionEntry) {
          manualDeductionEntry.deductions.forEach((ded) => {
            deductions.push(ded);
          });
        }

        // Add employee's custom deductions
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
                  amount: deduction.amount,
                  type: deduction.type,
                });
              }
            }
          }
        }

        // Add attendance-based deductions to deductions array
        if (lateDeduction > 0) {
          deductions.push({
            name: "Late",
            amount: lateDeduction,
            type: "attendance",
          });
        }
        if (undertimeDeduction > 0) {
          deductions.push({
            name: "Undertime",
            amount: undertimeDeduction,
            type: "attendance",
          });
        }
        if (absentDeduction > 0) {
          deductions.push({
            name: `Absent (${absences} ${absences === 1 ? "day" : "days"})`,
            amount: absentDeduction,
            type: "attendance",
          });
        }

        // Calculate total deductions (government + custom + attendance deductions)
        const totalDeductions = deductions.reduce(
          (sum, d) => sum + d.amount,
          0
        );

        // Get incentives for this employee
        const incentiveEntry = args.incentives?.find(
          (inc) => inc.employeeId === employeeId
        );
        const incentives = incentiveEntry?.incentives || [];
        const totalIncentives = incentives.reduce(
          (sum, inc) => sum + inc.amount,
          0
        );

        // Non-taxable allowance: monthly value, half per semi-monthly cutoff
        const nonTaxableAllowance = (employee.compensation.allowance || 0) / 2;

        // Calculate gross pay (total earnings: basic pay + holiday pay + rest day pay + overtime + incentives)
        // Note: basicPay is the full amount, overtime is added separately below
        let grossPay = basicPay + holidayPay + restDayPay + nightDiffPay + totalIncentives;

        // Add overtime pay to gross pay
        for (const att of periodAttendance) {
          if (
            (att.status === "present" || att.status === "half-day") &&
            att.overtime
          ) {
            const isRestDayForEmployee = isRestDay(att.date, employee.schedule);
            const holidayInfo = getHolidayInfo(att.date, att);
            const isHolidayDay = holidayInfo.isHoliday;
            const holidayType = holidayInfo.holidayType;

            let overtimeMultiplier = rates.regularOt;
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isHolidayDay) {
              if (holidayType === "regular") overtimeMultiplier = rates.regularHolidayOt;
              else if (holidayType === "special") overtimeMultiplier = rates.specialHolidayOt;
            } else if (isRestDayForEmployee) {
              overtimeMultiplier = rates.restDayOt;
            }
            grossPay += att.overtime * hourlyRate * overtimeMultiplier;
          }
        }

        // Check if employee worked at least 1 day
        const hasWorkedAtLeastOneDay = daysWorked > 0;

        // Get pending deductions from previous cutoff (same month only)
        // Use payroll run cutoff dates if args not provided
        const periodStart = args.cutoffStart ?? payrollRun.cutoffStart;
        const periodEnd = args.cutoffEnd ?? payrollRun.cutoffEnd;
        const cutoffStartDate = new Date(periodStart);
        const cutoffEndDate = new Date(periodEnd);
        const currentMonth = cutoffStartDate.getMonth();
        const currentYear = cutoffStartDate.getFullYear();

        // Find previous payslips in the same month (excluding current payroll run)
        const previousPayslips = await (ctx.db.query("payslips") as any)
          .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
          .collect();

        const sameMonthPreviousPayslips = previousPayslips.filter((p: any) => {
          // Parse period string to get start date, or use a stored start date field
          // For now, we'll need to parse the period string or check if there's a stored date
          // Let's check if payslip has a stored cutoff start/end or parse period
          let payslipStartDate: Date;
          try {
            // Try to parse period string (format: "MM/DD/YYYY to MM/DD/YYYY")
            const periodParts = p.period.split(" to ");
            if (periodParts.length === 2) {
              payslipStartDate = new Date(periodParts[0]);
            } else {
              // Fallback: use created date or skip
              return false;
            }
          } catch {
            return false;
          }

          return (
            payslipStartDate.getMonth() === currentMonth &&
            payslipStartDate.getFullYear() === currentYear &&
            payslipStartDate < cutoffStartDate &&
            p.pendingDeductions &&
            p.pendingDeductions > 0 &&
            p.payrollRunId !== args.payrollRunId // Exclude current payroll run
          );
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

        let pendingDeductions = 0;

        // Fixed gov deductions already in array; if employee didn't work, move to pending
        if (!hasWorkedAtLeastOneDay) {
          const govTotal = deductions
            .filter(
              (d) =>
                d.name === "SSS" ||
                d.name === "PhilHealth" ||
                d.name === "Pag-IBIG" ||
                d.name === "Withholding Tax"
            )
            .reduce((sum, d) => sum + d.amount, 0);
          pendingDeductions = govTotal;
          deductions = deductions.filter(
            (d) =>
              d.name !== "SSS" &&
              d.name !== "PhilHealth" &&
              d.name !== "Pag-IBIG" &&
              d.name !== "Withholding Tax"
          );
        }

        // Add previous pending deductions to current deductions if employee worked
        if (hasWorkedAtLeastOneDay && previousPendingDeductions > 0) {
          deductions.push({
            name: "Pending Deductions (Previous Cutoff)",
            amount: previousPendingDeductions,
            type: "government",
          });
        } else if (previousPendingDeductions > 0) {
          pendingDeductions += previousPendingDeductions;
        }

        // Recalculate total deductions with updated tax
        const finalTotalDeductions = deductions.reduce(
          (sum, d) => sum + d.amount,
          0
        );

        // Calculate net pay before applying deduction limits
        let netPay = grossPay + nonTaxableAllowance - finalTotalDeductions;

        // Deductions cannot exceed net pay
        if (finalTotalDeductions > netPay + nonTaxableAllowance && netPay > 0) {
          const excessDeductions =
            finalTotalDeductions - (netPay + nonTaxableAllowance);
          pendingDeductions += excessDeductions;
          const pendingDeductionIndex = deductions.findIndex(
            (d) => d.name === "Pending Deductions (Previous Cutoff)"
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

        const hasSSSDeductionUpdate = deductions.some(
          (d) => d.name.toLowerCase() === "sss"
        );
        const hasPhilhealthDeductionUpdate = deductions.some(
          (d) => d.name.toLowerCase() === "philhealth"
        );
        const hasPagibigDeductionUpdate = deductions.some(
          (d) => d.name.toLowerCase() === "pag-ibig" || d.name.toLowerCase() === "pagibig"
        );
        const employerContributionsUpdate: { sss?: number; philhealth?: number; pagibig?: number } = {};
        if (hasSSSDeductionUpdate && sssEmployerAmountUpdate > 0) employerContributionsUpdate.sss = round2(sssEmployerAmountUpdate);
        if (hasPhilhealthDeductionUpdate && philhealthEmployerAmountUpdate > 0) employerContributionsUpdate.philhealth = round2(philhealthEmployerAmountUpdate);
        if (hasPagibigDeductionUpdate && pagibigEmployerAmountUpdate > 0) employerContributionsUpdate.pagibig = round2(pagibigEmployerAmountUpdate);
        await ctx.db.insert("payslips", {
          organizationId: payrollRun.organizationId,
          employeeId,
          payrollRunId: args.payrollRunId,
          period,
          grossPay: round2(grossPay),
          deductions: deductions.map((d) => ({
            ...d,
            amount: round2(d.amount),
          })),
          incentives: incentives.length > 0 ? incentives : undefined,
          nonTaxableAllowance:
            nonTaxableAllowance > 0 ? round2(nonTaxableAllowance) : undefined,
          netPay: round2(netPay),
          daysWorked,
          absences,
          lateHours,
          undertimeHours,
          overtimeHours,
          holidayPay: holidayPay > 0 ? round2(holidayPay) : undefined,
          restDayPay: restDayPay > 0 ? round2(restDayPay) : undefined,
          nightDiffPay: nightDiffPay > 0 ? round2(nightDiffPay) : undefined,
          pendingDeductions:
            pendingDeductions > 0 ? round2(pendingDeductions) : undefined,
          hasWorkedAtLeastOneDay,
          employerContributions:
            Object.keys(employerContributionsUpdate).length > 0
              ? employerContributionsUpdate
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
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const payrollRun = await ctx.db.get(args.payrollRunId);
    if (!payrollRun) throw new Error("Payroll run not found");

    const userRecord = await checkAuth(ctx, payrollRun.organizationId);
    const allowedRoles = ["admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to update payroll run status");
    }

    // If reverting from finalized to draft, delete cost items and clear finalized totals
    if (payrollRun.status === "finalized" && args.status === "draft") {
      await deleteExpenseItemsFromPayroll(ctx, payrollRun);
    }

    // Remove cost items if reverting to draft or archiving after finalize/paid
    if (
      (payrollRun.status === "finalized" || payrollRun.status === "paid") &&
      (args.status === "draft" || args.status === "archived")
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
        q.eq("payrollRunId", args.payrollRunId)
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
      q.eq("organizationId", payrollRun.organizationId)
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
      exp.name === philhealthDeductionExpenseName
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
      q.eq("organizationId", payrollRun.organizationId)
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
  // Remove any existing expense items for this period first so finalize is idempotent
  // (avoids duplicates if status is set to finalized twice or mutation runs twice)
  await deleteExpenseItemsFromPayroll(ctx, payrollRun);

  // Get all payslips for this payroll run
  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) =>
      q.eq("payrollRunId", payrollRun._id)
    )
    .collect();

  if (payslips.length === 0) return;

  const payslipCount = payslips.length;
  const now = Date.now();
  const EMPLOYEE_CATEGORY_NAME = "Employee Related Cost";

  // Payroll record = total net pay (what we actually pay after absences, gov deductions, etc.)
  const totalNetPay = round2(
    payslips.reduce((sum: number, p: any) => sum + (p.netPay ?? 0), 0)
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

  // Create payroll expense item (Employee Related Cost) — amount = total net pay to pay
  if (totalNetPay > 0) {
    await ctx.db.insert("accountingCostItems", {
      organizationId: payrollRun.organizationId,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: payrollExpenseName,
      description: `Total net pay for cutoff period ${payrollRun.period} (${payslipCount} payslip${payslipCount > 1 ? "s" : ""})`,
      amount: totalNetPay,
      amountPaid: 0,
      frequency: "one-time",
      status: "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. Payslips: ${payslipCount}, Total net pay: ₱${totalNetPay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Employee deduction expense items: use ONLY amounts from payslips (no fallbacks).
  // This avoids doubled amounts and ensures tax is 0 when employee is not taxable (e.g. basic < 23k).
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
    totalEmployeePhilHealth + totalPhilHealthEmployer
  );
  const totalPagIbigForAccounting = round2(
    totalEmployeePagIbig + totalPagIbigEmployer
  );

  const sssExpenseName = `SSS - ${periodStr}`;
  const pagibigExpenseName = `Pag-IBIG - ${periodStr}`;
  const philhealthExpenseName = `PhilHealth - ${periodStr}`;
  const taxDeductionExpenseName = `Tax Employee Deductions - ${periodStr}`;

  if (totalEmployeeSSS > 0 || totalSSSEmployer > 0) {
    await ctx.db.insert("accountingCostItems", {
      organizationId: payrollRun.organizationId,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: sssExpenseName,
      description: `Total SSS for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalSSSForAccounting,
      amountPaid: 0,
      frequency: "one-time",
      status: "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (totalEmployeePagIbig > 0 || totalPagIbigEmployer > 0) {
    await ctx.db.insert("accountingCostItems", {
      organizationId: payrollRun.organizationId,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: pagibigExpenseName,
      description: `Total Pag-IBIG for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalPagIbigForAccounting,
      amountPaid: 0,
      frequency: "one-time",
      status: "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (totalEmployeePhilHealth > 0 || totalPhilHealthEmployer > 0) {
    await ctx.db.insert("accountingCostItems", {
      organizationId: payrollRun.organizationId,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: philhealthExpenseName,
      description: `Total PhilHealth for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: totalPhilHealthForAccounting,
      amountPaid: 0,
      frequency: "one-time",
      status: "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (totalEmployeeTax > 0) {
    await ctx.db.insert("accountingCostItems", {
      organizationId: payrollRun.organizationId,
      categoryName: EMPLOYEE_CATEGORY_NAME,
      name: taxDeductionExpenseName,
      description: `Total Tax employee deductions for ${payslipCount} employee(s) in cutoff period ${payrollRun.period}`,
      amount: round2(totalEmployeeTax),
      amountPaid: 0,
      frequency: "one-time",
      status: "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. ${payslipCount} employee(s).`,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Get payroll runs
export const getPayrollRuns = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const runs = await (ctx.db.query("payrollRuns") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    runs.sort((a: any, b: any) => b.createdAt - a.createdAt);
    return runs;
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
        q.eq("payrollRunId", args.payrollRunId)
      )
      .collect();

    const employeeIds = payslips.map((p: any) => p.employeeId);

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Fetch attendance the same way as the attendance page: by_organization then filter by date range
    // (getAttendance uses this so we get the same set of records the user sees on the attendance page)
    let periodAttendance = await (ctx.db.query("attendance") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId)
      )
      .collect();

    // Inclusive date range: include any record on or between cutoff start and end
    const rangeEnd =
      payrollRun.cutoffEnd +
      ONE_DAY_MS -
      1; /* include full last day (e.g. 23:59:59.999) */
    periodAttendance = periodAttendance.filter(
      (a: any) =>
        a.date >= payrollRun.cutoffStart && a.date <= rangeEnd
    );

    // Restrict to employees in this payroll run
    periodAttendance = periodAttendance.filter((a: any) =>
      employeeIds.includes(a.employeeId)
    );

    // Get all employees
    const employees = await Promise.all(
      employeeIds.map(async (id: any) => await ctx.db.get(id))
    );

    // Generate one date slot per calendar day (same logic as attendance page: start + i*24h)
    const numDays =
      Math.floor(
        (payrollRun.cutoffEnd - payrollRun.cutoffStart) / ONE_DAY_MS
      ) + 1;
    const dates: number[] = [];
    for (let i = 0; i < numDays; i++) {
      dates.push(payrollRun.cutoffStart + i * ONE_DAY_MS);
    }

    // Get payroll rates from organization settings (night diff, OT rates, etc.)
    const rates = await getPayrollRates(ctx, payrollRun.organizationId);

    // Get all approved leave requests for all employees in the period
    const allLeaveRequests = await (ctx.db.query("leaveRequests") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId)
      )
      .collect();

    const approvedLeaves = allLeaveRequests.filter(
      (lr: any) =>
        lr.status === "approved" &&
        lr.startDate <= payrollRun.cutoffEnd &&
        lr.endDate >= payrollRun.cutoffStart &&
        employeeIds.includes(lr.employeeId)
    );

    // Get leave types to check if leave is paid
    const leaveTypes = await (ctx.db.query("leaveTypes") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId)
      )
      .collect();

    // Build summary data
    const summary = employees
      .filter((e: any) => e)
      .map((employee: any) => {
        const empAttendance = periodAttendance.filter(
          (a: any) => a.employeeId === employee._id
        );

        // Get approved leaves for this employee
        const empApprovedLeaves = approvedLeaves.filter(
          (lr: any) => lr.employeeId === employee._id
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
                  (lt: any) => lt.name === leave.customLeaveType
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

        // Helper to calculate night differential hours (Philippines: 10pm-6am)
        const calculateNightDiffHours = (
          timeIn?: string,
          timeOut?: string
        ): number => {
          if (!timeIn || !timeOut) return 0;

          const startMinutes = timeToMinutes(timeIn); // 0-1439
          let endMinutes = timeToMinutes(timeOut); // 0-1439

          // Handle shifts that cross midnight (e.g. 22:00-03:00)
          if (endMinutes <= startMinutes) {
            endMinutes += 24 * 60;
          }

          // Night diff window: 22:00 (1320) to 06:00 next day (1800)
          const nightStart = 22 * 60; // 1320
          const nightEnd = 24 * 60 + 6 * 60; // 1800

          const overlapStart = Math.max(startMinutes, nightStart);
          const overlapEnd = Math.min(endMinutes, nightEnd);

          if (overlapEnd <= overlapStart) return 0;

          const overlapMinutes = overlapEnd - overlapStart;
          return overlapMinutes / 60;
        };

        // Build daily attendance data (match by 24h window so attendance aligns with summary dates)
        const dailyData = dates.map((dateTimestamp) => {
          const windowEnd = dateTimestamp + ONE_DAY_MS;
          const att = empAttendance.find(
            (a: any) => a.date >= dateTimestamp && a.date < windowEnd
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

          if (att.status === "present" && att.actualIn && att.scheduleIn) {
            const scheduleMinutes = timeToMinutes(att.scheduleIn);
            const actualMinutes = timeToMinutes(att.actualIn);
            if (actualMinutes > scheduleMinutes) {
              lateMinutes = actualMinutes - scheduleMinutes;
              totalLateMinutes += lateMinutes;
            }
          }

          if (att.status === "present" && att.actualOut && att.scheduleOut) {
            const scheduleMinutes = timeToMinutes(att.scheduleOut);
            const actualMinutes = timeToMinutes(att.actualOut);
            if (actualMinutes < scheduleMinutes) {
              undertimeMinutes = scheduleMinutes - actualMinutes;
              totalUndertimeMinutes += undertimeMinutes;
            }
            if (actualMinutes > scheduleMinutes) {
              const otMinutes = actualMinutes - scheduleMinutes;
              const otHours = otMinutes / 60;
              // Check if it's a holiday for special OT
              if (att.isHoliday && att.holidayType === "special") {
                totalSpecialOTHours += otHours;
                specialOTHours = otHours;
              } else {
                totalRegularOTHours += otHours;
                regularOTHours = otHours;
              }
            }
          }

          // Calculate night differential strictly based on 10pm-6am overlap
          if (att.status === "present") {
            nightDiffHours = calculateNightDiffHours(
              att.actualIn,
              att.actualOut
            );
            totalNightDiffHours += nightDiffHours;
          }

          // Don't count leave or paid leave as absent
          if (att.status === "absent") {
            // Check if this is actually a paid leave
            if (!isPaidLeave(dateTimestamp)) {
              totalAbsentDays += 1;
            }
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
            isAbsent: att.status === "absent" && att.status !== "leave",
            note: att.remarks || null,
          };
        });

        return {
          employee,
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
        q.eq("payrollRunId", args.payrollRunId)
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
      })
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
        })
      )
    ),
    incentives: v.optional(
      v.array(
        v.object({
          name: v.string(),
          amount: v.number(),
          type: v.string(),
        })
      )
    ),
    nonTaxableAllowance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const payslip = await ctx.db.get(args.payslipId);
    if (!payslip) throw new Error("Payslip not found");

    // Check auth - only admin, hr, or accounting can edit
    const userRecord = await checkAuth(ctx, payslip.organizationId);
    const allowedRoles = ["admin", "hr", "accounting"];
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
      0
    );

    // Recalculate gross pay and net pay
    // Get basic pay from original gross pay minus original incentives
    const originalIncentives = payslip.incentives || [];
    const originalTotalIncentives = originalIncentives.reduce(
      (sum, inc) => sum + inc.amount,
      0
    );
    const basicPay = payslip.grossPay - originalTotalIncentives;

    const newGrossPay = round2(basicPay + totalIncentives);
    const newNetPay = round2(
      newGrossPay + newNonTaxableAllowance - totalDeductions
    );

    // Helper function to detect specific changes in arrays
    function detectArrayChanges(
      oldArray: Array<{ name: string; amount: number; type?: string }>,
      newArray: Array<{ name: string; amount: number; type?: string }>
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
            old.name === newItem.name && !processedOld.has(oldIdx)
        );
        if (oldItemWithSameName) {
          const oldIdx = oldArray.indexOf(oldItemWithSameName);
          if (oldItemWithSameName.amount !== newItem.amount) {
            changeDetails.push(
              `Modified "${newItem.name}": ₱${oldItemWithSameName.amount.toFixed(2)} → ₱${newItem.amount.toFixed(2)}`
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
            (old) => old.name === newItem.name
          );
          if (!oldItemWithSameName) {
            changeDetails.push(
              `Added "${newItem.name}": ₱${newItem.amount.toFixed(2)}`
            );
            processedNew.add(newIdx);
          }
        }
      });

      // Find removed items (in old but not in new)
      oldArray.forEach((oldItem, oldIdx) => {
        if (!processedOld.has(oldIdx)) {
          const newItemWithSameName = newArray.find(
            (newItem) => newItem.name === oldItem.name
          );
          if (!newItemWithSameName) {
            changeDetails.push(
              `Removed "${oldItem.name}": ₱${oldItem.amount.toFixed(2)}`
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
      deductions: newDeductions.map((d) => ({ ...d, amount: round2(d.amount) })),
      incentives:
        newIncentives.length > 0
          ? newIncentives.map((i) => ({ ...i, amount: round2(i.amount) }))
          : undefined,
      nonTaxableAllowance:
        newNonTaxableAllowance > 0
          ? round2(newNonTaxableAllowance)
          : undefined,
      grossPay: newGrossPay,
      netPay: newNetPay,
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
      })
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
