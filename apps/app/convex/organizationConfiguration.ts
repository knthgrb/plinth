import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeDepartmentName } from "./databaseMigrationPlanner";

type ReadContext = Pick<QueryCtx, "db">;
type ConfigurationSource = "normalized" | "legacy" | "default";
const RELEASE_2_MIGRATION_VERSION = 2;

type LegacyDepartment =
  | string
  | {
      name: string;
      color: string;
      departmentHeadUserId?: Id<"users">;
      costCenter?: string;
      location?: string;
      parentDepartmentName?: string;
    };

export type DepartmentConfigurationInput = Exclude<LegacyDepartment, string>;
export type RequirementConfigurationInput = NonNullable<
  Doc<"organizations">["defaultRequirements"]
>[number];

const DEPARTMENT_COLORS = [
  "#9CA3AF",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#3B82F6",
  "#A855F7",
  "#EC4899",
] as const;

async function getLegacySettings(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("settings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Duplicate legacy settings rows");
  return rows[0] ?? null;
}

async function getPayrollRow(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("organizationPayrollSettings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Duplicate normalized payroll settings");
  }
  return rows[0] ?? null;
}

async function getAttendanceRow(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("organizationAttendanceSettings")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Duplicate normalized attendance settings");
  }
  return rows[0] ?? null;
}

function sanitizeLegacyPayrollSettings(
  settings: Doc<"settings">["payrollSettings"],
) {
  if (!settings) return undefined;
  const { payrollTabPassword: removedPassword, ...safeSettings } = settings;
  void removedPassword;
  return safeSettings;
}

function projectLegacyDepartments(departments: LegacyDepartment[] | undefined) {
  return (departments ?? []).map((department, index) =>
    typeof department === "string"
      ? {
          name: department,
          color: DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length],
        }
      : department,
  );
}

async function getCanonicalDepartments(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("organizationDepartments")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .collect();
  const names = new Map(
    rows.map((department) => [department.normalizedName, department.name]),
  );
  return rows
    .slice()
    .sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName),
    )
    .map((department) => ({
      name: department.name,
      color: department.color,
      ...(department.departmentHeadUserId
        ? { departmentHeadUserId: department.departmentHeadUserId }
        : {}),
      ...(department.costCenter ? { costCenter: department.costCenter } : {}),
      ...(department.location ? { location: department.location } : {}),
      ...(department.parentDepartmentNormalizedName
        ? {
            parentDepartmentName:
              names.get(department.parentDepartmentNormalizedName) ??
              department.parentDepartmentNormalizedName,
          }
        : {}),
    }));
}

export async function getEffectiveRequirementDefinitions(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const [organization, normalizedRows] = await Promise.all([
    ctx.db.get(organizationId),
    ctx.db
      .query("organizationRequirementDefinitions")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", organizationId),
      )
      .collect(),
  ]);
  if (!organization) throw new Error("Organization not found");
  if (normalizedRows.length === 0) {
    return {
      requirements: organization.defaultRequirements ?? [],
      source: (organization.defaultRequirements ? "legacy" : "default") as
        | "legacy"
        | "default",
    };
  }
  return {
    requirements: normalizedRows
      .slice()
      .sort((left, right) =>
        left.normalizedType.localeCompare(right.normalizedType),
      )
      .map(
        ({
          organizationId: ignoredOrganizationId,
          normalizedType,
          source,
          migrationVersion,
          createdAt,
          updatedAt,
          _id,
          _creationTime,
          ...requirement
        }) => {
          void ignoredOrganizationId;
          void normalizedType;
          void source;
          void migrationVersion;
          void createdAt;
          void updatedAt;
          void _id;
          void _creationTime;
          return requirement;
        },
      ),
    source: "normalized" as const,
  };
}

export async function getEffectivePayrollSettings(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const [payroll, legacySettings] = await Promise.all([
    getPayrollRow(ctx, organizationId),
    getLegacySettings(ctx, organizationId),
  ]);
  if (payroll) {
    return {
      payrollSettings: payroll.payrollSettings,
      source: "normalized" as const,
    };
  }
  const payrollSettings = sanitizeLegacyPayrollSettings(
    legacySettings?.payrollSettings,
  );
  return {
    payrollSettings,
    source: (payrollSettings ? "legacy" : "default") as "legacy" | "default",
  };
}

export async function getEffectiveAttendanceSettings(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const [attendance, legacySettings] = await Promise.all([
    getAttendanceRow(ctx, organizationId),
    getLegacySettings(ctx, organizationId),
  ]);
  if (attendance) {
    return {
      attendanceSettings: attendance.attendanceSettings,
      source: "normalized" as const,
    };
  }
  return {
    attendanceSettings: legacySettings?.attendanceSettings,
    source: (legacySettings?.attendanceSettings ? "legacy" : "default") as
      | "legacy"
      | "default",
  };
}

export async function getEffectiveOrganization(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const [organization, payroll, requirements] = await Promise.all([
    ctx.db.get(organizationId),
    getPayrollRow(ctx, organizationId),
    getEffectiveRequirementDefinitions(ctx, organizationId),
  ]);
  if (!organization) return null;
  return {
    ...organization,
    ...(payroll
      ? {
          salaryPaymentFrequency: payroll.salaryPaymentFrequency,
          firstPayDate: payroll.firstPayDate,
          secondPayDate: payroll.secondPayDate,
        }
      : {}),
    defaultRequirements: requirements.requirements,
    _normalizationSources: {
      payroll: (payroll ? "normalized" : "legacy") as ConfigurationSource,
      requirements: requirements.source as ConfigurationSource,
    },
  };
}

export async function getEffectiveSettings(
  ctx: ReadContext,
  organizationId: Id<"organizations">,
) {
  const [legacySettings, payroll, attendance, normalizedDepartments] =
    await Promise.all([
      getLegacySettings(ctx, organizationId),
      getPayrollRow(ctx, organizationId),
      getAttendanceRow(ctx, organizationId),
      getCanonicalDepartments(ctx, organizationId),
    ]);
  const legacyPayrollSettings = sanitizeLegacyPayrollSettings(
    legacySettings?.payrollSettings,
  );
  const legacyDepartments = projectLegacyDepartments(
    legacySettings?.departments as LegacyDepartment[] | undefined,
  );
  const useNormalizedDepartments = normalizedDepartments.length > 0;
  return {
    ...(legacySettings ?? { _id: null, organizationId }),
    payrollSettings: payroll?.payrollSettings ?? legacyPayrollSettings,
    attendanceSettings:
      attendance?.attendanceSettings ?? legacySettings?.attendanceSettings,
    departments: useNormalizedDepartments
      ? normalizedDepartments
      : legacyDepartments,
    _normalizationSources: {
      payroll: (payroll
        ? "normalized"
        : legacyPayrollSettings
          ? "legacy"
          : "default") as ConfigurationSource,
      attendance: (attendance
        ? "normalized"
        : legacySettings?.attendanceSettings
          ? "legacy"
          : "default") as ConfigurationSource,
      departments: (useNormalizedDepartments
        ? "normalized"
        : legacySettings?.departments
          ? "legacy"
          : "default") as ConfigurationSource,
    },
  };
}

export async function upsertPayrollConfiguration(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  patch: {
    salaryPaymentFrequency?: "monthly" | "bimonthly";
    firstPayDate?: number;
    secondPayDate?: number;
    payrollSettings?: NonNullable<Doc<"settings">["payrollSettings"]>;
  },
) {
  const [organization, existing, legacySettings] = await Promise.all([
    ctx.db.get(organizationId),
    getPayrollRow(ctx, organizationId),
    getLegacySettings(ctx, organizationId),
  ]);
  if (!organization) throw new Error("Organization not found");
  const now = Date.now();
  const currentPayrollSettings =
    existing?.payrollSettings ??
    sanitizeLegacyPayrollSettings(legacySettings?.payrollSettings);
  const payrollSettings = patch.payrollSettings
    ? {
        ...(currentPayrollSettings ?? {}),
        ...sanitizeLegacyPayrollSettings(patch.payrollSettings),
      }
    : currentPayrollSettings;
  const value = {
    organizationId,
    salaryPaymentFrequency:
      patch.salaryPaymentFrequency ??
      existing?.salaryPaymentFrequency ??
      organization.salaryPaymentFrequency ??
      "bimonthly",
    firstPayDate:
      patch.firstPayDate ??
      existing?.firstPayDate ??
      organization.firstPayDate ??
      15,
    secondPayDate:
      patch.secondPayDate ??
      existing?.secondPayDate ??
      organization.secondPayDate ??
      30,
    ...(existing?.cutoffDates
      ? { cutoffDates: existing.cutoffDates }
      : legacySettings?.cutoffDates
        ? { cutoffDates: legacySettings.cutoffDates }
        : {}),
    ...(payrollSettings ? { payrollSettings } : {}),
    ...(legacySettings?._id
      ? { sourceSettingsId: legacySettings._id }
      : existing?.sourceSettingsId
        ? { sourceSettingsId: existing.sourceSettingsId }
        : {}),
    migrationVersion: RELEASE_2_MIGRATION_VERSION,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
    return existing._id;
  }
  return ctx.db.insert("organizationPayrollSettings", {
    ...value,
    createdAt: now,
  });
}

export async function upsertAttendanceConfiguration(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  attendancePatch: Doc<"organizationAttendanceSettings">["attendanceSettings"],
) {
  const [existing, legacySettings] = await Promise.all([
    getAttendanceRow(ctx, organizationId),
    getLegacySettings(ctx, organizationId),
  ]);
  const now = Date.now();
  const attendanceSettings = {
    ...(existing?.attendanceSettings ??
      legacySettings?.attendanceSettings ??
      {}),
    ...attendancePatch,
  };
  const value = {
    organizationId,
    attendanceSettings,
    ...(legacySettings?._id
      ? { sourceSettingsId: legacySettings._id }
      : existing?.sourceSettingsId
        ? { sourceSettingsId: existing.sourceSettingsId }
        : {}),
    migrationVersion: RELEASE_2_MIGRATION_VERSION,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
    return existing._id;
  }
  return ctx.db.insert("organizationAttendanceSettings", {
    ...value,
    createdAt: now,
  });
}

async function validateDepartmentHead(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  const memberships = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (query) =>
      query.eq("userId", userId).eq("organizationId", organizationId),
    )
    .take(2);
  if (
    memberships.length !== 1 ||
    (memberships[0].accessStatus ?? "active") !== "active"
  ) {
    throw new Error("Department head must be an active organization member");
  }
}

export async function replaceDepartmentConfiguration(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  departments: DepartmentConfigurationInput[],
) {
  const normalizedNames = departments.map((department) =>
    normalizeDepartmentName(department.name),
  );
  if (
    normalizedNames.some((name) => !name) ||
    new Set(normalizedNames).size !== normalizedNames.length
  ) {
    throw new Error("Department names must be unique and non-empty");
  }
  for (const department of departments) {
    if (department.departmentHeadUserId) {
      await validateDepartmentHead(
        ctx,
        organizationId,
        department.departmentHeadUserId,
      );
    }
  }
  const [existingRows, legacySettings] = await Promise.all([
    ctx.db
      .query("organizationDepartments")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", organizationId),
      )
      .collect(),
    getLegacySettings(ctx, organizationId),
  ]);
  const existingByName = new Map<string, Doc<"organizationDepartments">>();
  for (const row of existingRows) {
    if (existingByName.has(row.normalizedName)) {
      throw new Error("Duplicate normalized department rows");
    }
    existingByName.set(row.normalizedName, row);
  }
  const now = Date.now();
  const retainedIds = new Set<Id<"organizationDepartments">>();
  for (const department of departments) {
    const normalizedName = normalizeDepartmentName(department.name);
    const existing = existingByName.get(normalizedName);
    const value = {
      organizationId,
      name: department.name.trim(),
      normalizedName,
      color: department.color,
      departmentHeadUserId: department.departmentHeadUserId,
      costCenter: department.costCenter,
      location: department.location,
      parentDepartmentNormalizedName: department.parentDepartmentName
        ? normalizeDepartmentName(department.parentDepartmentName)
        : undefined,
      sourceSettingsId: legacySettings?._id,
      migrationVersion: RELEASE_2_MIGRATION_VERSION,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      retainedIds.add(existing._id);
    } else {
      const id = await ctx.db.insert("organizationDepartments", {
        ...value,
        createdAt: now,
      });
      retainedIds.add(id);
    }
  }
  for (const existing of existingRows) {
    if (!retainedIds.has(existing._id)) await ctx.db.delete(existing._id);
  }
}

export async function replaceRequirementConfiguration(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  requirements: RequirementConfigurationInput[],
) {
  const normalizedTypes = requirements.map((requirement) =>
    normalizeDepartmentName(requirement.type),
  );
  if (
    normalizedTypes.some((type) => !type) ||
    new Set(normalizedTypes).size !== normalizedTypes.length
  ) {
    throw new Error("Requirement types must be unique and non-empty");
  }
  const existingRows = await ctx.db
    .query("organizationRequirementDefinitions")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .collect();
  const existingByType = new Map<
    string,
    Doc<"organizationRequirementDefinitions">
  >();
  for (const row of existingRows) {
    if (existingByType.has(row.normalizedType)) {
      throw new Error("Duplicate normalized requirement rows");
    }
    existingByType.set(row.normalizedType, row);
  }
  const now = Date.now();
  const retainedIds = new Set<Id<"organizationRequirementDefinitions">>();
  for (const requirement of requirements) {
    const normalizedType = normalizeDepartmentName(requirement.type);
    const existing = existingByType.get(normalizedType);
    const value = {
      organizationId,
      type: requirement.type.trim(),
      normalizedType,
      isRequired: requirement.isRequired,
      appliesToDepartments: requirement.appliesToDepartments,
      appliesToEmploymentTypes: requirement.appliesToEmploymentTypes,
      reminderDaysBeforeDue: requirement.reminderDaysBeforeDue,
      requiresVerification: requirement.requiresVerification,
      expiryDaysAfterSubmission: requirement.expiryDaysAfterSubmission,
      source: "organization" as const,
      migrationVersion: RELEASE_2_MIGRATION_VERSION,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      retainedIds.add(existing._id);
    } else {
      const id = await ctx.db.insert("organizationRequirementDefinitions", {
        ...value,
        createdAt: now,
      });
      retainedIds.add(id);
    }
  }
  for (const existing of existingRows) {
    if (!retainedIds.has(existing._id)) await ctx.db.delete(existing._id);
  }
}
