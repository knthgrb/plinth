import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper functions for calculating late and undertime
function calculateLate(
  scheduleIn: string,
  actualIn: string | undefined,
  hasUndertime: boolean = false,
): number {
  if (!actualIn || hasUndertime) return 0;

  const [scheduleHour, scheduleMin] = scheduleIn.split(":").map(Number);
  const [actualHour, actualMin] = actualIn.split(":").map(Number);

  const scheduleMinutes = scheduleHour * 60 + scheduleMin;
  const actualMinutes = actualHour * 60 + actualMin;

  const lateMinutes = actualMinutes - scheduleMinutes;
  return lateMinutes > 0 ? lateMinutes : 0;
}

function calculateUndertime(
  scheduleIn: string,
  scheduleOut: string,
  actualIn: string | undefined,
  actualOut: string | undefined,
): number {
  if (!actualIn || !actualOut) return 0;

  const [scheduleInHour, scheduleInMin] = scheduleIn.split(":").map(Number);
  const [scheduleOutHour, scheduleOutMin] = scheduleOut.split(":").map(Number);
  const [actualInHour, actualInMin] = actualIn.split(":").map(Number);
  const [actualOutHour, actualOutMin] = actualOut.split(":").map(Number);

  // Calculate scheduled work hours (assuming 1 hour lunch break)
  const scheduleInMinutes = scheduleInHour * 60 + scheduleInMin;
  const scheduleOutMinutes = scheduleOutHour * 60 + scheduleOutMin;
  const scheduledWorkMinutes = scheduleOutMinutes - scheduleInMinutes - 60; // Subtract 1 hour lunch

  // Calculate actual work hours
  const actualInMinutes = actualInHour * 60 + actualInMin;
  const actualOutMinutes = actualOutHour * 60 + actualOutMin;
  const actualWorkMinutes = actualOutMinutes - actualInMinutes - 60; // Subtract 1 hour lunch

  // Calculate undertime
  const undertimeMinutes = scheduledWorkMinutes - actualWorkMinutes;
  const undertimeHours = undertimeMinutes / 60;

  return undertimeHours > 0 ? undertimeHours : 0;
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

    // Calculate undertime automatically if not manually provided
    const calculatedUndertime =
      args.undertime !== undefined
        ? args.undertime
        : args.status === "present" && args.actualIn && args.actualOut
          ? calculateUndertime(
              args.scheduleIn,
              args.scheduleOut,
              args.actualIn,
              args.actualOut,
            )
          : 0;

    // Calculate late automatically if not manually provided
    // If employee has undertime, don't count as late (they're taking undertime, not late)
    const calculatedLate =
      args.late !== undefined
        ? args.late
        : args.status === "present" &&
            args.actualIn &&
            calculatedUndertime === 0
          ? calculateLate(args.scheduleIn, args.actualIn, false)
          : 0;

    const now = Date.now();
    const attendanceId = await ctx.db.insert("attendance", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      date: args.date,
      scheduleIn: args.scheduleIn,
      scheduleOut: args.scheduleOut,
      actualIn: args.actualIn,
      actualOut: args.actualOut,
      overtime: args.overtime,
      late: calculatedLate > 0 ? calculatedLate : undefined,
      undertime: calculatedUndertime > 0 ? calculatedUndertime : undefined,
      isHoliday: args.isHoliday,
      holidayType: args.holidayType,
      remarks: args.remarks,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });

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
      ),
    ),
  },
  handler: async (ctx, args) => {
    const attendance = await ctx.db.get(args.attendanceId);
    if (!attendance) throw new Error("Attendance not found");

    const userRecord = await checkAuth(ctx, attendance.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
    if (args.scheduleIn !== undefined) updates.scheduleIn = args.scheduleIn;
    if (args.scheduleOut !== undefined) updates.scheduleOut = args.scheduleOut;
    if (args.actualIn !== undefined) updates.actualIn = args.actualIn;
    if (args.actualOut !== undefined) updates.actualOut = args.actualOut;
    if (args.overtime !== undefined) updates.overtime = args.overtime;
    if (args.isHoliday !== undefined) updates.isHoliday = args.isHoliday;
    if (args.holidayType !== undefined) updates.holidayType = args.holidayType;
    if (args.remarks !== undefined) updates.remarks = args.remarks;
    if (args.status !== undefined) updates.status = args.status;

    // Get current values for calculation
    const currentScheduleIn = args.scheduleIn ?? attendance.scheduleIn;
    const currentScheduleOut = args.scheduleOut ?? attendance.scheduleOut;
    const currentActualIn = args.actualIn ?? attendance.actualIn;
    const currentActualOut = args.actualOut ?? attendance.actualOut;
    const currentStatus = args.status ?? attendance.status;

    // Calculate undertime if not manually provided and status is present
    if (args.undertime === null) {
      // null means recalculate
      const calculatedUndertime =
        currentStatus === "present" && currentActualIn && currentActualOut
          ? calculateUndertime(
              currentScheduleIn,
              currentScheduleOut,
              currentActualIn,
              currentActualOut,
            )
          : 0;
      updates.undertime =
        calculatedUndertime > 0 ? calculatedUndertime : undefined;
    } else if (args.undertime !== undefined) {
      // Manual override provided - 0 means explicitly remove, > 0 means set value
      updates.undertime = args.undertime > 0 ? args.undertime : undefined;
    }

    // Calculate late if not manually provided and status is present
    if (args.late === null) {
      // null means recalculate
      const calculatedUndertime =
        updates.undertime ??
        (currentStatus === "present" && currentActualIn && currentActualOut
          ? calculateUndertime(
              currentScheduleIn,
              currentScheduleOut,
              currentActualIn,
              currentActualOut,
            )
          : 0);
      const calculatedLate =
        currentStatus === "present" &&
        currentActualIn &&
        calculatedUndertime === 0
          ? calculateLate(currentScheduleIn, currentActualIn, false)
          : 0;
      updates.late = calculatedLate > 0 ? calculatedLate : undefined;
    } else if (args.late !== undefined) {
      // Manual override provided - 0 means explicitly remove, > 0 means set value
      updates.late = args.late > 0 ? args.late : undefined;
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
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const results = [];

    // Check auth for first entry's organization (all should be same org)
    if (args.entries.length > 0) {
      await checkAuth(ctx, args.entries[0].organizationId, "hr");
    }

    for (const entry of args.entries) {
      // Check if attendance already exists
      const existing = await (ctx.db.query("attendance") as any)
        .withIndex("by_employee_date", (q: any) =>
          q.eq("employeeId", entry.employeeId).eq("date", entry.date),
        )
        .first();

      if (existing) {
        // Update existing
        const updates: any = { updatedAt: now };
        if (entry.actualIn !== undefined) updates.actualIn = entry.actualIn;
        if (entry.actualOut !== undefined) updates.actualOut = entry.actualOut;
        if (entry.overtime !== undefined) updates.overtime = entry.overtime;
        if (entry.isHoliday !== undefined) updates.isHoliday = entry.isHoliday;
        if (entry.holidayType !== undefined)
          updates.holidayType = entry.holidayType;
        if (entry.remarks !== undefined) updates.remarks = entry.remarks;
        updates.status = entry.status;

        // Calculate undertime and late if not manually provided
        const currentActualIn = entry.actualIn ?? existing.actualIn;
        const currentActualOut = entry.actualOut ?? existing.actualOut;
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : entry.status === "present" && currentActualIn && currentActualOut
              ? calculateUndertime(
                  entry.scheduleIn,
                  entry.scheduleOut,
                  currentActualIn,
                  currentActualOut,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : entry.status === "present" &&
                currentActualIn &&
                calculatedUndertime === 0
              ? calculateLate(
                  entry.scheduleIn,
                  currentActualIn,
                  calculatedUndertime > 0,
                )
              : 0;

        updates.undertime =
          calculatedUndertime > 0 ? calculatedUndertime : undefined;
        updates.late = calculatedLate > 0 ? calculatedLate : undefined;

        await ctx.db.patch(existing._id, updates);
        results.push({ id: existing._id, action: "updated" });
      } else {
        // Create new - calculate undertime and late
        const calculatedUndertime =
          entry.undertime !== undefined
            ? entry.undertime
            : entry.status === "present" && entry.actualIn && entry.actualOut
              ? calculateUndertime(
                  entry.scheduleIn,
                  entry.scheduleOut,
                  entry.actualIn,
                  entry.actualOut,
                )
              : 0;
        const calculatedLate =
          entry.late !== undefined
            ? entry.late
            : entry.status === "present" &&
                entry.actualIn &&
                calculatedUndertime === 0
              ? calculateLate(
                  entry.scheduleIn,
                  entry.actualIn,
                  calculatedUndertime > 0,
                )
              : 0;

        const attendanceId = await ctx.db.insert("attendance", {
          ...entry,
          late: calculatedLate > 0 ? calculatedLate : undefined,
          undertime: calculatedUndertime > 0 ? calculatedUndertime : undefined,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ id: attendanceId, action: "created" });
      }
    }

    return results;
  },
});
