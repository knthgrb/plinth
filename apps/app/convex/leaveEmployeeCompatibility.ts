import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeMigrationSourceKey } from "./leaveEmployeeMigrationPlanner";

const MIGRATION_VERSION = 1;

type DatabaseContext = Pick<QueryCtx | MutationCtx, "db">;

export type EmployeeDeduction = {
  id: string;
  type: Doc<"employeeDeductions">["type"];
  name: string;
  amount: number;
  frequency: Doc<"employeeDeductions">["frequency"];
  startDate: number;
  endDate?: number;
  isActive: boolean;
};
export type EmployeeIncentive = {
  id: string;
  name: string;
  amount: number;
  frequency: Doc<"employeeIncentives">["frequency"];
  isActive: boolean;
};
export type EmployeeRequirement = Omit<
  Doc<"employeeRequirements">,
  | "_id"
  | "_creationTime"
  | "organizationId"
  | "employeeId"
  | "requirementDefinitionId"
  | "sourceKey"
  | "migrationVersion"
  | "createdAt"
  | "updatedAt"
> & {
  requirementId?: Id<"employeeRequirements">;
};
export type StoredEmployeeRequirement = EmployeeRequirement & {
  requirementId: Id<"employeeRequirements">;
};
export type EmployeeScheduleOverride = Pick<
  Doc<"employeeScheduleOverrides">,
  "date" | "in" | "out" | "reason"
>;
export type EmployeePaymentAccount = Pick<
  Doc<"employeePaymentAccounts">,
  "bankName" | "accountNumber" | "accountName"
>;
export type EmployeeLeaveCredits = {
  vacation: { total: number; used: number; balance: number };
  sick: { total: number; used: number; balance: number };
  custom?: Array<{
    type: string;
    total: number;
    used: number;
    balance: number;
  }>;
};
type CustomFields = Record<string, unknown>;

export type EffectiveEmployee = Doc<"employees"> & {
  deductions: EmployeeDeduction[];
  incentives: EmployeeIncentive[];
  requirements: StoredEmployeeRequirement[];
  leaveCredits?: EmployeeLeaveCredits;
  customFields?: CustomFields;
  compensation: Doc<"employees">["compensation"] & {
    bankDetails?: EmployeePaymentAccount;
  };
  schedule: Doc<"employees">["schedule"] & {
    scheduleOverrides: EmployeeScheduleOverride[];
  };
};

function assertEmployeeChild(
  employee: Doc<"employees">,
  child: { organizationId: Id<"organizations">; employeeId: Id<"employees"> },
  label: string,
): void {
  if (
    child.organizationId !== employee.organizationId ||
    child.employeeId !== employee._id
  ) {
    throw new Error(`${label} parent mismatch`);
  }
}

export async function loadEffectiveEmployeeDeductions(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<EmployeeDeduction[]> {
  const rows = await ctx.db
    .query("employeeDeductions")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const sourceIds = new Set<string>();
  return rows
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((row) => {
      assertEmployeeChild(employee, row, "Employee deduction");
      if (sourceIds.has(row.sourceId)) {
        throw new Error("Employee deduction source is not unique");
      }
      sourceIds.add(row.sourceId);
      return {
        id: row.sourceId,
        type: row.type,
        name: row.name,
        amount: row.amount,
        frequency: row.frequency,
        startDate: row.startDate,
        ...(row.endDate !== undefined ? { endDate: row.endDate } : {}),
        isActive: row.isActive,
      };
    });
}

export async function loadEffectiveEmployeeIncentives(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<EmployeeIncentive[]> {
  const rows = await ctx.db
    .query("employeeIncentives")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const sourceIds = new Set<string>();
  return rows
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((row) => {
      assertEmployeeChild(employee, row, "Employee incentive");
      if (sourceIds.has(row.sourceId)) {
        throw new Error("Employee incentive source is not unique");
      }
      sourceIds.add(row.sourceId);
      return {
        id: row.sourceId,
        name: row.name,
        amount: row.amount,
        frequency: row.frequency,
        isActive: row.isActive,
      };
    });
}

export async function loadEffectiveEmployeeRequirements(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<StoredEmployeeRequirement[]> {
  const rows = await ctx.db
    .query("employeeRequirements")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const sourceKeys = new Set<string>();
  return rows
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((row) => {
      assertEmployeeChild(employee, row, "Employee requirement");
      if (sourceKeys.has(row.sourceKey)) {
        throw new Error("Employee requirement source is not unique");
      }
      sourceKeys.add(row.sourceKey);
      const {
        _id,
        _creationTime,
        organizationId,
        employeeId,
        requirementDefinitionId,
        sourceKey,
        migrationVersion,
        createdAt,
        updatedAt,
        ...requirement
      } = row;
      void _id;
      void _creationTime;
      void organizationId;
      void employeeId;
      void requirementDefinitionId;
      void sourceKey;
      void migrationVersion;
      void createdAt;
      void updatedAt;
      return { ...requirement, requirementId: _id };
    });
}

export async function loadEffectiveEmployeeScheduleOverrides(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<EmployeeScheduleOverride[]> {
  const rows = await ctx.db
    .query("employeeScheduleOverrides")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const dates = new Set<number>();
  return rows
    .sort((left, right) => left.date - right.date)
    .map((row) => {
      assertEmployeeChild(employee, row, "Employee schedule override");
      if (dates.has(row.date)) {
        throw new Error("Employee schedule override date is not unique");
      }
      dates.add(row.date);
      return {
        date: row.date,
        in: row.in,
        out: row.out,
        reason: row.reason,
      };
    });
}

export async function loadEmployeeScheduleOverridesById(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<EmployeeScheduleOverride[]> {
  const rows = await ctx.db
    .query("employeeScheduleOverrides")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("employeeId"), employeeId))
    .collect();
  return rows
    .sort((a, b) => a.date - b.date)
    .map((row) => ({
      date: row.date,
      in: row.in,
      out: row.out,
      reason: row.reason,
    }));
}

export async function loadEffectiveEmployeePaymentAccount(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<EmployeePaymentAccount | undefined> {
  const rows = await ctx.db
    .query("employeePaymentAccounts")
    .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
    .take(2);
  if (rows.length > 1) {
    throw new Error("Employee payment account is not unique");
  }
  const row = rows[0];
  if (!row) return undefined;
  assertEmployeeChild(employee, row, "Employee payment account");
  return {
    bankName: row.bankName,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
  };
}

function currentManilaYear(now: number): number {
  return new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear();
}

export async function loadEffectiveEmployeeLeaveCredits(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
  now = Date.now(),
): Promise<EmployeeLeaveCredits | undefined> {
  const rows = await ctx.db
    .query("employeeLeaveBalances")
    .withIndex("by_organization_year", (q) =>
      q
        .eq("organizationId", employee.organizationId)
        .eq("year", currentManilaYear(now)),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const employeeRows = rows.filter((row) => row.source === "employee_credits");
  if (employeeRows.length === 0) return undefined;
  const byKey = new Map<string, (typeof employeeRows)[number]>();
  for (const row of employeeRows) {
    assertEmployeeChild(employee, row, "Employee leave balance");
    if (byKey.has(row.leaveTypeKey)) {
      throw new Error("Employee leave balance key is not unique");
    }
    byKey.set(row.leaveTypeKey, row);
  }
  const vacation = byKey.get("vacation");
  const sick = byKey.get("sick");
  if (!vacation || !sick) {
    throw new Error("Employee leave balance is incomplete");
  }
  const custom = [...byKey.entries()]
    .filter(([key]) => key !== "vacation" && key !== "sick")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, row]) => ({
      type,
      total: row.total,
      used: row.used,
      balance: row.balance,
    }));
  return {
    vacation: {
      total: vacation.total,
      used: vacation.used,
      balance: vacation.balance,
    },
    sick: { total: sick.total, used: sick.used, balance: sick.balance },
    ...(custom.length > 0 ? { custom } : {}),
  };
}

export async function loadEffectiveEmployeeCustomFields(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<CustomFields | undefined> {
  const rows = await ctx.db
    .query("employeeCustomFieldValues")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  if (rows.length === 0) return undefined;
  const fields: CustomFields = {};
  for (const row of rows) {
    assertEmployeeChild(employee, row, "Employee custom field");
    if (Object.hasOwn(fields, row.sourceKey))
      throw new Error("Employee custom field is not unique");
    fields[row.sourceKey] = JSON.parse(row.valueJson) as unknown;
  }
  return fields;
}

function customValueType(
  value: unknown,
): "string" | "number" | "boolean" | "null" | "array" | "object" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

export async function replaceEmployeeCustomFields(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  fields: CustomFields,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeCustomFieldValues")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const [rawKey, value] of Object.entries(fields)) {
    const sourceKey = normalizeMigrationSourceKey(rawKey);
    const definitions = await ctx.db
      .query("organizationCustomFieldDefinitions")
      .withIndex("by_organization_entity_key", (q) =>
        q
          .eq("organizationId", employee.organizationId)
          .eq("entityType", "employee")
          .eq("sourceKey", sourceKey),
      )
      .take(2);
    if (definitions.length > 1)
      throw new Error("Employee custom field definition is not unique");
    const definitionId =
      definitions[0]?._id ??
      (await ctx.db.insert("organizationCustomFieldDefinitions", {
        organizationId: employee.organizationId,
        entityType: "employee",
        sourceKey,
        label: rawKey,
        valueType: "mixed",
        isActive: true,
        migrationVersion: MIGRATION_VERSION,
        createdAt: now,
        updatedAt: now,
      }));
    await ctx.db.insert("employeeCustomFieldValues", {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      definitionId,
      sourceKey,
      valueType: customValueType(value),
      valueJson: JSON.stringify(value),
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function upsertEmployeeDeduction(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  deduction: EmployeeDeduction,
  now: number,
): Promise<Id<"employeeDeductions">> {
  const rows = await ctx.db
    .query("employeeDeductions")
    .withIndex("by_employee_source_id", (q) =>
      q.eq("employeeId", employee._id).eq("sourceId", deduction.id),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Employee deduction source is not unique");
  }
  const value = {
    organizationId: employee.organizationId,
    employeeId: employee._id,
    sourceId: deduction.id,
    type: deduction.type,
    name: deduction.name,
    amount: deduction.amount,
    frequency: deduction.frequency,
    startDate: deduction.startDate,
    ...(deduction.endDate !== undefined ? { endDate: deduction.endDate } : {}),
    isActive: deduction.isActive,
    migrationVersion: MIGRATION_VERSION,
    updatedAt: now,
  };
  if (rows[0]) {
    if (rows[0].organizationId !== employee.organizationId) {
      throw new Error("Employee deduction organization mismatch");
    }
    await ctx.db.patch(rows[0]._id, value);
    return rows[0]._id;
  }
  return ctx.db.insert("employeeDeductions", {
    ...value,
    createdAt: now,
  });
}

export async function replaceEmployeeDeductions(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  deductions: EmployeeDeduction[],
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeDeductions")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const deduction of deductions) {
    await upsertEmployeeDeduction(ctx, employee, deduction, now);
  }
}

export async function upsertEmployeeIncentive(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  incentive: EmployeeIncentive,
  now: number,
): Promise<Id<"employeeIncentives">> {
  const rows = await ctx.db
    .query("employeeIncentives")
    .withIndex("by_employee_source_id", (q) =>
      q.eq("employeeId", employee._id).eq("sourceId", incentive.id),
    )
    .take(2);
  if (rows.length > 1) {
    throw new Error("Employee incentive source is not unique");
  }
  const value = {
    organizationId: employee.organizationId,
    employeeId: employee._id,
    sourceId: incentive.id,
    name: incentive.name,
    amount: incentive.amount,
    frequency: incentive.frequency,
    isActive: incentive.isActive,
    migrationVersion: MIGRATION_VERSION,
    updatedAt: now,
  };
  if (rows[0]) {
    assertEmployeeChild(employee, rows[0], "Employee incentive");
    await ctx.db.patch(rows[0]._id, value);
    return rows[0]._id;
  }
  return ctx.db.insert("employeeIncentives", { ...value, createdAt: now });
}

export async function replaceEmployeeIncentives(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  incentives: EmployeeIncentive[],
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeIncentives")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  for (const incentive of incentives) {
    await upsertEmployeeIncentive(ctx, employee, incentive, now);
  }
}

export async function replaceEmployeeRequirements(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  requirements: EmployeeRequirement[],
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeRequirements")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  const existingById = new Map(existing.map((row) => [row._id, row]));
  const retainedIds = new Set<Id<"employeeRequirements">>();
  const sequenceByType = new Map<string, number>();
  for (const requirement of requirements) {
    const baseKey = normalizeMigrationSourceKey(requirement.type);
    const sequence = sequenceByType.get(baseKey) ?? 0;
    sequenceByType.set(baseKey, sequence + 1);
    const sourceKey = `${baseKey}:${sequence}`;
    const { requirementId, ...value } = requirement;
    if (requirementId) {
      const row = existingById.get(requirementId);
      if (!row) throw new Error("Requirement does not belong to employee");
      retainedIds.add(requirementId);
      await ctx.db.patch(requirementId, {
        sourceKey,
        ...value,
        updatedAt: now,
      });
      continue;
    }
    const insertedId = await ctx.db.insert("employeeRequirements", {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      sourceKey,
      ...value,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    retainedIds.add(insertedId);
  }
  for (const row of existing) {
    if (!retainedIds.has(row._id)) await ctx.db.delete(row._id);
  }
}

export async function replaceEmployeeScheduleOverrides(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  overrides: EmployeeScheduleOverride[],
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeScheduleOverrides")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", employee.organizationId),
    )
    .filter((q) => q.eq(q.field("employeeId"), employee._id))
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const dates = new Set<number>();
  for (const override of overrides) {
    if (dates.has(override.date)) {
      throw new Error("Employee schedule override date is not unique");
    }
    dates.add(override.date);
    await ctx.db.insert("employeeScheduleOverrides", {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      ...override,
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function replaceEmployeePaymentAccount(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  account: EmployeePaymentAccount | undefined,
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("employeePaymentAccounts")
    .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
    .take(2);
  if (existing.length > 1) {
    throw new Error("Employee payment account is not unique");
  }
  if (!account) {
    if (existing[0]) await ctx.db.delete(existing[0]._id);
    return;
  }
  const value = {
    organizationId: employee.organizationId,
    employeeId: employee._id,
    ...account,
    migrationVersion: MIGRATION_VERSION,
    updatedAt: now,
  };
  if (existing[0]) {
    assertEmployeeChild(employee, existing[0], "Employee payment account");
    await ctx.db.patch(existing[0]._id, value);
  } else {
    await ctx.db.insert("employeePaymentAccounts", {
      ...value,
      createdAt: now,
    });
  }
}

export async function replaceEmployeeLeaveCredits(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  credits: EmployeeLeaveCredits,
  now: number,
): Promise<void> {
  const year = currentManilaYear(now);
  const existing = await ctx.db
    .query("employeeLeaveBalances")
    .withIndex("by_organization_year", (q) =>
      q.eq("organizationId", employee.organizationId).eq("year", year),
    )
    .filter((q) =>
      q.and(
        q.eq(q.field("employeeId"), employee._id),
        q.eq(q.field("source"), "employee_credits"),
      ),
    )
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);
  const entries = [
    ["vacation", credits.vacation],
    ["sick", credits.sick],
    ...(credits.custom ?? []).map(
      (credit) => [normalizeMigrationSourceKey(credit.type), credit] as const,
    ),
  ] as const;
  const keys = new Set<string>();
  for (const [leaveTypeKey, credit] of entries) {
    if (keys.has(leaveTypeKey)) {
      throw new Error("Employee leave balance key is not unique");
    }
    keys.add(leaveTypeKey);
    await ctx.db.insert("employeeLeaveBalances", {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      year,
      leaveTypeKey,
      total: credit.total,
      used: credit.used,
      balance: credit.balance,
      source: "employee_credits",
      approvedDays: 0,
      reconciliationStatus: "not_applicable",
      migrationVersion: MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function getEffectiveOrganizationLeaveSettings(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings"> | null> {
  const rows = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(2);
  if (rows.length > 1) {
    throw new Error("Duplicate normalized leave settings");
  }
  return rows[0] ?? null;
}

export async function upsertOrganizationLeaveSettings(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  sourceSettingsId: Id<"settings">,
  patch: Partial<
    Pick<
      Doc<"organizationLeaveSettings">,
      | "proratedLeave"
      | "leaveAccrualFrequency"
      | "leaveTrackerMode"
      | "enableAnniversaryLeave"
      | "anniversaryLeaveMaxDays"
      | "maxConvertibleLeaveDays"
      | "annualSil"
      | "grantLeaveUponRegularization"
      | "paidLeaveRequiresRegularization"
      | "leaveGuidelines"
      | "leaveRequestFormTemplate"
      | "leaveRequestPdfLayout"
    >
  >,
  now: number,
): Promise<void> {
  const existing = await getEffectiveOrganizationLeaveSettings(
    ctx,
    organizationId,
  );
  const value = {
    organizationId,
    ...patch,
    sourceSettingsId,
    migrationVersion: MIGRATION_VERSION,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
  } else {
    await ctx.db.insert("organizationLeaveSettings", {
      ...value,
      createdAt: now,
    });
  }
}

export async function loadEffectiveEmployee(
  ctx: DatabaseContext,
  employee: Doc<"employees">,
): Promise<EffectiveEmployee> {
  const [
    deductions,
    incentives,
    requirements,
    scheduleOverrides,
    bankDetails,
    leaveCredits,
    customFields,
  ] = await Promise.all([
    loadEffectiveEmployeeDeductions(ctx, employee),
    loadEffectiveEmployeeIncentives(ctx, employee),
    loadEffectiveEmployeeRequirements(ctx, employee),
    loadEffectiveEmployeeScheduleOverrides(ctx, employee),
    loadEffectiveEmployeePaymentAccount(ctx, employee),
    loadEffectiveEmployeeLeaveCredits(ctx, employee),
    loadEffectiveEmployeeCustomFields(ctx, employee),
  ]);
  return {
    ...employee,
    deductions,
    incentives,
    requirements,
    leaveCredits,
    customFields,
    compensation: { ...employee.compensation, bankDetails },
    schedule: { ...employee.schedule, scheduleOverrides },
  };
}
