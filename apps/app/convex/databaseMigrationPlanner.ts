import type { Doc, Id } from "./_generated/dataModel";
import type { SchemaCleanupIssue } from "./databaseMigrationTypes";

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

type RequirementSource = {
  type: string;
  isRequired?: boolean;
  appliesToDepartments?: string[];
  appliesToEmploymentTypes?: string[];
  reminderDaysBeforeDue?: number;
  requiresVerification?: boolean;
  expiryDaysAfterSubmission?: number;
};

type DepartmentSource =
  | string
  | {
      name: string;
      color: string;
      departmentHeadUserId?: Id<"users">;
      costCenter?: string;
      location?: string;
      parentDepartmentName?: string;
    };

type OrganizationSource = {
  firstPayDate?: number;
  secondPayDate?: number;
  salaryPaymentFrequency?: "monthly" | "bimonthly";
  defaultRequirements?: RequirementSource[];
};

type LegacySettingsSource = {
  payrollFrequency?: Doc<"settings">["payrollFrequency"];
  cutoffDates?: Doc<"settings">["cutoffDates"];
  payrollSettings?: Doc<"settings">["payrollSettings"];
  attendanceSettings?: Doc<"settings">["attendanceSettings"];
  departments?: DepartmentSource[];
};

export type PlannedPayrollSettings = {
  salaryPaymentFrequency: "monthly" | "bimonthly";
  firstPayDate: number;
  secondPayDate: number;
  cutoffDates?: { firstCutoff: number; secondCutoff: number };
  payrollSettings?: Doc<"settings">["payrollSettings"];
};

export type PlannedDepartment = {
  name: string;
  normalizedName: string;
  color: string;
  departmentHeadUserId?: Id<"users">;
  costCenter?: string;
  location?: string;
  parentDepartmentName?: string;
};

export type PlannedRequirement = RequirementSource & {
  normalizedType: string;
};

export type OrganizationNormalizationPlan = {
  payroll: PlannedPayrollSettings;
  attendance: Doc<"settings">["attendanceSettings"] | null;
  departments: PlannedDepartment[];
  requirements: PlannedRequirement[];
  issues: SchemaCleanupIssue[];
};

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}

export function normalizeDepartmentName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

export function defaultDepartmentColor(index: number): string {
  return DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length];
}

function normalizePayrollFrequency(
  frequency: LegacySettingsSource["payrollFrequency"],
): "monthly" | "bimonthly" | null {
  if (frequency === "monthly") return "monthly";
  if (frequency === "semi-monthly") return "bimonthly";
  return null;
}

function planDepartments(
  sources: DepartmentSource[] | undefined,
  issues: SchemaCleanupIssue[],
): PlannedDepartment[] {
  const departments: PlannedDepartment[] = [];
  const names = new Set<string>();

  for (const [index, source] of (sources ?? []).entries()) {
    const rawName = typeof source === "string" ? source : source.name;
    const name = rawName.trim();
    const normalizedName = normalizeDepartmentName(name);
    if (!normalizedName || names.has(normalizedName)) {
      issues.push({ code: "DUPLICATE_DEPARTMENT_NAME", field: "departments" });
      continue;
    }
    names.add(normalizedName);

    if (typeof source === "string") {
      departments.push({
        name,
        normalizedName,
        color: defaultDepartmentColor(index),
      });
      continue;
    }

    departments.push({
      name,
      normalizedName,
      color: source.color,
      ...(source.departmentHeadUserId
        ? { departmentHeadUserId: source.departmentHeadUserId }
        : {}),
      ...(source.costCenter ? { costCenter: source.costCenter } : {}),
      ...(source.location ? { location: source.location } : {}),
      ...(source.parentDepartmentName
        ? { parentDepartmentName: source.parentDepartmentName.trim() }
        : {}),
    });
  }

  return departments;
}

function planRequirements(
  sources: RequirementSource[] | undefined,
  issues: SchemaCleanupIssue[],
): PlannedRequirement[] {
  const requirements: PlannedRequirement[] = [];
  const types = new Set<string>();

  for (const source of sources ?? []) {
    const type = source.type.trim();
    const normalizedType = normalizeDepartmentName(type);
    if (!normalizedType || types.has(normalizedType)) {
      issues.push({
        code: "DUPLICATE_REQUIREMENT_TYPE",
        field: "defaultRequirements",
      });
      continue;
    }
    types.add(normalizedType);
    requirements.push({ ...source, type, normalizedType });
  }

  return requirements;
}

export function planOrganizationNormalization(args: {
  organization: OrganizationSource;
  legacySettings: LegacySettingsSource | null;
}): OrganizationNormalizationPlan {
  const issues: SchemaCleanupIssue[] = [];
  const salaryPaymentFrequency =
    args.organization.salaryPaymentFrequency ?? "bimonthly";
  const legacyFrequency = normalizePayrollFrequency(
    args.legacySettings?.payrollFrequency,
  );

  if (legacyFrequency && legacyFrequency !== salaryPaymentFrequency) {
    issues.push({
      code: "PAYROLL_FREQUENCY_CONFLICT",
      field: "salaryPaymentFrequency",
    });
  }

  return {
    payroll: {
      salaryPaymentFrequency,
      firstPayDate: args.organization.firstPayDate ?? 15,
      secondPayDate: args.organization.secondPayDate ?? 30,
      ...(args.legacySettings?.cutoffDates
        ? { cutoffDates: args.legacySettings.cutoffDates }
        : {}),
      ...(args.legacySettings?.payrollSettings
        ? { payrollSettings: args.legacySettings.payrollSettings }
        : {}),
    },
    attendance: args.legacySettings?.attendanceSettings ?? null,
    departments: planDepartments(args.legacySettings?.departments, issues),
    requirements: planRequirements(
      args.organization.defaultRequirements,
      issues,
    ),
    issues,
  };
}
