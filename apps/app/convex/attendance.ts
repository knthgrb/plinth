import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { holidayAppliesToEmployee } from "@/lib/payroll-calculations";
import { getScheduleWithLunch } from "./shifts";

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// Late = late arrival only. If lunchStart provided and actualIn >= lunchStart, return 0 (time in after lunch = undertime, not late).
function calculateLate(
  scheduleIn: string,
  actualIn: string | undefined,
  lunchStart?: string,
): number {
  if (!actualIn) return 0;
  const scheduleMinutes = timeToMins(scheduleIn);
  const actualMinutes = timeToMins(actualIn);
  if (lunchStart != null && actualMinutes >= timeToMins(lunchStart)) return 0;
  const lateMinutes = actualMinutes - scheduleMinutes;
  return lateMinutes > 0 ? lateMinutes : 0;
}

// Undertime = early departure only (when time out is earlier than scheduled time out).
// Late arrival is handled separately and is NOT counted as undertime.
function calculateUndertime(
  _scheduleIn: string,
  scheduleOut: string,
  _actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  if (!actualOut) return 0;
  const scheduleOutM = timeToMins(scheduleOut);
  const actualOutM = timeToMins(actualOut);
  const undertimeMinutes = Math.max(0, scheduleOutM - actualOutM);
  return undertimeMinutes / 60;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
function getManilaDateParts(ts: number) {
  const d = new Date(ts + MANILA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
function isDateRegularOrSpecialHoliday(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
  }[],
): boolean {
  return getHolidayForDate(dateTs, holidays) != null;
}

/** Returns matching holiday (regular/special) for a date, or null. Used to auto-set isHoliday/holidayType on attendance. */
function getHolidayForDate(
  dateTs: number,
  holidays: {
    date: number;
    offsetDate?: number;
    isRecurring?: boolean;
    year?: number;
    type: string;
  }[],
): { type: "regular" | "special" | "special_working" } | null {
  const entry = getMatchingHolidayEntryForDate(dateTs, holidays);
  return entry ? { type: entry.type as "regular" | "special" | "special_working" } : null;
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

// Helper to get the employee's scheduled in/out time for a specific date,
// taking into account defaultSchedule and any scheduleOverrides.
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

  const dateObj = new Date(date);

  // First check for an explicit override on this date
  if (
    employeeSchedule.scheduleOverrides &&
    Array.isArray(employeeSchedule.scheduleOverrides)
  ) {
    const override = employeeSchedule.scheduleOverrides.find(
      (o: any) => new Date(o.date).toDateString() === dateObj.toDateString(),
    );
    if (override && override.in && override.out) {
      return { scheduleIn: override.in, scheduleOut: override.out };
    }
  }

  // Fall back to defaultSchedule based on day of week
  const dayName = dayNames[dateObj.getDay()];
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

    // Check authorization
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
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
    if (
      !args.actualIn &&
      !args.actualOut &&
      employee
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
      late: calculatedLate > 0 ? calculatedLate : undefined,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : undefined,
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

    const resolvedScheduleIn =
      scheduleWithLunch?.scheduleIn ?? args.scheduleIn ?? attendance.scheduleIn;
    const resolvedScheduleOut =
      scheduleWithLunch?.scheduleOut ??
      args.scheduleOut ??
      attendance.scheduleOut;
    const lunchStart = scheduleWithLunch?.lunchStart ?? attendance.lunchStart;
    const lunchEnd = scheduleWithLunch?.lunchEnd ?? attendance.lunchEnd;
    const lunchMinutes = scheduleWithLunch?.lunchMinutes ?? 0;

    const updates: any = { updatedAt: Date.now() };
    if (args.scheduleIn !== undefined) updates.scheduleIn = args.scheduleIn;
    if (args.scheduleOut !== undefined) updates.scheduleOut = args.scheduleOut;
    if (args.actualIn !== undefined) updates.actualIn = args.actualIn;
    if (args.actualOut !== undefined) updates.actualOut = args.actualOut;
    if (args.overtime !== undefined) updates.overtime = args.overtime;
    if (args.isHoliday !== undefined) updates.isHoliday = args.isHoliday;
    if (args.holidayType !== undefined) updates.holidayType = args.holidayType;
    if (args.remarks !== undefined) updates.remarks = args.remarks;
    if (scheduleWithLunch?.lunchStart != null)
      updates.lunchStart = scheduleWithLunch.lunchStart;
    if (scheduleWithLunch?.lunchEnd != null)
      updates.lunchEnd = scheduleWithLunch.lunchEnd;

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

    if (args.status === undefined) {
      if (!currentActualIn && !currentActualOut && employee) {
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
        updates.holidayType = holidayEntry.type;
      }
    }

    if (args.undertimeManualOverride === true) {
      updates.undertime = args.undertime ?? 0;
      updates.undertimeManualOverride = true;
    } else if (args.undertime === null) {
      const calculatedUndertime =
        currentStatus === "present" && currentActualIn && currentActualOut
          ? calculateUndertime(
              resolvedScheduleIn,
              resolvedScheduleOut,
              currentActualIn,
              currentActualOut,
            )
          : 0;
      updates.undertime =
        calculatedUndertime > 0 ? calculatedUndertime : undefined;
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
          ? calculateLate(resolvedScheduleIn, currentActualIn, lunchStart)
          : 0;
      updates.late = calculatedLate > 0 ? calculatedLate : undefined;
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

      const currentActualIn = entry.actualIn ?? existing?.actualIn;
      const currentActualOut = entry.actualOut ?? existing?.actualOut;
      const resolvedStatus =
        !currentActualIn &&
        !currentActualOut &&
        isDateRegularOrSpecialHoliday(entry.date, holidays)
          ? "no_work"
          : entry.status;

      const employee = await ctx.db.get(entry.employeeId);
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
            updates.holidayType = holidayEntry.type;
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
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : resolvedStatus === "present" && currentActualIn
              ? calculateLate(scheduleIn, currentActualIn, lunchStart)
              : 0;

        updates.undertime =
          calculatedUndertime > 0 ? calculatedUndertime : undefined;
        updates.late = calculatedLate > 0 ? calculatedLate : undefined;

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
            holidayType = holidayEntry.type;
          }
        }
        const insertPayload: Record<string, unknown> = {
          ...entry,
          scheduleIn,
          scheduleOut,
          status: resolvedStatus,
          late: calculatedLate > 0 ? calculatedLate : undefined,
          undertime: calculatedUndertime > 0 ? calculatedUndertime : undefined,
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

// Recalculate attendance for an employee after schedule changes.
// This recomputes scheduleIn/scheduleOut and late/undertime for all
// matching attendance records so summaries stay in sync.
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

    // Determine effective date range if not provided
    const minDate =
      args.startDate ??
      records.reduce(
        (min: number, r: any) => (r.date < min ? r.date : min),
        records[0].date,
      );
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

      const scheduleIn = scheduleWithLunch?.scheduleIn ?? record.scheduleIn;
      const scheduleOut = scheduleWithLunch?.scheduleOut ?? record.scheduleOut;
      const lunchStart = scheduleWithLunch?.lunchStart ?? record.lunchStart;
      const lunchEnd = scheduleWithLunch?.lunchEnd ?? record.lunchEnd;
      const lunchMinutes = scheduleWithLunch?.lunchMinutes ?? 0;

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
        newUndertime = undertime > 0 ? undertime : undefined;

        const late = calculateLate(scheduleIn, actualIn, lunchStart);
        newLate = late > 0 ? late : undefined;
      } else {
        newUndertime = undefined;
        newLate = undefined;
      }

      const patchPayload: Record<string, unknown> = {
        scheduleIn,
        scheduleOut,
        undertime: newUndertime,
        late: newLate,
        updatedAt: now,
      };
      const holidayEntry = getMatchingHolidayEntryForDate(record.date, holidays);
      if (
        holidayEntry &&
        holidayAppliesToEmployee(holidayEntry, employee)
      ) {
        patchPayload.isHoliday = true;
        patchPayload.holidayType = holidayEntry.type;
      }
      if (scheduleWithLunch?.lunchStart != null)
        patchPayload.lunchStart = scheduleWithLunch.lunchStart;
      if (scheduleWithLunch?.lunchEnd != null)
        patchPayload.lunchEnd = scheduleWithLunch.lunchEnd;
      await ctx.db.patch(record._id, patchPayload as any);
      updatedCount++;
    }

    return { updated: updatedCount };
  },
});
