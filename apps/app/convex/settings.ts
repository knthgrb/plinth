import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  getEffectiveSettings,
  replaceDepartmentConfiguration,
  upsertAttendanceConfiguration,
  upsertPayrollConfiguration,
} from "./organizationConfiguration";
import { requireActiveMembership } from "./access";
import { upsertOrganizationLeaveSettings } from "./leaveEmployeeCompatibility";
import {
  appendOrganizationSettingsEvent,
  upsertOrganizationUiSettings,
} from "./workflowCompatibility";
import { assertLegacyLeaveWriteAllowed } from "./leaveMigration";

async function getOrCreateSettingsAnchor(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  now: number,
): Promise<Doc<"settings">> {
  const rows = await ctx.db
    .query("settings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(2);
  if (rows.length > 1) throw new Error("Organization settings are not unique");
  if (rows[0]) return rows[0];
  const settingsId = await ctx.db.insert("settings", {
    organizationId,
    createdAt: now,
    updatedAt: now,
  });
  const settings = await ctx.db.get(settingsId);
  if (!settings) throw new Error("Organization settings anchor was not created");
  return settings;
}

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  let access: Awaited<ReturnType<typeof requireActiveMembership>>;
  try {
    access = await requireActiveMembership(ctx, organizationId);
  } catch {
    throw new Error("Organization access is limited or inactive");
  }
  const userRole = access.membership.role;

  // Owner has all admin privileges - treat owner the same as admin
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";

  if (requiredRole && userRole !== requiredRole && !isOwnerOrAdmin) {
    throw new Error("Not authorized");
  }

  return {
    ...access.user,
    role: userRole,
    organizationId,
    employeeId: access.membership.employeeId,
    accessStatus: access.membership.accessStatus,
  };
}

type SettingsChangeArea = "payroll" | "leave" | "attendance" | "organization";

async function recordSettingsChange(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  area: SettingsChangeArea,
  userId: Id<"users">,
  now: number,
  reason?: string,
): Promise<Doc<"settings">> {
  const settings = await getOrCreateSettingsAnchor(ctx, organizationId, now);
  await appendOrganizationSettingsEvent(
    ctx,
    settings._id,
    organizationId,
    area,
    userId,
    now,
    reason,
  );
  return settings;
}

async function updateNormalizedUiSettings(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  patch: Partial<
    Pick<
      Doc<"organizationUiSettings">,
      | "evaluationColumns"
      | "recruitmentTableColumns"
      | "requirementsTableColumns"
      | "leaveTableColumns"
    >
  >,
  now: number,
): Promise<void> {
  const settings = await getOrCreateSettingsAnchor(ctx, organizationId, now);
  await upsertOrganizationUiSettings(
    ctx,
    organizationId,
    settings._id,
    patch,
    now,
  );
}

// Get organization settings
export const getSettings = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    try {
      await checkAuth(ctx, args.organizationId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("Not authenticated") ||
        message.includes("Unauthenticated")
      ) {
        return null;
      }
      throw error;
    }

    let settings = await getEffectiveSettings(ctx, args.organizationId);

    // If no settings exist, return default settings structure (don't create in query)
    if (settings._id === null) {
      return {
        ...settings,
        _id: null,
        organizationId: args.organizationId,
        proratedLeave: true,
        leaveAccrualFrequency: "monthly" as const,
        leaveTrackerMode: "general" as const,
        enableAnniversaryLeave: true,
        anniversaryLeaveMaxDays: 15,
        annualSil: 8,
        grantLeaveUponRegularization: true,
        paidLeaveRequiresRegularization: true,
        leaveGuidelines: undefined,
        maxConvertibleLeaveDays: 5,
        leaveRequestFormTemplate: undefined,
        leaveRequestPdfLayout: undefined,
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
          absentBeforeHolidayNoHolidayPay: true,
          ...(settings.payrollSettings ?? {}),
        },
        attendanceSettings: {
          defaultLunchBreakMinutes: 60,
          defaultLunchStart: "12:00",
          defaultLunchEnd: "13:00",
          graceMinutes: 5,
          roundingRule: "none",
          flexibleShiftsEnabled: false,
          overnightShiftCutoffHour: 6,
          restDayPolicy: "shift_based",
          geofencePolicy: {
            enabled: false,
            allowedRadiusMeters: 100,
            requireForClockIn: false,
          },
          importPolicy: {
            allowCsvImport: true,
            requireReviewBeforePosting: true,
          },
          payrollLockPolicy: {
            lockAttendanceAfterPayrollFinalized: true,
            allowAdminCorrectionWithReason: true,
          },
          ...(settings.attendanceSettings ?? {}),
        },
      };
    }

    if (settings.annualSil === undefined) {
      settings = {
        ...settings,
        annualSil: 8,
      };
    }
    if (settings.leaveAccrualFrequency === undefined) {
      settings = {
        ...settings,
        leaveAccrualFrequency: "monthly" as const,
      };
    }
    if (settings.anniversaryLeaveMaxDays === undefined) {
      settings = {
        ...settings,
        anniversaryLeaveMaxDays: 15,
      };
    }
    if (settings.paidLeaveRequiresRegularization === undefined) {
      settings = {
        ...settings,
        paidLeaveRequiresRegularization: true,
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
      absentBeforeHolidayNoHolidayPay: v.optional(v.boolean()),
      trainNinetyThousandCapOnAdditions: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await upsertPayrollConfiguration(ctx, args.organizationId, {
      payrollSettings: args.payrollSettings,
    });
    await recordSettingsChange(
      ctx,
      args.organizationId,
      "payroll",
      userRecord._id,
      now,
    );

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
      graceMinutes: v.optional(v.number()),
      roundingRule: v.optional(
        v.union(
          v.literal("none"),
          v.literal("nearest_5"),
          v.literal("nearest_15"),
          v.literal("floor_15"),
          v.literal("ceiling_15"),
        ),
      ),
      flexibleShiftsEnabled: v.optional(v.boolean()),
      overnightShiftCutoffHour: v.optional(v.number()),
      restDayPolicy: v.optional(
        v.union(
          v.literal("fixed_weekly"),
          v.literal("shift_based"),
          v.literal("attendance_based"),
        ),
      ),
      geofencePolicy: v.optional(
        v.object({
          enabled: v.boolean(),
          allowedRadiusMeters: v.optional(v.number()),
          requireForClockIn: v.optional(v.boolean()),
        }),
      ),
      importPolicy: v.optional(
        v.object({
          allowCsvImport: v.optional(v.boolean()),
          requireReviewBeforePosting: v.optional(v.boolean()),
        }),
      ),
      payrollLockPolicy: v.optional(
        v.object({
          lockAttendanceAfterPayrollFinalized: v.optional(v.boolean()),
          allowAdminCorrectionWithReason: v.optional(v.boolean()),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await upsertAttendanceConfiguration(
      ctx,
      args.organizationId,
      args.attendanceSettings,
    );
    await recordSettingsChange(
      ctx,
      args.organizationId,
      "attendance",
      userRecord._id,
      now,
    );
    return { success: true };
  },
});

// Update leave tracker settings (prorated leave, annual SIL, etc.)
// Leave types are no longer in settings; leave is managed manually on the leave page.
export const updateLeaveTypes = mutation({
  args: {
    organizationId: v.id("organizations"),
    proratedLeave: v.optional(v.boolean()),
    leaveAccrualFrequency: v.optional(
      v.union(
        v.literal("monthly"),
        v.literal("semi_annual"),
        v.literal("annual"),
      ),
    ),
    leaveTrackerMode: v.optional(
      v.union(v.literal("general"), v.literal("by_type")),
    ),
    enableAnniversaryLeave: v.optional(v.boolean()),
    anniversaryLeaveMaxDays: v.optional(v.number()),
    annualSil: v.optional(v.number()),
    grantLeaveUponRegularization: v.optional(v.boolean()),
    paidLeaveRequiresRegularization: v.optional(v.boolean()),
    leaveGuidelines: v.optional(v.string()),
    leaveRequestFormTemplate: v.optional(v.string()),
    leaveRequestPdfLayout: v.optional(
      v.object({
        header: v.optional(
          v.object({
            enabled: v.boolean(),
            kind: v.union(
              v.literal("none"),
              v.literal("text"),
              v.literal("image"),
            ),
            text: v.optional(v.string()),
            imageDataUrl: v.optional(v.string()),
            align: v.union(
              v.literal("left"),
              v.literal("center"),
              v.literal("right"),
              v.literal("justify"),
            ),
          }),
        ),
        footer: v.optional(
          v.object({
            enabled: v.boolean(),
            kind: v.union(
              v.literal("none"),
              v.literal("text"),
              v.literal("image"),
            ),
            text: v.optional(v.string()),
            imageDataUrl: v.optional(v.string()),
            align: v.union(
              v.literal("left"),
              v.literal("center"),
              v.literal("right"),
              v.literal("justify"),
            ),
          }),
        ),
      }),
    ),
    maxConvertibleLeaveDays: v.optional(v.number()),
    leaveTypes: v.optional(
      v.array(
        v.object({
          type: v.string(),
          name: v.string(),
          defaultCredits: v.number(),
          isPaid: v.boolean(),
          requiresApproval: v.boolean(),
          maxConsecutiveDays: v.optional(v.number()),
          carryOver: v.optional(v.boolean()),
          maxCarryOver: v.optional(v.number()),
          isAnniversary: v.optional(v.boolean()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await assertLegacyLeaveWriteAllowed(ctx, args.organizationId);
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    const currentLeaveSettings = await ctx.db
      .query("organizationLeaveSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
    if (currentLeaveSettings?.activePolicyEngineVersion === 2) {
      throw new Error(
        "Use leave policy administration for organizations on leave engine V2",
      );
    }
    const settings = await recordSettingsChange(
      ctx,
      args.organizationId,
      "leave",
      userRecord._id,
      now,
    );
    const leaveSettingsPatch = {
      ...(args.proratedLeave !== undefined ? { proratedLeave: args.proratedLeave } : {}),
      ...(args.leaveAccrualFrequency !== undefined
        ? { leaveAccrualFrequency: args.leaveAccrualFrequency }
        : {}),
      ...(args.leaveTrackerMode !== undefined
        ? { leaveTrackerMode: args.leaveTrackerMode }
        : {}),
      ...(args.enableAnniversaryLeave !== undefined
        ? { enableAnniversaryLeave: args.enableAnniversaryLeave }
        : {}),
      ...(args.anniversaryLeaveMaxDays !== undefined
        ? { anniversaryLeaveMaxDays: args.anniversaryLeaveMaxDays }
        : {}),
      ...(args.annualSil !== undefined ? { annualSil: args.annualSil } : {}),
      ...(args.grantLeaveUponRegularization !== undefined
        ? { grantLeaveUponRegularization: args.grantLeaveUponRegularization }
        : {}),
      ...(args.paidLeaveRequiresRegularization !== undefined
        ? { paidLeaveRequiresRegularization: args.paidLeaveRequiresRegularization }
        : {}),
      ...(args.leaveGuidelines !== undefined
        ? { leaveGuidelines: args.leaveGuidelines }
        : {}),
      ...(args.leaveRequestFormTemplate !== undefined
        ? { leaveRequestFormTemplate: args.leaveRequestFormTemplate }
        : {}),
      ...(args.leaveRequestPdfLayout !== undefined
        ? { leaveRequestPdfLayout: args.leaveRequestPdfLayout }
        : {}),
      ...(args.maxConvertibleLeaveDays !== undefined
        ? { maxConvertibleLeaveDays: args.maxConvertibleLeaveDays }
        : {}),
    };
    await upsertOrganizationLeaveSettings(
      ctx,
      args.organizationId,
      settings._id,
      leaveSettingsPatch,
      now,
    );
    const normalizedLeaveSettings = await ctx.db
      .query("organizationLeaveSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
    if (!normalizedLeaveSettings) {
      throw new Error("Normalized leave settings were not created");
    }
    await ctx.db.patch(normalizedLeaveSettings._id, {
      migrationState: "pending",
      updatedAt: now,
    });
    if (args.leaveTypes !== undefined) {
      const existing = await ctx.db
        .query("leaveTypes")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();
      for (const row of existing) await ctx.db.delete(row._id);
      for (const leaveType of args.leaveTypes) {
        await ctx.db.insert("leaveTypes", {
          organizationId: args.organizationId,
          sourceKey: leaveType.type,
          name: leaveType.name,
          defaultCredits: leaveType.defaultCredits,
          isPaid: leaveType.isPaid,
          requiresApproval: leaveType.requiresApproval,
          ...(leaveType.maxConsecutiveDays !== undefined
            ? { maxConsecutiveDays: leaveType.maxConsecutiveDays }
            : {}),
          ...(leaveType.carryOver !== undefined
            ? { carryOver: leaveType.carryOver }
            : {}),
          ...(leaveType.maxCarryOver !== undefined
            ? { maxCarryOver: leaveType.maxCarryOver }
            : {}),
          ...(leaveType.isAnniversary !== undefined
            ? { isAnniversary: leaveType.isAnniversary }
            : {}),
          migrationVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
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
    overrideReason: v.string(),
  },
  handler: async (ctx, args) => {
    await assertLegacyLeaveWriteAllowed(ctx, args.organizationId);
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const overrideReason = args.overrideReason.trim();
    if (!overrideReason) {
      throw new Error("Reason for manual leave tracker override is required.");
    }

    const now = Date.now();
    const leaveSettings = await ctx.db
      .query("organizationLeaveSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
    for (const row of args.rows) {
      const employee = await ctx.db.get(row.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        throw new Error("Leave tracker employee does not belong to organization");
      }
      const existing = await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_employee_year_type", (q) =>
          q.eq("employeeId", row.employeeId).eq("year", args.year).eq("leaveTypeKey", "general"),
        )
        .unique();
      const total = row.annualSilOverride ?? leaveSettings?.annualSil ?? 0;
      const used = row.availed ?? 0;
      const value = {
        organizationId: args.organizationId,
        employeeId: row.employeeId,
        year: args.year,
        leaveTypeKey: "general",
        total,
        used,
        balance: total - used,
        source: "yearly_tracker" as const,
        ...(row.annualSilOverride !== undefined
          ? { annualSilOverride: row.annualSilOverride }
          : {}),
        overrideReason,
        updatedBy: userRecord._id,
        approvedDays: 0,
        reconciliationStatus: "not_applicable" as const,
        migrationVersion: 1,
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("employeeLeaveBalances", { ...value, createdAt: now });
    }
    await recordSettingsChange(
      ctx,
      args.organizationId,
      "leave",
      userRecord._id,
      now,
      overrideReason,
    );
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
        departmentHeadUserId: v.optional(v.id("users")),
        costCenter: v.optional(v.string()),
        location: v.optional(v.string()),
        parentDepartmentName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await replaceDepartmentConfiguration(
      ctx,
      args.organizationId,
      args.departments,
    );
    await recordSettingsChange(
      ctx,
      args.organizationId,
      "organization",
      userRecord._id,
      now,
    );

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
    await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await updateNormalizedUiSettings(
      ctx,
      args.organizationId,
      { recruitmentTableColumns: args.columns },
      now,
    );

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
    await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await updateNormalizedUiSettings(
      ctx,
      args.organizationId,
      { requirementsTableColumns: args.columns },
      now,
    );

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
    await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await updateNormalizedUiSettings(
      ctx,
      args.organizationId,
      { evaluationColumns: args.columns },
      now,
    );

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
        isDefault: v.optional(v.boolean()),
        hidden: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");
    const now = Date.now();
    await updateNormalizedUiSettings(
      ctx,
      args.organizationId,
      { leaveTableColumns: args.columns },
      now,
    );

    return { success: true };
  },
});
