import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

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

  if (requiredRole && userRole !== requiredRole && !isOwnerOrAdmin) {
    throw new Error("Not authorized");
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Get organization settings
export const getSettings = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      await checkAuth(ctx, args.organizationId);
    } catch (error: any) {
      if (
        error?.message?.includes("Not authenticated") ||
        error?.message?.includes("Unauthenticated")
      ) {
        return null;
      }
      throw error;
    }

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    // Migrate departments from old format (string[]) to new format (Department[]) in memory
    // Note: Queries are read-only, so we can't save the migration here
    // The migration will be saved when updateDepartments is called
    if (settings?.departments && settings.departments.length > 0) {
      const firstDept = settings.departments[0];
      if (typeof firstDept === "string") {
        // Old format - migrate to new format in memory only
        const PRESET_COLORS = [
          "#9CA3AF", // gray
          "#EF4444", // red
          "#F97316", // orange
          "#EAB308", // yellow
          "#22C55E", // green
          "#3B82F6", // blue
          "#A855F7", // purple
          "#EC4899", // pink
        ];
        const migratedDepartments = (settings.departments as string[]).map(
          (name, index) => ({
            name,
            color: PRESET_COLORS[index % PRESET_COLORS.length],
          }),
        );

        // Return migrated format (but don't save - that happens in updateDepartments)
        settings = {
          ...settings,
          departments: migratedDepartments,
        };
      }
    }

    // If no settings exist, return default settings structure (don't create in query)
    if (!settings) {
      return {
        _id: null,
        organizationId: args.organizationId,
        proratedLeave: true,
        annualSil: 8,
        grantLeaveUponRegularization: true,
        maxConvertibleLeaveDays: 5,
        leaveRequestFormTemplate: undefined,
        leaveTrackerRows: [],
        payrollSettings: {
          // Base configs only; compound rates (night diff on OT/holiday, holiday OT, etc.) are derived in payroll.
          nightDiffPercent: 1.1, // NIGHT_DIFF 110%
          regularHolidayRate: 2.0, // REGULAR_HOLIDAY 200%
          specialHolidayRate: 1.3, // SPECIAL_HOLIDAY 130%
          overtimeRegularRate: 1.25, // OT_REGULAR 125%
          overtimeRestDayRate: 1.3, // REST_DAY_PREMIUM 130%; first 8h at 130%, excess at 169%; holiday OT +30%
          dailyRateIncludesAllowance: true,
          dailyRateWorkingDaysPerYear: 261,
          taxDeductionFrequency: "twice_per_month",
          taxDeductOnPay: "first",
          holidayNoWorkNoPay: false,
        },
        attendanceSettings: {
          defaultLunchBreakMinutes: 60,
          defaultLunchStart: "12:00",
          defaultLunchEnd: "13:00",
        },
      };
    }

    if (settings.annualSil === undefined) {
      settings = {
        ...settings,
        annualSil: 8,
      };
    }
    if (settings.maxConvertibleLeaveDays === undefined) {
      settings = {
        ...settings,
        maxConvertibleLeaveDays: 5,
      };
    }

    return settings;
  },
});

// Update payroll settings
export const updatePayrollSettings = mutation({
  args: {
    organizationId: v.id("organizations"),
    payrollSettings: v.object({
      nightDiffPercent: v.optional(v.number()),
      nightDiffOnOtRate: v.optional(v.number()),
      nightDiffRegularHolidayRate: v.optional(v.number()),
      nightDiffSpecialHolidayRate: v.optional(v.number()),
      nightDiffRegularHolidayOtRate: v.optional(v.number()),
      nightDiffSpecialHolidayOtRate: v.optional(v.number()),
      regularHolidayRate: v.optional(v.number()),
      specialHolidayRate: v.optional(v.number()),
      overtimeRegularRate: v.optional(v.number()),
      overtimeRestDayRate: v.optional(v.number()),
      regularHolidayOtRate: v.optional(v.number()),
      specialHolidayOtRate: v.optional(v.number()),
      dailyRateIncludesAllowance: v.optional(v.boolean()),
      dailyRateWorkingDaysPerYear: v.optional(v.number()),
      taxDeductionFrequency: v.optional(
        v.union(v.literal("once_per_month"), v.literal("twice_per_month")),
      ),
      taxDeductOnPay: v.optional(
        v.union(v.literal("first"), v.literal("second")),
      ),
      holidayNoWorkNoPay: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      // Create settings if they don't exist
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        payrollSettings: args.payrollSettings,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Update existing settings
      await ctx.db.patch(settings._id, {
        payrollSettings: {
          ...(settings.payrollSettings || {}),
          ...args.payrollSettings,
        },
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update attendance / lunch settings (org default when employee has no shift)
export const updateAttendanceSettings = mutation({
  args: {
    organizationId: v.id("organizations"),
    attendanceSettings: v.object({
      defaultLunchBreakMinutes: v.optional(v.number()),
      defaultLunchStart: v.optional(v.string()),
      defaultLunchEnd: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        attendanceSettings: args.attendanceSettings,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        attendanceSettings: {
          ...(settings.attendanceSettings || {}),
          ...args.attendanceSettings,
        },
        updatedAt: now,
      });
    }
    return { success: true };
  },
});

// Update leave tracker settings (prorated leave, annual SIL, etc.)
// Leave types are no longer in settings; leave is managed manually on the leave page.
export const updateLeaveTypes = mutation({
  args: {
    organizationId: v.id("organizations"),
    proratedLeave: v.optional(v.boolean()),
    annualSil: v.optional(v.number()),
    grantLeaveUponRegularization: v.optional(v.boolean()),
    leaveRequestFormTemplate: v.optional(v.string()),
    maxConvertibleLeaveDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    const patch: any = { updatedAt: now };
    if (args.proratedLeave !== undefined) {
      patch.proratedLeave = args.proratedLeave;
    }
    if (args.annualSil !== undefined) {
      patch.annualSil = args.annualSil;
    }
    if (args.grantLeaveUponRegularization !== undefined) {
      patch.grantLeaveUponRegularization = args.grantLeaveUponRegularization;
    }
    if (args.leaveRequestFormTemplate !== undefined) {
      patch.leaveRequestFormTemplate = args.leaveRequestFormTemplate;
    }
    if (args.maxConvertibleLeaveDays !== undefined) {
      patch.maxConvertibleLeaveDays = args.maxConvertibleLeaveDays;
    }

    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        proratedLeave: args.proratedLeave ?? true,
        annualSil: args.annualSil ?? 8,
        grantLeaveUponRegularization: args.grantLeaveUponRegularization ?? true,
        leaveRequestFormTemplate: args.leaveRequestFormTemplate,
        maxConvertibleLeaveDays: args.maxConvertibleLeaveDays ?? 5,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, patch);
    }

    return { success: true };
  },
});

export const updateLeaveTracker = mutation({
  args: {
    organizationId: v.id("organizations"),
    year: v.number(),
    rows: v.array(
      v.object({
        employeeId: v.id("employees"),
        annualSilOverride: v.optional(v.number()),
        availed: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    const settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    const byYear = settings?.leaveTrackerByYear ?? [];
    const otherYears = byYear.filter((e: any) => e.year !== args.year);
    const newByYear = [
      ...otherYears,
      { year: args.year, rows: args.rows },
    ].sort((a: any, b: any) => a.year - b.year);

    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        annualSil: 8,
        leaveTrackerByYear: newByYear,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        leaveTrackerByYear: newByYear,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update organization departments
export const updateDepartments = mutation({
  args: {
    organizationId: v.id("organizations"),
    departments: v.array(
      v.object({
        name: v.string(),
        color: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        departments: args.departments,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Also migrate old format if it exists (shouldn't happen, but just in case)
      let departmentsToSave = args.departments;
      if (settings.departments && settings.departments.length > 0) {
        const firstDept = settings.departments[0];
        if (typeof firstDept === "string") {
          // Old format still exists - use the new format from args
          departmentsToSave = args.departments;
        }
      }

      await ctx.db.patch(settings._id, {
        departments: departmentsToSave,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update recruitment applicants table columns configuration
export const updateRecruitmentTableColumns = mutation({
  args: {
    organizationId: v.id("organizations"),
    columns: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        field: v.string(),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("date"),
          v.literal("badge"),
          v.literal("link"),
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        recruitmentTableColumns: args.columns,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        recruitmentTableColumns: args.columns,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update requirements table columns configuration
export const updateRequirementsTableColumns = mutation({
  args: {
    organizationId: v.id("organizations"),
    columns: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        field: v.string(),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("date"),
          v.literal("badge"),
          v.literal("link"),
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        requirementsTableColumns: args.columns,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        requirementsTableColumns: args.columns,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update evaluation columns configuration
export const updateEvaluationColumns = mutation({
  args: {
    organizationId: v.id("organizations"),
    columns: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        type: v.union(
          v.literal("date"),
          v.literal("number"),
          v.literal("text"),
          v.literal("rating"),
        ),
        hidden: v.optional(v.boolean()),
        hasRatingColumn: v.optional(v.boolean()),
        hasNotesColumn: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        evaluationColumns: args.columns,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        evaluationColumns: args.columns,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Update leave table columns configuration
export const updateLeaveTableColumns = mutation({
  args: {
    organizationId: v.id("organizations"),
    columns: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        field: v.string(),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("date"),
          v.literal("badge"),
          v.literal("link"),
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        leaveTableColumns: args.columns,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        leaveTableColumns: args.columns,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});
