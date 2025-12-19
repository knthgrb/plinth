import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "admin" | "hr"
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

  if (requiredRole && userRole !== requiredRole && userRole !== "admin") {
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
    const userRecord = await checkAuth(ctx, args.organizationId);

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .first();

    // If no settings exist, return default settings structure (don't create in query)
    if (!settings) {
      return {
        _id: null,
        organizationId: args.organizationId,
        payrollSettings: {
          nightDiffPercent: 0.1, // 10% default
          regularHolidayRate: 1.0, // 100% additional (200% total) - PH Labor Code
          specialHolidayRate: 0.3, // 30% additional (130% total) - PH Labor Code
          overtimeRegularRate: 1.25, // 125% - PH Labor Code
          overtimeRestDayRate: 1.69, // 169% - PH Labor Code
        },
        leaveTypes: [
          {
            type: "vacation",
            name: "Vacation Leave",
            defaultCredits: 15,
            isPaid: true,
            requiresApproval: true,
            maxConsecutiveDays: 30,
            carryOver: true,
            maxCarryOver: 5,
          },
          {
            type: "sick",
            name: "Sick Leave",
            defaultCredits: 15,
            isPaid: true,
            requiresApproval: true,
            maxConsecutiveDays: 30,
            carryOver: true,
            maxCarryOver: 5,
          },
          {
            type: "emergency",
            name: "Emergency Leave",
            defaultCredits: 5,
            isPaid: true,
            requiresApproval: true,
            maxConsecutiveDays: 7,
            carryOver: false,
          },
        ],
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
      regularHolidayRate: v.optional(v.number()),
      specialHolidayRate: v.optional(v.number()),
      overtimeRegularRate: v.optional(v.number()),
      overtimeRestDayRate: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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

// Update leave types
export const updateLeaveTypes = mutation({
  args: {
    organizationId: v.id("organizations"),
    leaveTypes: v.array(
      v.object({
        type: v.string(),
        name: v.string(),
        defaultCredits: v.number(),
        isPaid: v.boolean(),
        requiresApproval: v.boolean(),
        maxConsecutiveDays: v.optional(v.number()),
        carryOver: v.optional(v.boolean()),
        maxCarryOver: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .first();

    const now = Date.now();
    if (!settings) {
      await ctx.db.insert("settings", {
        organizationId: args.organizationId,
        leaveTypes: args.leaveTypes,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(settings._id, {
        leaveTypes: args.leaveTypes,
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
    departments: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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
      await ctx.db.patch(settings._id, {
        departments: args.departments,
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
          v.literal("link")
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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
          v.literal("link")
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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
          v.literal("rating")
        ),
        hidden: v.optional(v.boolean()),
        hasRatingColumn: v.optional(v.boolean()),
        hasNotesColumn: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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
          v.literal("link")
        ),
        sortable: v.optional(v.boolean()),
        width: v.optional(v.string()),
        customField: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let settings = await (ctx.db.query("settings") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
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
