import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { holidayAppliesToEmployee } from "@/lib/payroll-calculations";
import {
  calculateLate,
  calculateUndertime,
} from "@/utils/attendance-calculations";
import { getScheduleWithLunch } from "./shifts";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
function getManilaDateParts(ts: number) {
  const d = new Date(ts + MANILA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
/** Day of week in Manila (0 = Sunday, 6 = Saturday) so schedule uses correct day regardless of server TZ. */
function getManilaDayOfWeek(ts: number): number {
  return new Date(ts + MANILA_OFFSET_MS).getUTCDay();
}
/** Returns the full matching holiday entry for a date, or null. */
function getMatchingHolidayEntryForDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
    applyToAll?: boolean;
    provinces?: string[];
  }[],
): (typeof holidays)[0] | null {
  const target = getManilaDateParts(dateTs);
  for (const h of holidays) {
    const effectiveTs = h.offsetDate ?? h.date;
    const parts = getManilaDateParts(
      typeof effectiveTs === "number"
        ? effectiveTs
        : new Date(effectiveTs).getTime(),
    );
    const match = h.isRecurring
      ? parts.m === target.m && parts.d === target.d
      : (h.year == null || h.year === target.y) &&
        parts.y === target.y &&
        parts.m === target.m &&
        parts.d === target.d;
    if (
      match &&
      (h.type === "regular" ||
        h.type === "special" ||
        h.type === "special_working")
    ) {
      return h;
    }
  }
  return null;
}

function isNoWorkAllowedForEmployeeDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
    applyToAll?: boolean;
    provinces?: string[];
  }[],
  employee: any,
): boolean {
  const holidayEntry = getMatchingHolidayEntryForDate(dateTs, holidays);
  if (!holidayEntry) return false;
  if (
    holidayEntry.type !== "regular" &&
    holidayEntry.type !== "special"
  ) {
    return false;
  }
  return holidayAppliesToEmployee(holidayEntry, employee);
}

/** HR-chosen statuses that must not be replaced by automatic holiday + no clock time → no_work. */
const STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME = new Set([
  "absent",
  "half-day",
  "leave",
  "leave_with_pay",
  "leave_without_pay",
  "no_work",
]);

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr",
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

  // Owner has all admin privileges - treat owner the same as admin
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";

  if (requiredRole) {
    // Write operations (create/update/delete): hr, admin, owner only - no accounting
    if (userRole !== requiredRole && !isOwnerOrAdmin) {
      throw new Error("Not authorized");
    }
  } else {
    // Read access: hr, admin, owner, employee, and accounting (for payroll/payslips)
    if (
      !isOwnerOrAdmin &&
      userRole !== "hr" &&
      userRole !== "employee" &&
      userRole !== "accounting"
    ) {
      throw new Error("Not authorized");
    }
  }

  return { ...userRecord, role: userRole, organizationId };
}

/** Resolves the employee id for the current user in this org (payslips / employee-view + punch). */
async function resolveSelfEmployeeIdForOrg(
  ctx: any,
  userRecord: { _id: any; email?: string; employeeId?: any; role?: string },
  organizationId: any,
) {
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId),
    )
    .first();

  const fromLink = userOrg?.employeeId ?? userRecord.employeeId ?? null;
  const orgRole = (userOrg?.role ?? userRecord.role ?? "").toLowerCase();
  const elevated = ["owner", "admin", "hr", "accounting"].includes(orgRole);

  const findByEmail = async () => {
    const emailNorm = (userRecord.email || "").trim().toLowerCase();
    if (!emailNorm) return null;
    const emps = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", organizationId),
      )
      .collect();
    const m = emps.find(
      (e: any) =>
        (e.personalInfo?.email || "").trim().toLowerCase() === emailNorm,
    );
    return m?._id ?? null;
  };

  if (orgRole === "employee") {
    if (fromLink) return fromLink;
    return await findByEmail();
  }
  if (elevated) {
    const byEmail = await findByEmail();
    return byEmail ?? fromLink;
  }
  return fromLink;
}

function getManilaNowHHmm() {
  const d = new Date(Date.now() + MANILA_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getManilaTodayDateUtcMs() {
  const p = getManilaDateParts(Date.now());
  return Date.UTC(p.y, p.m, p.d, 0, 0, 0, 0);
}

// Helper to get the employee's scheduled in/out time for a specific date,
// taking into account defaultSchedule and any scheduleOverrides.
// Uses Manila timezone for day-of-week so the correct per-day schedule is used.
function getScheduledTimesForDate(
  date: number,
  employeeSchedule: any,
): { scheduleIn: string | null; scheduleOut: string | null } {
  if (!employeeSchedule?.defaultSchedule) {
    return { scheduleIn: null, scheduleOut: null };
  }

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;

  const manilaParts = getManilaDateParts(date);

  // First check for an explicit override on this date (compare in Manila calendar)
  if (
    employeeSchedule.scheduleOverrides &&
    Array.isArray(employeeSchedule.scheduleOverrides)
  ) {
    const override = employeeSchedule.scheduleOverrides.find((o: any) => {
      if (o.date == null) return false;
      const oParts = getManilaDateParts(
        typeof o.date === "number" ? o.date : new Date(o.date).getTime(),
      );
      return (
        oParts.y === manilaParts.y &&
        oParts.m === manilaParts.m &&
        oParts.d === manilaParts.d
      );
    });
    if (override && override.in && override.out) {
      return { scheduleIn: override.in, scheduleOut: override.out };
    }
  }

  // Fall back to defaultSchedule based on day of week in Manila
  const manilaDay = getManilaDayOfWeek(date);
  const dayName = dayNames[manilaDay];
  const daySchedule =
    employeeSchedule.defaultSchedule[
      dayName as keyof typeof employeeSchedule.defaultSchedule
    ];

  if (!daySchedule || !daySchedule.in || !daySchedule.out) {
    return { scheduleIn: null, scheduleOut: null };
  }

  return { scheduleIn: daySchedule.in, scheduleOut: daySchedule.out };
}

// Get attendance for employee
export const getEmployeeAttendance = query({
  args: {
    employeeId: v.id("employees"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const userRecord = await checkAuth(ctx, employee.organizationId);

    if (userRecord.role === "employee") {
      const selfId = await resolveSelfEmployeeIdForOrg(
        ctx,
        userRecord,
        employee.organizationId,
      );
      if (!selfId || selfId !== args.employeeId) {
        throw new Error("Not authorized");
      }
    }

    let attendance = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    // Filter by date range
    if (args.startDate) {
      attendance = attendance.filter((a: any) => a.date >= args.startDate!);
    }
    if (args.endDate) {
      attendance = attendance.filter((a: any) => a.date <= args.endDate!);
    }

    // Sort by date descending
    attendance.sort((a: any, b: any) => b.date - a.date);

    return attendance;
  },
});

// Get attendance for date range (all employees or specific)
export const getAttendance = query({
  args: {
    organizationId: v.id("organizations"),
    startDate: v.number(),
    endDate: v.number(),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let attendance = await (ctx.db.query("attendance") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Filter by date range
    attendance = attendance.filter(
      (a: any) => a.date >= args.startDate && a.date <= args.endDate,
    );

    // Filter by employee if specified
    if (args.employeeId) {
      attendance = attendance.filter(
        (a: any) => a.employeeId === args.employeeId,
      );
    }

    // Sort by date descending
    attendance.sort((a: any, b: any) => b.date - a.date);

    return attendance;
  },
});

// Create attendance entry
export const createAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.number(),
    scheduleIn: v.string(),
    scheduleOut: v.string(),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()),
    late: v.optional(v.number()), // Manual override for late (minutes)
    undertime: v.optional(v.number()), // Manual override for undertime (hours)
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working"),
      ),
    ),
    remarks: v.optional(v.string()),
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half-day"),
      v.literal("leave"),
      v.literal("leave_with_pay"),
      v.literal("leave_without_pay"),
      v.literal("no_work"),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    // Check if attendance already exists for this date
    const existing = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee_date", (q: any) =>
        q.eq("employeeId", args.employeeId).eq("date", args.date),
      )
      .first();

    if (existing) {
      throw new Error("Attendance already exists for this date");
    }

    // On regular/special holiday with no time in/out → no_work (no additional pay)
    let resolvedStatus = args.status;
    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const employee = await ctx.db.get(args.employeeId);
    if (args.status === "no_work" && employee) {
      if (!isNoWorkAllowedForEmployeeDate(args.date, holidays, employee)) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
    }
    if (
      !args.actualIn &&
      !args.actualOut &&
      employee &&
      !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(args.status)
    ) {
      const holidayEntry = getMatchingHolidayEntryForDate(args.date, holidays);
      if (
        holidayEntry &&
        (holidayEntry.type === "regular" || holidayEntry.type === "special") &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        resolvedStatus = "no_work";
      }
    }
    const scheduleWithLunch = employee
      ? await getScheduleWithLunch(
          ctx,
          employee,
          args.date,
          args.organizationId,
        )
      : null;

    const scheduleIn = scheduleWithLunch?.scheduleIn ?? args.scheduleIn;
    const scheduleOut = scheduleWithLunch?.scheduleOut ?? args.scheduleOut;
    const lunchStart = scheduleWithLunch?.lunchStart;
    const lunchEnd = scheduleWithLunch?.lunchEnd;
    const lunchMinutes = scheduleWithLunch?.lunchMinutes ?? 0;

    const calculatedUndertime =
      args.undertime !== undefined
        ? args.undertime
        : resolvedStatus === "present" && args.actualIn && args.actualOut
          ? calculateUndertime(
              scheduleIn,
              scheduleOut,
              args.actualIn,
              args.actualOut,
            )
          : 0;

    const calculatedLate =
      args.late !== undefined
        ? args.late
        : resolvedStatus === "present" && args.actualIn
          ? calculateLate(scheduleIn, args.actualIn, lunchStart)
          : 0;

    const now = Date.now();
    let isHoliday = args.isHoliday;
    let holidayType = args.holidayType;
    if (isHoliday === undefined && holidayType === undefined) {
      const holidayEntry = getMatchingHolidayEntryForDate(args.date, holidays);
      if (
        holidayEntry &&
        employee &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        isHoliday = true;
        holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
    }
    const insertPayload: Record<string, unknown> = {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      date: args.date,
      scheduleIn,
      scheduleOut,
      actualIn: args.actualIn,
      actualOut: args.actualOut,
      overtime: args.overtime,
      late: calculatedLate > 0 ? calculatedLate : 0,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
      isHoliday,
      holidayType,
      remarks: args.remarks,
      status: resolvedStatus,
      createdAt: now,
      updatedAt: now,
    };
    if (lunchStart != null) insertPayload.lunchStart = lunchStart;
    if (lunchEnd != null) insertPayload.lunchEnd = lunchEnd;

    const attendanceId = await ctx.db.insert(
      "attendance",
      insertPayload as any,
    );

    return attendanceId;
  },
});

// Update attendance
export const updateAttendance = mutation({
  args: {
    attendanceId: v.id("attendance"),
    scheduleIn: v.optional(v.string()),
    scheduleOut: v.optional(v.string()),
    actualIn: v.optional(v.string()),
    actualOut: v.optional(v.string()),
    overtime: v.optional(v.number()),
    late: v.optional(v.union(v.number(), v.null())), // Manual override (minutes), or null to recalculate
    undertime: v.optional(v.union(v.number(), v.null())), // Manual override (hours), or null to recalculate
    lateManualOverride: v.optional(v.boolean()), // true = use stored late (e.g. 0) instead of calculating from time in
    undertimeManualOverride: v.optional(v.boolean()), // true = use stored undertime (e.g. 0) instead of calculating from time out
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(
        v.literal("regular"),
        v.literal("special"),
        v.literal("special_working"),
      ),
    ),
    remarks: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("present"),
        v.literal("absent"),
        v.literal("half-day"),
        v.literal("leave"),
        v.literal("leave_with_pay"),
        v.literal("leave_without_pay"),
        v.literal("no_work"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const attendance = await ctx.db.get(args.attendanceId);
    if (!attendance) throw new Error("Attendance not found");

    const userRecord = await checkAuth(ctx, attendance.organizationId, "hr");

    const employee = await ctx.db.get(attendance.employeeId);
    const scheduleWithLunch = employee
      ? await getScheduleWithLunch(
          ctx,
          employee,
          attendance.date,
          attendance.organizationId,
        )
      : null;

    // Effective schedule for late/undertime: explicit args (form), then snapshot on
    // the row, then current employee schedule for that date. Do not prefer live schedule
    // over the stored row (historical shift per day).
    const effectiveScheduleIn =
      args.scheduleIn !== undefined
        ? args.scheduleIn
        : attendance.scheduleIn ?? scheduleWithLunch?.scheduleIn ?? null;
    const effectiveScheduleOut =
      args.scheduleOut !== undefined
        ? args.scheduleOut
        : attendance.scheduleOut ?? scheduleWithLunch?.scheduleOut ?? null;

    const updates: any = { updatedAt: Date.now() };
    if (args.scheduleIn !== undefined) updates.scheduleIn = args.scheduleIn;
    if (args.scheduleOut !== undefined) updates.scheduleOut = args.scheduleOut;
    if (args.actualIn !== undefined) updates.actualIn = args.actualIn;
    if (args.actualOut !== undefined) updates.actualOut = args.actualOut;
    if (args.overtime !== undefined) updates.overtime = args.overtime;
    if (args.isHoliday !== undefined) updates.isHoliday = args.isHoliday;
    if (args.holidayType !== undefined) updates.holidayType = args.holidayType;
    if (args.remarks !== undefined) updates.remarks = args.remarks;

    const scheduleInChangedFromForm =
      args.scheduleIn !== undefined && args.scheduleIn !== attendance.scheduleIn;
    const scheduleOutChangedFromForm =
      args.scheduleOut !== undefined &&
      args.scheduleOut !== attendance.scheduleOut;
    if (scheduleInChangedFromForm || scheduleOutChangedFromForm) {
      if (scheduleWithLunch?.lunchStart != null) {
        updates.lunchStart = scheduleWithLunch.lunchStart;
      }
      if (scheduleWithLunch?.lunchEnd != null) {
        updates.lunchEnd = scheduleWithLunch.lunchEnd;
      }
    }
    // Lunch for late/undertime: when the row's shift times are edited, line up with the
    // org template; otherwise use what is already on the record (per-day snapshot).
    const scheduleWasEditedInForm =
      scheduleInChangedFromForm || scheduleOutChangedFromForm;
    const lunchStartForCalc = scheduleWasEditedInForm
      ? (scheduleWithLunch?.lunchStart ?? attendance.lunchStart)
      : (attendance.lunchStart ?? scheduleWithLunch?.lunchStart);
    const lunchEndForCalc = scheduleWasEditedInForm
      ? (scheduleWithLunch?.lunchEnd ?? attendance.lunchEnd)
      : (attendance.lunchEnd ?? scheduleWithLunch?.lunchEnd);

    const currentScheduleIn = args.scheduleIn ?? attendance.scheduleIn;
    const currentScheduleOut = args.scheduleOut ?? attendance.scheduleOut;
    const currentActualIn = args.actualIn ?? attendance.actualIn;
    const currentActualOut = args.actualOut ?? attendance.actualOut;
    let currentStatus = args.status ?? attendance.status;

    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", attendance.organizationId),
      )
      .collect();

    if (args.status === "no_work" && employee) {
      if (
        !isNoWorkAllowedForEmployeeDate(attendance.date, holidays, employee)
      ) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
    }

    if (args.status === undefined) {
      if (
        !currentActualIn &&
        !currentActualOut &&
        employee &&
        !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(attendance.status as string)
      ) {
        const holidayEntry = getMatchingHolidayEntryForDate(attendance.date, holidays);
        if (
          holidayEntry &&
          (holidayEntry.type === "regular" || holidayEntry.type === "special") &&
          holidayAppliesToEmployee(holidayEntry, employee)
        ) {
          currentStatus = "no_work";
          updates.status = "no_work";
        }
      }
    }
    if (args.status !== undefined) updates.status = args.status;

    // Auto-set isHoliday and holidayType only when holiday applies to this employee's province
    if (args.isHoliday === undefined && args.holidayType === undefined) {
      const holidayEntry = getMatchingHolidayEntryForDate(attendance.date, holidays);
      if (
        holidayEntry &&
        employee &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        updates.isHoliday = true;
        updates.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
    }

    if (args.undertimeManualOverride === true) {
      updates.undertime = args.undertime ?? 0;
      updates.undertimeManualOverride = true;
    } else if (args.undertime === null) {
      const calculatedUndertime =
        currentStatus === "present" && currentActualIn && currentActualOut
          ? calculateUndertime(
              effectiveScheduleIn,
              effectiveScheduleOut,
              currentActualIn,
              currentActualOut,
              lunchStartForCalc,
              lunchEndForCalc,
            )
          : 0;
      updates.undertime =
        calculatedUndertime > 0 ? calculatedUndertime : 0;
      updates.undertimeManualOverride = false;
    } else if (args.undertime !== undefined && args.undertime !== null) {
      updates.undertime = args.undertime;
      updates.undertimeManualOverride = true;
    }

    if (args.lateManualOverride === true) {
      updates.late = args.late ?? 0;
      updates.lateManualOverride = true;
    } else if (args.late === null) {
      const calculatedLate =
        currentStatus === "present" && currentActualIn
          ? calculateLate(effectiveScheduleIn, currentActualIn, lunchStartForCalc)
          : 0;
      updates.late = calculatedLate > 0 ? calculatedLate : 0;
      updates.lateManualOverride = false;
    } else if (args.late !== undefined && args.late !== null) {
      updates.late = args.late;
      updates.lateManualOverride = true;
    }

    await ctx.db.patch(args.attendanceId, updates);
    return { success: true };
  },
});

// Delete attendance record for a specific day
export const deleteAttendance = mutation({
  args: {
    attendanceId: v.id("attendance"),
  },
  handler: async (ctx, args) => {
    const attendance = await ctx.db.get(args.attendanceId);
    if (!attendance) throw new Error("Attendance record not found");

    await checkAuth(ctx, attendance.organizationId, "hr");

    await ctx.db.delete(args.attendanceId);
    return { success: true };
  },
});

const SELF_PUNCH_IN_BLOCKED = new Set([
  "leave",
  "leave_with_pay",
  "leave_without_pay",
]);

/** Time in / time out for the signed-in user only (no HR role). */
export const punchSelfAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    action: v.union(v.literal("in"), v.literal("out")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    const employeeId = await resolveSelfEmployeeIdForOrg(
      ctx,
      userRecord,
      args.organizationId,
    );
    if (!employeeId) {
      throw new Error(
        "No employee profile is linked to your account for this organization.",
      );
    }

    const employee = await ctx.db.get(employeeId);
    if (!employee) throw new Error("Employee not found");

    const dateTs = getManilaTodayDateUtcMs();
    const timeStr = getManilaNowHHmm();

    const existing = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee_date", (q: any) =>
        q.eq("employeeId", employeeId).eq("date", dateTs),
      )
      .first();

    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    if (args.action === "in") {
      if (existing?.actualIn && existing?.actualOut) {
        throw new Error(
          "You have already completed time in and time out for today.",
        );
      }
      if (existing?.actualIn && !existing?.actualOut) {
        throw new Error("You have already timed in. Please time out.");
      }
      if (
        existing &&
        !existing.actualIn &&
        SELF_PUNCH_IN_BLOCKED.has(existing.status as string)
      ) {
        throw new Error(
          "This day is already marked on your schedule. Contact HR to change it.",
        );
      }

      const scheduleWithLunch = await getScheduleWithLunch(
        ctx,
        employee as any,
        dateTs,
        args.organizationId,
      );
      const scheduleIn = scheduleWithLunch?.scheduleIn ?? "09:00";
      const scheduleOut = scheduleWithLunch?.scheduleOut ?? "18:00";
      const lunchStart = scheduleWithLunch?.lunchStart;
      const lunchEnd = scheduleWithLunch?.lunchEnd;
      const now = Date.now();

      if (!existing) {
        const holidayEntry = getMatchingHolidayEntryForDate(
          dateTs,
          holidays,
        );
        let isHoliday: boolean | undefined;
        let holidayType: "regular" | "special" | "special_working" | undefined;
        if (
          holidayEntry &&
          holidayAppliesToEmployee(holidayEntry, employee)
        ) {
          isHoliday = true;
          holidayType = holidayEntry.type as
            | "regular"
            | "special"
            | "special_working";
        }

        const calculatedLate = calculateLate(scheduleIn, timeStr, lunchStart);
        const insertPayload: Record<string, unknown> = {
          organizationId: args.organizationId,
          employeeId,
          date: dateTs,
          scheduleIn,
          scheduleOut,
          actualIn: timeStr,
          late: calculatedLate > 0 ? calculatedLate : 0,
          undertime: 0,
          status: "present" as const,
          createdAt: now,
          updatedAt: now,
        };
        if (isHoliday === true) insertPayload.isHoliday = true;
        if (holidayType != null) insertPayload.holidayType = holidayType;
        if (lunchStart != null) insertPayload.lunchStart = lunchStart;
        if (lunchEnd != null) insertPayload.lunchEnd = lunchEnd;

        await ctx.db.insert("attendance", insertPayload as any);
        return { success: true, action: "in" as const };
      }

      // Existing row, no time in yet: fill time in
      const lateRecalc = calculateLate(scheduleIn, timeStr, lunchStart);
      const updates: any = {
        actualIn: timeStr,
        status: "present",
        late: lateRecalc > 0 ? lateRecalc : 0,
        lateManualOverride: false,
        updatedAt: now,
      };
      if (scheduleWithLunch?.scheduleIn != null) {
        updates.scheduleIn = scheduleWithLunch.scheduleIn;
      }
      if (scheduleWithLunch?.scheduleOut != null) {
        updates.scheduleOut = scheduleWithLunch.scheduleOut;
      }
      if (scheduleWithLunch?.lunchStart != null) {
        updates.lunchStart = scheduleWithLunch.lunchStart;
        updates.lunchEnd = scheduleWithLunch.lunchEnd;
      }
      await ctx.db.patch(existing._id, updates);
      return { success: true, action: "in" as const };
    }

    // action === "out"
    if (!existing) {
      throw new Error("Time in first before time out.");
    }
    if (!existing.actualIn) {
      throw new Error("Time in first before time out.");
    }
    if (existing.actualOut) {
      throw new Error("You have already timed out for today.");
    }

    const scheduleWithLunch = await getScheduleWithLunch(
      ctx,
      employee as any,
      dateTs,
      args.organizationId,
    );
    const resolvedScheduleInVal =
      scheduleWithLunch?.scheduleIn ?? existing.scheduleIn;
    const resolvedScheduleOutVal =
      scheduleWithLunch?.scheduleOut ?? existing.scheduleOut;
    const lunchStart =
      scheduleWithLunch?.lunchStart ?? existing.lunchStart;
    const lunchEnd = scheduleWithLunch?.lunchEnd ?? existing.lunchEnd;

    const currentStatus = existing.status;
    const calculatedUndertime =
      currentStatus === "present" || currentStatus === "half-day"
        ? calculateUndertime(
            resolvedScheduleInVal,
            resolvedScheduleOutVal,
            existing.actualIn,
            timeStr,
            lunchStart,
            lunchEnd,
          )
        : 0;
    const calculatedLate =
      currentStatus === "present" && existing.actualIn
        ? calculateLate(
            resolvedScheduleInVal,
            existing.actualIn,
            lunchStart,
          )
        : 0;

    await ctx.db.patch(existing._id, {
      actualOut: timeStr,
      late: calculatedLate > 0 ? calculatedLate : 0,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
      lateManualOverride: false,
      undertimeManualOverride: false,
      updatedAt: Date.now(),
    });
    return { success: true, action: "out" as const };
  },
});

// Bulk create attendance
export const bulkCreateAttendance = mutation({
  args: {
    entries: v.array(
      v.object({
        organizationId: v.id("organizations"),
        employeeId: v.id("employees"),
        date: v.number(),
        scheduleIn: v.string(),
        scheduleOut: v.string(),
        actualIn: v.optional(v.string()),
        actualOut: v.optional(v.string()),
        overtime: v.optional(v.number()),
        late: v.optional(v.number()), // Manual override for late (minutes)
        undertime: v.optional(v.number()), // Manual override for undertime (hours)
        isHoliday: v.optional(v.boolean()),
        holidayType: v.optional(
          v.union(
            v.literal("regular"),
            v.literal("special"),
            v.literal("special_working"),
          ),
        ),
        remarks: v.optional(v.string()),
        status: v.union(
          v.literal("present"),
          v.literal("absent"),
          v.literal("half-day"),
          v.literal("leave"),
          v.literal("leave_with_pay"),
          v.literal("leave_without_pay"),
          v.literal("no_work"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results = [];

    // Check auth for first entry's organization (all should be same org)
    const organizationId =
      args.entries.length > 0 ? args.entries[0].organizationId : null;
    if (organizationId) {
      await checkAuth(ctx, organizationId, "hr");
    }
    const holidays = organizationId
      ? await (ctx.db.query("holidays") as any)
          .withIndex("by_organization", (q: any) =>
            q.eq("organizationId", organizationId),
          )
          .collect()
      : [];

    for (const entry of args.entries) {
      const existing = await (ctx.db.query("attendance") as any)
        .withIndex("by_employee_date", (q: any) =>
          q.eq("employeeId", entry.employeeId).eq("date", entry.date),
        )
        .first();

      const employee = await ctx.db.get(entry.employeeId);
      const currentActualIn = entry.actualIn ?? existing?.actualIn;
      const currentActualOut = entry.actualOut ?? existing?.actualOut;
      const canUseNoWork = employee
        ? isNoWorkAllowedForEmployeeDate(entry.date, holidays, employee)
        : false;
      const shouldAutoHolidayNoWork =
        !currentActualIn &&
        !currentActualOut &&
        canUseNoWork &&
        !STATUSES_PRESERVED_ON_HOLIDAY_NO_TIME.has(entry.status);
      const resolvedStatus = shouldAutoHolidayNoWork
        ? "no_work"
        : entry.status;
      if (resolvedStatus === "no_work" && !canUseNoWork) {
        throw new Error(
          "No work status is only allowed on holidays that apply to this employee",
        );
      }
      const scheduleWithLunch = employee
        ? await getScheduleWithLunch(
            ctx,
            employee,
            entry.date,
            entry.organizationId,
          )
        : null;
      const scheduleIn = scheduleWithLunch?.scheduleIn ?? entry.scheduleIn;
      const scheduleOut = scheduleWithLunch?.scheduleOut ?? entry.scheduleOut;
      const lunchStart = scheduleWithLunch?.lunchStart;
      const lunchEnd = scheduleWithLunch?.lunchEnd;
      const lunchMinutes = scheduleWithLunch?.lunchMinutes ?? 0;

      if (existing) {
        const updates: any = { updatedAt: now };
        if (entry.actualIn !== undefined) updates.actualIn = entry.actualIn;
        if (entry.actualOut !== undefined) updates.actualOut = entry.actualOut;
        if (entry.overtime !== undefined) updates.overtime = entry.overtime;
        if (entry.isHoliday !== undefined) updates.isHoliday = entry.isHoliday;
        if (entry.holidayType !== undefined)
          updates.holidayType = entry.holidayType;
        if (entry.isHoliday === undefined && entry.holidayType === undefined) {
          const holidayEntry = getMatchingHolidayEntryForDate(entry.date, holidays);
          if (
            holidayEntry &&
            employee &&
            holidayAppliesToEmployee(holidayEntry, employee)
          ) {
            updates.isHoliday = true;
            updates.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
          }
        }
        if (entry.remarks !== undefined) updates.remarks = entry.remarks;
        updates.status = resolvedStatus;
        if (scheduleWithLunch) {
          updates.scheduleIn = scheduleIn;
          updates.scheduleOut = scheduleOut;
          updates.lunchStart = lunchStart;
          updates.lunchEnd = lunchEnd;
        }

        const currentActualIn = entry.actualIn ?? existing.actualIn;
        const currentActualOut = entry.actualOut ?? existing.actualOut;
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : resolvedStatus === "present" &&
                currentActualIn &&
                currentActualOut
              ? calculateUndertime(
                  scheduleIn,
                  scheduleOut,
                  currentActualIn,
                  currentActualOut,
                  lunchStart,
                  lunchEnd,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : resolvedStatus === "present" && currentActualIn
              ? calculateLate(scheduleIn, currentActualIn, lunchStart)
              : 0;

        updates.undertime =
          calculatedUndertime > 0 ? calculatedUndertime : 0;
        updates.late = calculatedLate > 0 ? calculatedLate : 0;

        await ctx.db.patch(existing._id, updates);
        results.push({ id: existing._id, action: "updated" });
      } else {
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : resolvedStatus === "present" && entry.actualIn && entry.actualOut
              ? calculateUndertime(
                  scheduleIn,
                  scheduleOut,
                  entry.actualIn,
                  entry.actualOut,
                  lunchStart,
                  lunchEnd,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : resolvedStatus === "present" && entry.actualIn
              ? calculateLate(scheduleIn, entry.actualIn, lunchStart)
              : 0;

        let isHoliday = entry.isHoliday;
        let holidayType = entry.holidayType;
        if (isHoliday === undefined && holidayType === undefined) {
          const holidayEntry = getMatchingHolidayEntryForDate(entry.date, holidays);
          if (
            holidayEntry &&
            employee &&
            holidayAppliesToEmployee(holidayEntry, employee)
          ) {
            isHoliday = true;
            holidayType = holidayEntry.type as "regular" | "special" | "special_working";
          }
        }
        const insertPayload: Record<string, unknown> = {
          ...entry,
          scheduleIn,
          scheduleOut,
          status: resolvedStatus,
          late: calculatedLate > 0 ? calculatedLate : 0,
          undertime: calculatedUndertime > 0 ? calculatedUndertime : 0,
          isHoliday,
          holidayType,
          createdAt: now,
          updatedAt: now,
        };
        if (lunchStart != null) insertPayload.lunchStart = lunchStart;
        if (lunchEnd != null) insertPayload.lunchEnd = lunchEnd;
        const attendanceId = await ctx.db.insert(
          "attendance",
          insertPayload as any,
        );
        results.push({ id: attendanceId, action: "created" });
      }
    }

    return results;
  },
});

// Recalculate late/undertime for an employee in a date range. Snapshotted
// scheduleIn/scheduleOut on each row are kept; we only backfill when missing.
export const recalculateEmployeeAttendance = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // HR/admin/owner only
    await checkAuth(ctx, args.organizationId, "hr");

    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");
    if (employee.organizationId !== args.organizationId) {
      throw new Error("Employee does not belong to this organization");
    }

    let records = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .collect();

    if (records.length === 0) {
      return { updated: 0 };
    }

    // Determine effective date range if not provided.
    // Default to today's Manila day so schedule edits don't rewrite historical attendance.
    const minDate = args.startDate ?? getManilaTodayDateUtcMs();
    const maxDate =
      args.endDate ??
      records.reduce(
        (max: number, r: any) => (r.date > max ? r.date : max),
        records[0].date,
      );

    records = records.filter(
      (r: any) => r.date >= minDate && r.date <= maxDate,
    );

    if (records.length === 0) {
      return { updated: 0 };
    }

    const holidays = await (ctx.db.query("holidays") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const now = Date.now();
    let updatedCount = 0;

    for (const record of records) {
      const scheduleWithLunch = await getScheduleWithLunch(
        ctx,
        employee,
        record.date,
        args.organizationId,
      );

      // Prefer shift snapshot on the row; only backfill from current employee schedule
      // when the record never had times (legacy). Never overwrite per-day stored shift
      // with the employee's latest schedule.
      const scheduleIn = record.scheduleIn ?? scheduleWithLunch?.scheduleIn;
      const scheduleOut = record.scheduleOut ?? scheduleWithLunch?.scheduleOut;
      const lunchStart = record.lunchStart ?? scheduleWithLunch?.lunchStart;
      const lunchEnd = record.lunchEnd ?? scheduleWithLunch?.lunchEnd;

      if (!scheduleIn || !scheduleOut) continue;

      const actualIn = record.actualIn as string | undefined;
      const actualOut = record.actualOut as string | undefined;
      const status = record.status as
        | "present"
        | "absent"
        | "half-day"
        | "leave"
        | "leave_with_pay"
        | "leave_without_pay"
        | "no_work";

      let newUndertime: number | undefined;
      let newLate: number | undefined;

      if (status === "present" && actualIn && actualOut) {
        const undertime = calculateUndertime(
          scheduleIn,
          scheduleOut,
          actualIn,
          actualOut,
        );
        newUndertime = undertime > 0 ? undertime : 0;

        const late = calculateLate(scheduleIn, actualIn, lunchStart);
        newLate = late > 0 ? late : 0;
      } else {
        newUndertime = 0;
        newLate = 0;
      }

      const patchPayload: Record<string, unknown> = {
        undertime: newUndertime,
        late: newLate,
        updatedAt: now,
      };
      if (record.scheduleIn == null && scheduleIn != null) {
        patchPayload.scheduleIn = scheduleIn;
      }
      if (record.scheduleOut == null && scheduleOut != null) {
        patchPayload.scheduleOut = scheduleOut;
      }
      const holidayEntry = getMatchingHolidayEntryForDate(record.date, holidays);
      if (
        holidayEntry &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        patchPayload.isHoliday = true;
        patchPayload.holidayType = holidayEntry.type as "regular" | "special" | "special_working";
      }
      if (record.lunchStart == null && scheduleWithLunch?.lunchStart != null) {
        patchPayload.lunchStart = scheduleWithLunch.lunchStart;
      }
      if (record.lunchEnd == null && scheduleWithLunch?.lunchEnd != null) {
        patchPayload.lunchEnd = scheduleWithLunch.lunchEnd;
      }
      await ctx.db.patch(record._id, patchPayload as any);
      updatedCount++;
    }

    return { updated: updatedCount };
  },
});
