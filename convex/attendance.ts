import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
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

  // Allow admin to access everything
  // For read operations, allow accounting role
  // For write operations (requiredRole specified), only allow specified role or admin
  if (requiredRole) {
    if (userRole !== requiredRole && userRole !== "admin") {
      throw new Error("Not authorized");
    }
  } else {
    // No required role means read access - allow accounting
    if (
      userRole !== "admin" &&
      userRole !== "hr" &&
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
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by date range
    attendance = attendance.filter(
      (a: any) => a.date >= args.startDate && a.date <= args.endDate
    );

    // Filter by employee if specified
    if (args.employeeId) {
      attendance = attendance.filter(
        (a: any) => a.employeeId === args.employeeId
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
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(v.literal("regular"), v.literal("special"))
    ),
    remarks: v.optional(v.string()),
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half-day"),
      v.literal("leave")
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    // Check if attendance already exists for this date
    const existing = await (ctx.db.query("attendance") as any)
      .withIndex("by_employee_date", (q: any) =>
        q.eq("employeeId", args.employeeId).eq("date", args.date)
      )
      .first();

    if (existing) {
      throw new Error("Attendance already exists for this date");
    }

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
    isHoliday: v.optional(v.boolean()),
    holidayType: v.optional(
      v.union(v.literal("regular"), v.literal("special"))
    ),
    remarks: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("present"),
        v.literal("absent"),
        v.literal("half-day"),
        v.literal("leave")
      )
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

    await ctx.db.patch(args.attendanceId, updates);
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
        isHoliday: v.optional(v.boolean()),
        holidayType: v.optional(
          v.union(v.literal("regular"), v.literal("special"))
        ),
        remarks: v.optional(v.string()),
        status: v.union(
          v.literal("present"),
          v.literal("absent"),
          v.literal("half-day"),
          v.literal("leave")
        ),
      })
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
          q.eq("employeeId", entry.employeeId).eq("date", entry.date)
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

        await ctx.db.patch(existing._id, updates);
        results.push({ id: existing._id, action: "updated" });
      } else {
        // Create new
        const attendanceId = await ctx.db.insert("attendance", {
          ...entry,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ id: attendanceId, action: "created" });
      }
    }

    return results;
  },
});
