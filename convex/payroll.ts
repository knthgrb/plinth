import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
// Allows admin, hr, and accounting roles for payroll access
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "admin" | "hr" | "accounting"
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
  const allowedRoles = ["admin", "hr", "accounting"];
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

// Helper to get per-day rate based on salary type and schedule/rest days.
// - monthly: assume semi-monthly payroll and divide half of monthly salary by
//   working days in the cutoff range
// - daily:   basicSalary is already the per-day rate
// - hourly:  approximate daily rate as hourly * 8
function getDailyRateForEmployee(
  employee: any,
  cutoffStart: number,
  cutoffEnd: number
): number {
  const salaryType = employee.compensation.salaryType || "monthly";
  const basicSalary = employee.compensation.basicSalary || 0;

  if (salaryType === "daily") {
    return basicSalary;
  }

  if (salaryType === "hourly") {
    // Simplest assumption: 8 hours standard per workday
    return basicSalary * 8;
  }
  // Monthly salary: assume semi-monthly payroll using the cutoff range
  const workingDaysInCutoff = getWorkingDaysInRange(
    cutoffStart,
    cutoffEnd,
    employee.schedule
  );
  const baseForCutoff = basicSalary / 2;
  return workingDaysInCutoff > 0
    ? baseForCutoff / workingDaysInCutoff
    : baseForCutoff;
}

// Philippine tax computation (TRAIN Law)
function computeWithholdingTax(taxableIncome: number): number {
  // 2024 TRAIN Law tax brackets
  if (taxableIncome <= 20833) return 0;
  if (taxableIncome <= 33333) return (taxableIncome - 20833) * 0.2;
  if (taxableIncome <= 66667) return 2500 + (taxableIncome - 33333) * 0.25;
  if (taxableIncome <= 166667) return 10833.33 + (taxableIncome - 66667) * 0.3;
  if (taxableIncome <= 666667)
    return 40833.33 + (taxableIncome - 166667) * 0.32;
  return 200833.33 + (taxableIncome - 666667) * 0.35;
}

// SSS contribution computation
function computeSSS(basicSalary: number): {
  employee: number;
  employer: number;
} {
  // 2024 SSS contribution table
  const sssTable = [
    { min: 0, max: 1000, employee: 0, employer: 0 },
    { min: 1000, max: 1249.99, employee: 45, employer: 45 },
    { min: 1250, max: 1749.99, employee: 67.5, employer: 67.5 },
    { min: 1750, max: 2249.99, employee: 90, employer: 90 },
    { min: 2250, max: 2749.99, employee: 112.5, employer: 112.5 },
    { min: 2750, max: 3249.99, employee: 135, employer: 135 },
    { min: 3250, max: 3749.99, employee: 157.5, employer: 157.5 },
    { min: 3750, max: 4249.99, employee: 180, employer: 180 },
    { min: 4250, max: 4749.99, employee: 202.5, employer: 202.5 },
    { min: 4750, max: 5249.99, employee: 225, employer: 225 },
    { min: 5250, max: 5749.99, employee: 247.5, employer: 247.5 },
    { min: 5750, max: 6249.99, employee: 270, employer: 270 },
    { min: 6250, max: 6749.99, employee: 292.5, employer: 292.5 },
    { min: 6750, max: 7249.99, employee: 315, employer: 315 },
    { min: 7250, max: 7749.99, employee: 337.5, employer: 337.5 },
    { min: 7750, max: 8249.99, employee: 360, employer: 360 },
    { min: 8250, max: 8749.99, employee: 382.5, employer: 382.5 },
    { min: 8750, max: 9249.99, employee: 405, employer: 405 },
    { min: 9250, max: 9749.99, employee: 427.5, employer: 427.5 },
    { min: 9750, max: 10249.99, employee: 450, employer: 450 },
    { min: 10250, max: 10749.99, employee: 472.5, employer: 472.5 },
    { min: 10750, max: 11249.99, employee: 495, employer: 495 },
    { min: 11250, max: 11749.99, employee: 517.5, employer: 517.5 },
    { min: 11750, max: 12249.99, employee: 540, employer: 540 },
    { min: 12250, max: 12749.99, employee: 562.5, employer: 562.5 },
    { min: 12750, max: 13249.99, employee: 585, employer: 585 },
    { min: 13250, max: 13749.99, employee: 607.5, employer: 607.5 },
    { min: 13750, max: 14249.99, employee: 630, employer: 630 },
    { min: 14250, max: 14749.99, employee: 652.5, employer: 652.5 },
    { min: 14750, max: 15249.99, employee: 675, employer: 675 },
    { min: 15250, max: 15749.99, employee: 697.5, employer: 697.5 },
    { min: 15750, max: 16249.99, employee: 720, employer: 720 },
    { min: 16250, max: 16749.99, employee: 742.5, employer: 742.5 },
    { min: 16750, max: 17249.99, employee: 765, employer: 765 },
    { min: 17250, max: 17749.99, employee: 787.5, employer: 787.5 },
    { min: 17750, max: 18249.99, employee: 810, employer: 810 },
    { min: 18250, max: 18749.99, employee: 832.5, employer: 832.5 },
    { min: 18750, max: 19249.99, employee: 855, employer: 855 },
    { min: 19250, max: 19749.99, employee: 877.5, employer: 877.5 },
    { min: 19750, max: 20249.99, employee: 900, employer: 900 },
    { min: 20250, max: 20749.99, employee: 922.5, employer: 922.5 },
    { min: 20750, max: 21249.99, employee: 945, employer: 945 },
    { min: 21250, max: 21749.99, employee: 967.5, employer: 967.5 },
    { min: 21750, max: 22249.99, employee: 990, employer: 990 },
    { min: 22250, max: 22749.99, employee: 1012.5, employer: 1012.5 },
    { min: 22750, max: 23249.99, employee: 1035, employer: 1035 },
    { min: 23250, max: 23749.99, employee: 1057.5, employer: 1057.5 },
    { min: 23750, max: 24249.99, employee: 1080, employer: 1080 },
    { min: 24250, max: 24749.99, employee: 1102.5, employer: 1102.5 },
    { min: 24750, max: 25249.99, employee: 1125, employer: 1125 },
    { min: 25250, max: 25749.99, employee: 1147.5, employer: 1147.5 },
    { min: 25750, max: 26249.99, employee: 1170, employer: 1170 },
    { min: 26250, max: 26749.99, employee: 1192.5, employer: 1192.5 },
    { min: 26750, max: 27249.99, employee: 1215, employer: 1215 },
    { min: 27250, max: 27749.99, employee: 1237.5, employer: 1237.5 },
    { min: 27750, max: 28249.99, employee: 1260, employer: 1260 },
    { min: 28250, max: 28749.99, employee: 1282.5, employer: 1282.5 },
    { min: 28750, max: 29249.99, employee: 1305, employer: 1305 },
    { min: 29250, max: 29749.99, employee: 1327.5, employer: 1327.5 },
    { min: 29750, max: 30000, employee: 1350, employer: 1350 },
  ];

  for (const bracket of sssTable) {
    if (basicSalary >= bracket.min && basicSalary <= bracket.max) {
      return { employee: bracket.employee, employer: bracket.employer };
    }
  }

  // If salary exceeds max, use max contribution
  return { employee: 1350, employer: 1350 };
}

// PhilHealth contribution (2024 rates)
function computePhilHealth(basicSalary: number): {
  employee: number;
  employer: number;
} {
  // 2024 PhilHealth: 3% of basic salary, shared 50/50
  const total = basicSalary * 0.03;
  const share = total / 2;
  return { employee: share, employer: share };
}

// Pag-IBIG contribution
function computePagIbig(basicSalary: number): {
  employee: number;
  employer: number;
} {
  // Pag-IBIG: Employee 2%, Employer 2% (max 100 each)
  const employeeShare = Math.min(basicSalary * 0.02, 100);
  const employerShare = Math.min(basicSalary * 0.02, 100);
  return { employee: employeeShare, employer: employerShare };
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

    // Calculate basic pay
    let basicPay = 0;
    let daysWorked = 0;
    let absences = 0;
    let lateHours = 0;
    let undertimeHours = 0;
    let overtimeHours = 0;
    let holidayPay = 0;
    let restDayPay = 0;
    let lateDeduction = 0;
    let undertimeDeduction = 0;
    let absentDeduction = 0;

    // Derive daily rate from salary type and rest days/schedule for this cutoff
    const dailyRate = getDailyRateForEmployee(
      employee,
      args.cutoffStart,
      args.cutoffEnd
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
        if (att.overtime) {
          overtimeHours += att.overtime;
          let overtimeMultiplier = 1.25; // Default 125% for regular days (100% + 25% OT premium)

          // Check combinations: Rest Day + Holiday takes precedence
          if (isRestDayForEmployee && isHolidayDay) {
            if (holidayType === "regular") {
              // Regular holiday on rest day OT: (200% * regularHolidayRate + 30% rest day + 30% OT premium)
              // Base: 200% * regularHolidayRate + 30% = (2.0 * regularHolidayRate + 0.3)
              // OT: Base + 30% = (2.0 * regularHolidayRate + 0.3) + 0.3 = 2.0 * regularHolidayRate + 0.6
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
            } else if (holidayType === "special") {
              // Special holiday on rest day OT: (130% * specialHolidayRate + 30% rest day + 30% OT premium)
              // Base: 130% * specialHolidayRate + 30% = (1.3 * specialHolidayRate + 0.3)
              // OT: Base + 30% = (1.3 * specialHolidayRate + 0.3) + 0.3 = 1.3 * specialHolidayRate + 0.6
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
            }
          } else if (isHolidayDay) {
            if (holidayType === "regular") {
              // Regular holiday OT: (200% * regularHolidayRate + 30% OT premium)
              // 200% = 2.0, so: 2.0 * regularHolidayRate + 0.3
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
            } else if (holidayType === "special") {
              // Special holiday OT: (130% * specialHolidayRate + 30% OT premium)
              // 130% = 1.3, so: 1.3 * specialHolidayRate + 0.3
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
            }
          } else if (isRestDayForEmployee) {
            // Rest day OT: 169% (130% rest day rate + 30% OT premium, but calculated as 1.69x)
            overtimeMultiplier = 1.69;
          }

          basicPay += att.overtime * hourlyRate * overtimeMultiplier;
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

    // Night differential (10pm-6am) - simplified calculation
    const nightDiffHours = 0; // Would need actual time tracking
    const nightDiffPay = nightDiffHours * hourlyRate * 0.1;

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

    // Compute deductions
    const sss = computeSSS(employee.compensation.basicSalary);
    const philhealth = computePhilHealth(employee.compensation.basicSalary);
    const pagibig = computePagIbig(employee.compensation.basicSalary);

    // Total deductions = attendance deductions + government deductions + custom deductions
    // If employee didn't work at least 1 day, no government deductions (they'll be pending)
    let totalDeductions = lateDeduction + undertimeDeduction + absentDeduction;
    let pendingDeductions = 0;

    if (hasWorkedAtLeastOneDay) {
      totalDeductions += sss.employee + philhealth.employee + pagibig.employee;
    } else {
      // No deductions if employee didn't work - set as pending for next cutoff
      pendingDeductions = sss.employee + philhealth.employee + pagibig.employee;
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

    // Compute taxable income (only if employee worked and has deductions)
    let taxableIncome = grossPay;
    let withholdingTax = 0;

    if (hasWorkedAtLeastOneDay) {
      taxableIncome =
        grossPay - sss.employee - philhealth.employee - pagibig.employee;
      withholdingTax = computeWithholdingTax(taxableIncome);
      totalDeductions += withholdingTax;
    } else {
      // If no work, tax is also pending
      taxableIncome = grossPay;
      withholdingTax = computeWithholdingTax(taxableIncome);
      pendingDeductions += withholdingTax;
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
      incentiveTotal,
      grossPay,
      deductions: {
        sss: sss.employee,
        philhealth: philhealth.employee,
        pagibig: pagibig.employee,
        withholdingTax,
        custom:
          totalDeductions -
          lateDeduction -
          undertimeDeduction -
          absentDeduction -
          sss.employee -
          philhealth.employee -
          pagibig.employee -
          withholdingTax,
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
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const now = Date.now();
    const startDate = new Date(args.cutoffStart);
    const endDate = new Date(args.cutoffEnd);
    const period = `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;

    const payrollRunId = await ctx.db.insert("payrollRuns", {
      organizationId: args.organizationId,
      cutoffStart: args.cutoffStart,
      cutoffEnd: args.cutoffEnd,
      period,
      status: "draft",
      processedBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

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
      // Use salaryType + schedule-aware daily rate instead of hardcoded divisors
      const dailyRate = getDailyRateForEmployee(
        employee,
        args.cutoffStart,
        args.cutoffEnd
      );
      let daysWorked = 0;
      let absences = 0;
      let lateHours = 0;
      let undertimeHours = 0;
      let overtimeHours = 0;
      let holidayPay = 0;
      let restDayPay = 0;
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
            let overtimeMultiplier = 1.25; // Default 125% for regular days (100% + 25% OT premium)

            // Check combinations: Rest Day + Holiday takes precedence
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") {
                // Regular holiday on rest day OT: (200% * regularHolidayRate + 30% rest day + 30% OT premium)
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
              } else if (holidayType === "special") {
                // Special holiday on rest day OT: (130% * specialHolidayRate + 30% rest day + 30% OT premium)
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
              }
            } else if (isHolidayDay) {
              if (holidayType === "regular") {
                // Regular holiday OT: (200% * regularHolidayRate + 30% OT premium)
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
              } else if (holidayType === "special") {
                // Special holiday OT: (130% * specialHolidayRate + 30% OT premium)
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
              }
            } else if (isRestDayForEmployee) {
              // Rest day OT: 169% (130% rest day rate + 30% OT premium)
              overtimeMultiplier = 1.69;
            }

            // Overtime pay will be added to basicPay calculation below
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

          let overtimeMultiplier = 1.25; // Default 125% for regular days (100% + 25% OT premium)

          // Check combinations: Rest Day + Holiday takes precedence
          if (isRestDayForEmployee && isHolidayDay) {
            if (holidayType === "regular") {
              // Regular holiday on rest day OT: (200% * regularHolidayRate + 30% rest day + 30% OT premium)
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
            } else if (holidayType === "special") {
              // Special holiday on rest day OT: (130% * specialHolidayRate + 30% rest day + 30% OT premium)
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
            }
          } else if (isHolidayDay) {
            if (holidayType === "regular") {
              // Regular holiday OT: (200% * regularHolidayRate + 30% OT premium)
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
            } else if (holidayType === "special") {
              // Special holiday OT: (130% * specialHolidayRate + 30% OT premium)
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
            }
          } else if (isRestDayForEmployee) {
            overtimeMultiplier = 1.69; // Rest day OT: 169% (130% rest day rate + 30% OT premium)
          }

          // Overtime will be added to grossPay below
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

      // Calculate government deductions (will recalculate tax after grossPay)
      // Declare these before the if/else so they're accessible later
      const sss = computeSSS(employee.compensation.basicSalary);
      const philhealth = computePhilHealth(employee.compensation.basicSalary);
      const pagibig = computePagIbig(employee.compensation.basicSalary);

      // Add government deductions based on settings
      if (govSettings) {
        // Apply frequency (full or half)
        if (govSettings.sss.enabled) {
          deductions.push({
            name: "SSS",
            amount:
              govSettings.sss.frequency === "half"
                ? sss.employee / 2
                : sss.employee,
            type: "government",
          });
        }
        if (govSettings.philhealth.enabled) {
          deductions.push({
            name: "PhilHealth",
            amount:
              govSettings.philhealth.frequency === "half"
                ? philhealth.employee / 2
                : philhealth.employee,
            type: "government",
          });
        }
        if (govSettings.pagibig.enabled) {
          deductions.push({
            name: "Pag-IBIG",
            amount:
              govSettings.pagibig.frequency === "half"
                ? pagibig.employee / 2
                : pagibig.employee,
            type: "government",
          });
        }
        // Withholding tax will be calculated after grossPay is computed
        if (govSettings.tax.enabled) {
          deductions.push({
            name: "Withholding Tax",
            amount: 0, // Will be updated after grossPay calculation
            type: "government",
          });
        }
      } else if (manualDeductionEntry) {
        // Use manual deductions if provided
        deductions = [...manualDeductionEntry.deductions];
      } else {
        // Auto-calculate deductions if not manually provided (default behavior)
        deductions = [
          { name: "SSS", amount: sss.employee, type: "government" },
          {
            name: "PhilHealth",
            amount: philhealth.employee,
            type: "government",
          },
          { name: "Pag-IBIG", amount: pagibig.employee, type: "government" },
        ];

        // Withholding tax will be calculated after grossPay is computed
        deductions.push({
          name: "Withholding Tax",
          amount: 0, // Will be updated after grossPay calculation
          type: "government",
        });
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

      // Get non-taxable allowance from employee compensation
      const nonTaxableAllowance = employee.compensation.allowance || 0;

      // Calculate gross pay (total earnings: basic pay + holiday pay + rest day pay + overtime + incentives)
      // Note: basicPay is the full amount, overtime and paid leaves are added separately below
      let grossPay = basicPay + holidayPay + restDayPay + totalIncentives;

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

          let overtimeMultiplier = 1.25;
          if (isRestDayForEmployee && isHolidayDay) {
            if (holidayType === "regular") {
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
            } else if (holidayType === "special") {
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
            }
          } else if (isHolidayDay) {
            if (holidayType === "regular") {
              overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
            } else if (holidayType === "special") {
              overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
            }
          } else if (isRestDayForEmployee) {
            overtimeMultiplier = 1.69;
          }

          grossPay += att.overtime * hourlyRate * overtimeMultiplier;
        }
      }

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

      // Recalculate taxable income and withholding tax using gross pay
      let taxableIncome = 0;
      let withholdingTax = 0;
      let pendingDeductions = 0;

      if (govSettings) {
        if (hasWorkedAtLeastOneDay) {
          taxableIncome =
            grossPay -
            (govSettings.sss.enabled ? sss.employee : 0) -
            (govSettings.philhealth.enabled ? philhealth.employee : 0) -
            (govSettings.pagibig.enabled ? pagibig.employee : 0);
          withholdingTax = computeWithholdingTax(taxableIncome);

          // Update withholding tax in deductions array
          const taxDeductionIndex = deductions.findIndex(
            (d) => d.name === "Withholding Tax"
          );
          if (taxDeductionIndex >= 0 && govSettings.tax.enabled) {
            deductions[taxDeductionIndex].amount =
              govSettings.tax.frequency === "half"
                ? withholdingTax / 2
                : withholdingTax;
          } else if (taxDeductionIndex >= 0 && !govSettings.tax.enabled) {
            // Remove tax deduction if disabled
            deductions.splice(taxDeductionIndex, 1);
          }
        } else {
          // No deductions if employee didn't work - set as pending
          const sssAmount = govSettings.sss.enabled
            ? govSettings.sss.frequency === "half"
              ? sss.employee / 2
              : sss.employee
            : 0;
          const philhealthAmount = govSettings.philhealth.enabled
            ? govSettings.philhealth.frequency === "half"
              ? philhealth.employee / 2
              : philhealth.employee
            : 0;
          const pagibigAmount = govSettings.pagibig.enabled
            ? govSettings.pagibig.frequency === "half"
              ? pagibig.employee / 2
              : pagibig.employee
            : 0;
          pendingDeductions = sssAmount + philhealthAmount + pagibigAmount;

          // Remove government deductions from array
          deductions = deductions.filter(
            (d) =>
              d.name !== "SSS" &&
              d.name !== "PhilHealth" &&
              d.name !== "Pag-IBIG" &&
              d.name !== "Withholding Tax"
          );
        }
      } else {
        if (hasWorkedAtLeastOneDay) {
          // Recalculate for auto-calculated deductions
          taxableIncome =
            grossPay - sss.employee - philhealth.employee - pagibig.employee;
          withholdingTax = computeWithholdingTax(taxableIncome);

          // Update withholding tax in deductions array
          const taxDeductionIndex = deductions.findIndex(
            (d) => d.name === "Withholding Tax"
          );
          if (taxDeductionIndex >= 0) {
            deductions[taxDeductionIndex].amount = withholdingTax;
          }
        } else {
          // No deductions if employee didn't work - set as pending
          pendingDeductions =
            sss.employee + philhealth.employee + pagibig.employee;

          // Remove government deductions from array
          deductions = deductions.filter(
            (d) =>
              d.name !== "SSS" &&
              d.name !== "PhilHealth" &&
              d.name !== "Pag-IBIG" &&
              d.name !== "Withholding Tax"
          );
        }
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

      await ctx.db.insert("payslips", {
        organizationId: args.organizationId,
        employeeId,
        payrollRunId,
        period,
        grossPay,
        deductions,
        incentives: incentives.length > 0 ? incentives : undefined,
        nonTaxableAllowance:
          nonTaxableAllowance > 0 ? nonTaxableAllowance : undefined,
        netPay,
        daysWorked,
        absences,
        lateHours,
        undertimeHours,
        overtimeHours,
        holidayPay: holidayPay > 0 ? holidayPay : undefined,
        restDayPay: restDayPay > 0 ? restDayPay : undefined,
        pendingDeductions:
          pendingDeductions > 0 ? pendingDeductions : undefined,
        hasWorkedAtLeastOneDay,
        createdAt: now,
      });
    }

    // Keep status as "draft" - user can review and finalize later
    // Update processedAt to track when it was created
    await ctx.db.patch(payrollRunId, {
      processedAt: now,
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

    // Update payroll run
    await ctx.db.patch(args.payrollRunId, {
      cutoffStart: args.cutoffStart ?? payrollRun.cutoffStart,
      cutoffEnd: args.cutoffEnd ?? payrollRun.cutoffEnd,
      period,
      updatedAt: Date.now(),
    });

    // If employees, deductions, or incentives changed, regenerate payslips
    if (
      args.employeeIds ||
      args.manualDeductions ||
      args.incentives ||
      args.governmentDeductionSettings
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

        // Calculate using salary type and schedule for this cutoff
        const dailyRate = getDailyRateForEmployee(
          employee,
          cutoffStart,
          cutoffEnd
        );
        let daysWorked = 0;
        let absences = 0;
        let lateHours = 0;
        let undertimeHours = 0;
        let overtimeHours = 0;
        let holidayPay = 0;
        let restDayPay = 0;
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
              let overtimeMultiplier = 1.25; // Default 125% for regular days (100% + 25% OT premium)

              // Check combinations: Rest Day + Holiday takes precedence
              if (isRestDayForEmployee && isHolidayDay) {
                if (holidayType === "regular") {
                  // Regular holiday on rest day OT: (200% * regularHolidayRate + 30% rest day + 30% OT premium)
                  overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
                } else if (holidayType === "special") {
                  // Special holiday on rest day OT: (130% * specialHolidayRate + 30% rest day + 30% OT premium)
                  overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
                }
              } else if (isHolidayDay) {
                if (holidayType === "regular") {
                  // Regular holiday OT: (200% * regularHolidayRate + 30% OT premium)
                  overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
                } else if (holidayType === "special") {
                  // Special holiday OT: (130% * specialHolidayRate + 30% OT premium)
                  overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
                }
              } else if (isRestDayForEmployee) {
                // Rest day OT: 169% (130% rest day rate + 30% OT premium)
                overtimeMultiplier = 1.69;
              }

              // Overtime pay will be added to basicPay calculation below
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
                // Regular holiday: configurable additional pay (default 100%)
                holidayPay += dailyRate * regularHolidayRate * dayMultiplier;
              } else if (holidayType === "special") {
                // Special holiday: configurable rate (default 30%, can be set to 100%)
                holidayPay += dailyRate * specialHolidayRate * dayMultiplier;
              }
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

            let overtimeMultiplier = 1.25; // Default 125% for regular days (100% + 25% OT premium)

            // Check combinations: Rest Day + Holiday takes precedence
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") {
                // Regular holiday on rest day OT: (200% * regularHolidayRate + 30% rest day + 30% OT premium)
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
              } else if (holidayType === "special") {
                // Special holiday on rest day OT: (130% * specialHolidayRate + 30% rest day + 30% OT premium)
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
              }
            } else if (isHolidayDay) {
              if (holidayType === "regular") {
                // Regular holiday OT: (200% * regularHolidayRate + 30% OT premium)
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
              } else if (holidayType === "special") {
                // Special holiday OT: (130% * specialHolidayRate + 30% OT premium)
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
              }
            } else if (isRestDayForEmployee) {
              overtimeMultiplier = 1.69; // Rest day OT: 169% (130% rest day rate + 30% OT premium)
            }

            // Overtime will be added to grossPay below
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

        // Calculate government deductions (will recalculate tax after grossPay)
        // Declare these before the if/else so they're accessible later
        const sss = computeSSS(employee.compensation.basicSalary);
        const philhealth = computePhilHealth(employee.compensation.basicSalary);
        const pagibig = computePagIbig(employee.compensation.basicSalary);

        // Add government deductions based on settings
        if (govSettings) {
          // Apply frequency (full or half)
          if (govSettings.sss.enabled) {
            deductions.push({
              name: "SSS",
              amount:
                govSettings.sss.frequency === "half"
                  ? sss.employee / 2
                  : sss.employee,
              type: "government",
            });
          }
          if (govSettings.philhealth.enabled) {
            deductions.push({
              name: "PhilHealth",
              amount:
                govSettings.philhealth.frequency === "half"
                  ? philhealth.employee / 2
                  : philhealth.employee,
              type: "government",
            });
          }
          if (govSettings.pagibig.enabled) {
            deductions.push({
              name: "Pag-IBIG",
              amount:
                govSettings.pagibig.frequency === "half"
                  ? pagibig.employee / 2
                  : pagibig.employee,
              type: "government",
            });
          }
          // Withholding tax will be calculated after grossPay is computed
          if (govSettings.tax.enabled) {
            deductions.push({
              name: "Withholding Tax",
              amount: 0, // Will be updated after grossPay calculation
              type: "government",
            });
          }
        } else {
          // Auto-calculate deductions if not manually provided
          deductions = [
            { name: "SSS", amount: sss.employee, type: "government" },
            {
              name: "PhilHealth",
              amount: philhealth.employee,
              type: "government",
            },
            { name: "Pag-IBIG", amount: pagibig.employee, type: "government" },
          ];

          // Withholding tax will be calculated after grossPay is computed
          deductions.push({
            name: "Withholding Tax",
            amount: 0, // Will be updated after grossPay calculation
            type: "government",
          });
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

        // Get non-taxable allowance from employee compensation
        const nonTaxableAllowance = employee.compensation.allowance || 0;

        // Calculate gross pay (total earnings: basic pay + holiday pay + rest day pay + overtime + incentives)
        // Note: basicPay is the full amount, overtime is added separately below
        let grossPay = basicPay + holidayPay + restDayPay + totalIncentives;

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

            let overtimeMultiplier = 1.25;
            if (isRestDayForEmployee && isHolidayDay) {
              if (holidayType === "regular") {
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.6;
              } else if (holidayType === "special") {
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.6;
              }
            } else if (isHolidayDay) {
              if (holidayType === "regular") {
                overtimeMultiplier = 2.0 * regularHolidayRate + 0.3;
              } else if (holidayType === "special") {
                overtimeMultiplier = 1.3 * specialHolidayRate + 0.3;
              }
            } else if (isRestDayForEmployee) {
              overtimeMultiplier = 1.69;
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

        // Recalculate taxable income and withholding tax using gross pay
        let taxableIncome = 0;
        let withholdingTax = 0;
        let pendingDeductions = 0;

        if (govSettings) {
          if (hasWorkedAtLeastOneDay) {
            taxableIncome =
              grossPay -
              (govSettings.sss.enabled ? sss.employee : 0) -
              (govSettings.philhealth.enabled ? philhealth.employee : 0) -
              (govSettings.pagibig.enabled ? pagibig.employee : 0);
            withholdingTax = computeWithholdingTax(taxableIncome);

            // Update withholding tax in deductions array
            const taxDeductionIndex = deductions.findIndex(
              (d) => d.name === "Withholding Tax"
            );
            if (taxDeductionIndex >= 0 && govSettings.tax.enabled) {
              deductions[taxDeductionIndex].amount =
                govSettings.tax.frequency === "half"
                  ? withholdingTax / 2
                  : withholdingTax;
            } else if (taxDeductionIndex >= 0 && !govSettings.tax.enabled) {
              deductions.splice(taxDeductionIndex, 1);
            }
          } else {
            // No deductions if employee didn't work - set as pending
            const sssAmount = govSettings.sss.enabled
              ? govSettings.sss.frequency === "half"
                ? sss.employee / 2
                : sss.employee
              : 0;
            const philhealthAmount = govSettings.philhealth.enabled
              ? govSettings.philhealth.frequency === "half"
                ? philhealth.employee / 2
                : philhealth.employee
              : 0;
            const pagibigAmount = govSettings.pagibig.enabled
              ? govSettings.pagibig.frequency === "half"
                ? pagibig.employee / 2
                : pagibig.employee
              : 0;
            pendingDeductions = sssAmount + philhealthAmount + pagibigAmount;

            // Remove government deductions from array
            deductions = deductions.filter(
              (d) =>
                d.name !== "SSS" &&
                d.name !== "PhilHealth" &&
                d.name !== "Pag-IBIG" &&
                d.name !== "Withholding Tax"
            );
          }
        } else {
          if (hasWorkedAtLeastOneDay) {
            taxableIncome =
              grossPay - sss.employee - philhealth.employee - pagibig.employee;
            withholdingTax = computeWithholdingTax(taxableIncome);

            const taxDeductionIndex = deductions.findIndex(
              (d) => d.name === "Withholding Tax"
            );
            if (taxDeductionIndex >= 0) {
              deductions[taxDeductionIndex].amount = withholdingTax;
            }
          } else {
            pendingDeductions =
              sss.employee + philhealth.employee + pagibig.employee;

            deductions = deductions.filter(
              (d) =>
                d.name !== "SSS" &&
                d.name !== "PhilHealth" &&
                d.name !== "Pag-IBIG" &&
                d.name !== "Withholding Tax"
            );
          }
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

        await ctx.db.insert("payslips", {
          organizationId: payrollRun.organizationId,
          employeeId,
          payrollRunId: args.payrollRunId,
          period,
          grossPay,
          deductions,
          incentives: incentives.length > 0 ? incentives : undefined,
          nonTaxableAllowance:
            nonTaxableAllowance > 0 ? nonTaxableAllowance : undefined,
          netPay,
          daysWorked,
          absences,
          lateHours,
          undertimeHours,
          overtimeHours,
          holidayPay: holidayPay > 0 ? holidayPay : undefined,
          restDayPay: restDayPay > 0 ? restDayPay : undefined,
          pendingDeductions:
            pendingDeductions > 0 ? pendingDeductions : undefined,
          hasWorkedAtLeastOneDay,
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

    // If reverting from finalized to draft, delete cost items
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

    // Fetch latest run (with new status) to ensure up-to-date data for expenses
    const updatedRun = await ctx.db.get(args.payrollRunId);

    if (args.status === "finalized") {
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
    const allowedRoles = ["admin", "hr", "accounting"];
    if (!allowedRoles.includes(userRecord.role)) {
      throw new Error("Not authorized to delete payroll runs");
    }

    // Clean up cost items if they exist
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
  const sssExpenseName = `SSS Contribution - ${periodStr}`;
  const philhealthExpenseName = `PhilHealth Contribution - ${periodStr}`;
  const pagibigExpenseName = `Pag-IBIG Contribution - ${periodStr}`;

  // Get all expense items for this organization
  const existingExpenses = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId)
    )
    .collect();

  // Find and delete matching expense items
  const expensesToDelete = existingExpenses.filter(
    (exp: any) =>
      exp.name === payrollExpenseName ||
      exp.name === sssExpenseName ||
      exp.name === philhealthExpenseName ||
      exp.name === pagibigExpenseName
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
    `SSS Contribution - ${periodStr}`,
    `PhilHealth Contribution - ${periodStr}`,
    `Pag-IBIG Contribution - ${periodStr}`,
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
  // Get all payslips for this payroll run
  const payslips = await (ctx.db.query("payslips") as any)
    .withIndex("by_payroll_run", (q: any) =>
      q.eq("payrollRunId", payrollRun._id)
    )
    .collect();

  if (payslips.length === 0) return;

  // Debug: Log payslip count and totals
  const payslipCount = payslips.length;
  const totalGrossPayFromPayslips = payslips.reduce(
    (sum: number, p: any) => sum + (p.grossPay || 0),
    0
  );
  const totalAllowancesFromPayslips = payslips.reduce(
    (sum: number, p: any) => sum + (p.nonTaxableAllowance || 0),
    0
  );

  // Get or create Employee Related Cost category
  const categories = await (ctx.db.query("accountingCategories") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId)
    )
    .collect();

  let employeeCategory = categories.find(
    (cat: any) => cat.name === "Employee Related Cost"
  );

  const now = Date.now();

  // Create Employee Related Cost category if it doesn't exist
  if (!employeeCategory) {
    const categoryId = await ctx.db.insert("accountingCategories", {
      organizationId: payrollRun.organizationId,
      name: "Employee Related Cost",
      description:
        "Costs related to employees including payroll, benefits, and leave",
      createdAt: now,
      updatedAt: now,
    });
    employeeCategory = await ctx.db.get(categoryId);
  }

  // Calculate totals across all payslips
  let totalSalary = 0;
  let totalEmployerSSS = 0;
  let totalEmployerPhilHealth = 0;
  let totalEmployerPagIbig = 0;

  // Get all employees to calculate employer contributions
  const employeeIds = [...new Set(payslips.map((p: any) => p.employeeId))];
  const employees = await Promise.all(
    employeeIds.map((id: any) => ctx.db.get(id))
  );

  // Determine if this is a semi-monthly or monthly cutoff
  const cutoffDuration = payrollRun.cutoffEnd - payrollRun.cutoffStart;
  const daysInCutoff = cutoffDuration / (1000 * 60 * 60 * 24);
  const isSemiMonthly = daysInCutoff <= 18; // Approximately 15 days or less

  for (const payslip of payslips) {
    // Total salary expense: always use gross pay + non-taxable allowance.
    // This ensures the full salary cost is captured in accounting even when
    // employee-side deductions (government, loans, etc.) reduce the net pay
    // to zero.
    const nonTaxableAllowance = payslip.nonTaxableAllowance || 0;
    const totalEarnings = (payslip.grossPay || 0) + nonTaxableAllowance;
    totalSalary += totalEarnings;

    // Find employee to get basic salary for employer contribution calculation
    const employee = employees.find((e: any) => e?._id === payslip.employeeId);
    if (employee) {
      const basicSalary = employee.compensation?.basicSalary || 0;
      const sss = computeSSS(basicSalary);
      const philhealth = computePhilHealth(basicSalary);
      const pagibig = computePagIbig(basicSalary);

      // Divide by 2 for semi-monthly cutoffs (monthly contributions split in half)
      const divisor = isSemiMonthly ? 2 : 1;
      totalEmployerSSS += sss.employer / divisor;
      totalEmployerPhilHealth += philhealth.employer / divisor;
      totalEmployerPagIbig += pagibig.employer / divisor;
    }
  }

  const totalEmployerBenefits =
    totalEmployerSSS + totalEmployerPhilHealth + totalEmployerPagIbig;

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

  // Check for existing expense items to prevent duplicates
  const existingExpenses = await (ctx.db.query("accountingCostItems") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", payrollRun.organizationId)
    )
    .collect();

  const payrollExpenseName = `Payroll - ${periodStr}`;
  const sssExpenseName = `SSS Contribution - ${periodStr}`;
  const philhealthExpenseName = `PhilHealth Contribution - ${periodStr}`;
  const pagibigExpenseName = `Pag-IBIG Contribution - ${periodStr}`;

  const existingPayrollExpense = existingExpenses.find(
    (exp: any) => exp.name === payrollExpenseName
  );
  const existingSSSExpense = existingExpenses.find(
    (exp: any) => exp.name === sssExpenseName
  );
  const existingPhilHealthExpense = existingExpenses.find(
    (exp: any) => exp.name === philhealthExpenseName
  );
  const existingPagIbigExpense = existingExpenses.find(
    (exp: any) => exp.name === pagibigExpenseName
  );

  // Create or update salary expense item (Employee Related Cost)
  if (totalSalary > 0) {
    const totalGrossPay = payslips.reduce(
      (sum: number, p: any) => sum + (p.grossPay || 0),
      0
    );
    const totalAllowances = payslips.reduce(
      (sum: number, p: any) => sum + (p.nonTaxableAllowance || 0),
      0
    );
    const finalAmount = totalSalary;

    const payload = {
      organizationId: payrollRun.organizationId,
      categoryId: employeeCategory._id,
      name: payrollExpenseName,
      description: `Total salary expense for cutoff period ${payrollRun.period} (${payslipCount} payslip${payslipCount > 1 ? "s" : ""})`,
      amount: finalAmount,
      amountPaid: existingPayrollExpense
        ? Math.min(existingPayrollExpense.amountPaid || 0, finalAmount)
        : 0,
      frequency: "monthly",
      status: existingPayrollExpense?.status || "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. Payslips: ${payslipCount}, Gross Pay: ₱${totalGrossPay.toLocaleString()}${totalAllowances > 0 ? `, Allowances: ₱${totalAllowances.toLocaleString()}` : ""}, Total Expense: ₱${finalAmount.toLocaleString()}`,
      receipts: existingPayrollExpense?.receipts,
      createdAt: existingPayrollExpense?.createdAt || now,
      updatedAt: now,
    };

    if (existingPayrollExpense) {
      await ctx.db.patch(existingPayrollExpense._id, payload);
    } else {
      await ctx.db.insert("accountingCostItems", payload);
    }
  }

  // Create or update separate benefit expense items (Employee Related Cost)
  if (totalEmployerSSS > 0) {
    const payload = {
      organizationId: payrollRun.organizationId,
      categoryId: employeeCategory._id,
      name: sssExpenseName,
      description: `Company share of SSS contribution for cutoff period ${payrollRun.period}`,
      amount: totalEmployerSSS,
      amountPaid: existingSSSExpense
        ? Math.min(existingSSSExpense.amountPaid || 0, totalEmployerSSS)
        : 0,
      frequency: "monthly",
      status: existingSSSExpense?.status || "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. Company SSS contribution: ₱${totalEmployerSSS.toLocaleString()}`,
      receipts: existingSSSExpense?.receipts,
      createdAt: existingSSSExpense?.createdAt || now,
      updatedAt: now,
    };

    if (existingSSSExpense) {
      await ctx.db.patch(existingSSSExpense._id, payload);
    } else {
      await ctx.db.insert("accountingCostItems", payload);
    }
  }

  if (totalEmployerPhilHealth > 0) {
    const payload = {
      organizationId: payrollRun.organizationId,
      categoryId: employeeCategory._id,
      name: philhealthExpenseName,
      description: `Company share of PhilHealth contribution for cutoff period ${payrollRun.period}`,
      amount: totalEmployerPhilHealth,
      amountPaid: existingPhilHealthExpense
        ? Math.min(
            existingPhilHealthExpense.amountPaid || 0,
            totalEmployerPhilHealth
          )
        : 0,
      frequency: "monthly",
      status: existingPhilHealthExpense?.status || "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. Company PhilHealth contribution: ₱${totalEmployerPhilHealth.toLocaleString()}`,
      receipts: existingPhilHealthExpense?.receipts,
      createdAt: existingPhilHealthExpense?.createdAt || now,
      updatedAt: now,
    };

    if (existingPhilHealthExpense) {
      await ctx.db.patch(existingPhilHealthExpense._id, payload);
    } else {
      await ctx.db.insert("accountingCostItems", payload);
    }
  }

  if (totalEmployerPagIbig > 0) {
    const payload = {
      organizationId: payrollRun.organizationId,
      categoryId: employeeCategory._id,
      name: pagibigExpenseName,
      description: `Company share of Pag-IBIG contribution for cutoff period ${payrollRun.period}`,
      amount: totalEmployerPagIbig,
      amountPaid: existingPagIbigExpense
        ? Math.min(existingPagIbigExpense.amountPaid || 0, totalEmployerPagIbig)
        : 0,
      frequency: "monthly",
      status: existingPagIbigExpense?.status || "pending",
      dueDate: payrollRun.cutoffEnd + 7 * 24 * 60 * 60 * 1000,
      notes: `Auto-generated from payroll run ${payrollRun.period}. Company Pag-IBIG contribution: ₱${totalEmployerPagIbig.toLocaleString()}`,
      receipts: existingPagIbigExpense?.receipts,
      createdAt: existingPagIbigExpense?.createdAt || now,
      updatedAt: now,
    };

    if (existingPagIbigExpense) {
      await ctx.db.patch(existingPagIbigExpense._id, payload);
    } else {
      await ctx.db.insert("accountingCostItems", payload);
    }
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

    // Get all attendance records for these employees in the cutoff period
    // Query by employee and date range more efficiently
    const periodAttendance: any[] = [];
    for (const employeeId of employeeIds) {
      const empAttendance = await (ctx.db.query("attendance") as any)
        .withIndex("by_employee", (q: any) => q.eq("employeeId", employeeId))
        .collect();

      const filtered = empAttendance.filter(
        (a: any) =>
          a.date >= payrollRun.cutoffStart && a.date <= payrollRun.cutoffEnd
      );
      periodAttendance.push(...filtered);
    }

    // Get all employees
    const employees = await Promise.all(
      employeeIds.map(async (id: any) => await ctx.db.get(id))
    );

    // Generate all dates in the cutoff period
    const dates: number[] = [];
    const startDate = new Date(payrollRun.cutoffStart);
    const endDate = new Date(payrollRun.cutoffEnd);
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate).setHours(0, 0, 0, 0));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Get organization settings for night diff percent (once for all employees)
    const orgSettings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", payrollRun.organizationId)
      )
      .first();
    const nightDiffPercent =
      orgSettings?.payrollSettings?.nightDiffPercent || 0.1; // Default 10%

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

        // Build daily attendance data
        const dailyData = dates.map((dateTimestamp) => {
          // Find attendance for this exact date (match by day, not timestamp)
          const att = empAttendance.find((a: any) => {
            const attDate = new Date(a.date);
            const targetDate = new Date(dateTimestamp);
            return (
              attDate.getFullYear() === targetDate.getFullYear() &&
              attDate.getMonth() === targetDate.getMonth() &&
              attDate.getDate() === targetDate.getDate()
            );
          });

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

    const newGrossPay = basicPay + totalIncentives;
    const newNetPay = newGrossPay + newNonTaxableAllowance - totalDeductions;

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
      deductions: newDeductions,
      incentives: newIncentives.length > 0 ? newIncentives : undefined,
      nonTaxableAllowance:
        newNonTaxableAllowance > 0 ? newNonTaxableAllowance : undefined,
      grossPay: newGrossPay,
      netPay: newNetPay,
      editHistory:
        updatedEditHistory.length > 0 ? updatedEditHistory : undefined,
    });

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
