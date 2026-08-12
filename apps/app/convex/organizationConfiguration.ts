import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

type ReadContext = Pick<QueryCtx, "db">;
type ConfigurationSource = "normalized" | "legacy" | "default";

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
