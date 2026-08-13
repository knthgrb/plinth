import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  LEAVE_EMPLOYEE_MIGRATION_KEY,
  LEAVE_EMPLOYEE_MIGRATION_VERSION,
  buildCustomFieldProjection,
  normalizeMigrationSourceKey,
  planLeaveBalance,
  planUniqueProjection,
  reconcileLeaveCreditUsage,
} from "./leaveEmployeeMigrationPlanner";
import type {
  LeaveBalanceProjection,
  LeaveEmployeeMigrationIssue,
  ProjectionPlan,
} from "./leaveEmployeeMigrationTypes";
import { getManilaDateParts } from "@/lib/manila-date";
import { GENERAL_LEAVE_CREDIT_KEY } from "./leaveCalculations";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;
const MAX_APPROVED_REQUESTS_PER_EMPLOYEE_YEAR = 1_000;

type LeaveEmployeePhase =
  | "leave_organizations"
  | "leave_types"
  | "employee_children"
  | "leave_balances";

type MigrationCounters = Doc<"migrationRuns">["counters"];

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};

const PHASES: readonly LeaveEmployeePhase[] = [
  "leave_organizations",
  "leave_types",
  "employee_children",
  "leave_balances",
];

const continueMigrationReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("leaveEmployeeMigrations:continueLeaveEmployeeMigration");

const processBatchReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("leaveEmployeeMigrations:processLeaveEmployeeMigrationBatch");

const failMigrationReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("leaveEmployeeMigrations:failLeaveEmployeeMigration");

function addCounters(
  counters: MigrationCounters,
  increment: Partial<MigrationCounters>,
): MigrationCounters {
  return {
    scanned: counters.scanned + (increment.scanned ?? 0),
    changed: counters.changed + (increment.changed ?? 0),
    unchanged: counters.unchanged + (increment.unchanged ?? 0),
    skipped: counters.skipped + (increment.skipped ?? 0),
    conflicts: counters.conflicts + (increment.conflicts ?? 0),
    errors: counters.errors + (increment.errors ?? 0),
  };
}

function countersForPlan<T>(
  plan: ProjectionPlan<T>,
): Partial<MigrationCounters> {
  switch (plan.outcome) {
    case "create":
      return { changed: 1 };
    case "unchanged":
      return { unchanged: 1 };
    case "skipped":
      return { skipped: 1 };
    case "conflict":
      return { conflicts: plan.issues.length };
  }
}

function isLeaveEmployeePhase(
  phase: Doc<"migrationRuns">["phase"],
): phase is LeaveEmployeePhase {
  return PHASES.includes(phase as LeaveEmployeePhase);
}

function nextPhase(phase: LeaveEmployeePhase): LeaveEmployeePhase | null {
  const index = PHASES.indexOf(phase);
  return PHASES[index + 1] ?? null;
}

function assertRun(
  run: Doc<"migrationRuns"> | null,
): asserts run is Doc<"migrationRuns"> & { phase: LeaveEmployeePhase } {
  if (
    !run ||
    run.key !== LEAVE_EMPLOYEE_MIGRATION_KEY ||
    run.version !== LEAVE_EMPLOYEE_MIGRATION_VERSION ||
    !isLeaveEmployeePhase(run.phase)
  ) {
    throw new Error("Leave employee migration run was not found");
  }
}

async function recordIssues(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    auditId?: Id<"migrationAudits">;
    organizationId?: Id<"organizations">;
    entityType: string;
    entityId?: string;
    issues: LeaveEmployeeMigrationIssue[];
    now: number;
  },
): Promise<void> {
  for (const issue of args.issues) {
    await ctx.db.insert("migrationIssues", {
      runId: args.runId,
      ...(args.auditId ? { auditId: args.auditId } : {}),
      ...(args.organizationId ? { organizationId: args.organizationId } : {}),
      entityType: args.entityType,
      ...(args.entityId ? { entityId: args.entityId } : {}),
      field: issue.field,
      code: issue.code,
      createdAt: args.now,
    });
  }
}

function stripDocumentMetadata<
  T extends {
    _id: unknown;
    _creationTime: number;
    createdAt: number;
    updatedAt: number;
  },
>(document: T): Omit<T, "_id" | "_creationTime" | "createdAt" | "updatedAt"> {
  const copy: Partial<T> = { ...document };
  delete copy._id;
  delete copy._creationTime;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, "_id" | "_creationTime" | "createdAt" | "updatedAt">;
}

function leaveSettingsProjection(
  settings: Doc<"settings">,
): Omit<
  Doc<"organizationLeaveSettings">,
  "_id" | "_creationTime" | "createdAt" | "updatedAt"
> {
  return {
    organizationId: settings.organizationId,
    ...(settings.proratedLeave !== undefined
      ? { proratedLeave: settings.proratedLeave }
      : {}),
    ...(settings.leaveAccrualFrequency !== undefined
      ? { leaveAccrualFrequency: settings.leaveAccrualFrequency }
      : {}),
    ...(settings.leaveTrackerMode !== undefined
      ? { leaveTrackerMode: settings.leaveTrackerMode }
      : {}),
    ...(settings.enableAnniversaryLeave !== undefined
      ? { enableAnniversaryLeave: settings.enableAnniversaryLeave }
      : {}),
    ...(settings.anniversaryLeaveMaxDays !== undefined
      ? { anniversaryLeaveMaxDays: settings.anniversaryLeaveMaxDays }
      : {}),
    ...(settings.maxConvertibleLeaveDays !== undefined
      ? { maxConvertibleLeaveDays: settings.maxConvertibleLeaveDays }
      : {}),
    ...(settings.annualSil !== undefined
      ? { annualSil: settings.annualSil }
      : {}),
    ...(settings.grantLeaveUponRegularization !== undefined
      ? { grantLeaveUponRegularization: settings.grantLeaveUponRegularization }
      : {}),
    ...(settings.paidLeaveRequiresRegularization !== undefined
      ? {
          paidLeaveRequiresRegularization:
            settings.paidLeaveRequiresRegularization,
        }
      : {}),
    ...(settings.leaveGuidelines !== undefined
      ? { leaveGuidelines: settings.leaveGuidelines }
      : {}),
    ...(settings.leaveRequestFormTemplate !== undefined
      ? { leaveRequestFormTemplate: settings.leaveRequestFormTemplate }
      : {}),
    ...(settings.leaveRequestPdfLayout !== undefined
      ? { leaveRequestPdfLayout: settings.leaveRequestPdfLayout }
      : {}),
    sourceSettingsId: settings._id,
    migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
  };
}

async function processOrganizations(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
): Promise<{
  isDone: boolean;
  continueCursor: string;
  counters: MigrationCounters;
}> {
  const page = await ctx.db.query("settings").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const settings of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const settingsRows = await ctx.db
      .query("settings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", settings.organizationId),
      )
      .take(2);
    if (settingsRows.length > 1) {
      const issues: LeaveEmployeeMigrationIssue[] = [
        { code: "DUPLICATE_SETTINGS", field: "organizationId" },
      ];
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: settings.organizationId,
        entityType: "settings",
        entityId: settings._id,
        issues,
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const organization = await ctx.db.get(settings.organizationId);
    if (!organization) {
      const issues: LeaveEmployeeMigrationIssue[] = [
        { code: "SETTINGS_ORGANIZATION_NOT_FOUND", field: "organizationId" },
      ];
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: settings.organizationId,
        entityType: "settings",
        entityId: settings._id,
        issues,
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const projection = leaveSettingsProjection(settings);
    const rows = await ctx.db
      .query("organizationLeaveSettings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", settings.organizationId),
      )
      .take(2);
    const plan = planUniqueProjection({
      expected: projection,
      destinations: rows.map(stripDocumentMetadata),
      mismatchCode: "LEAVE_SETTINGS_MISMATCH",
      duplicateCode: "DUPLICATE_LEAVE_SETTINGS",
      field: "organizationId",
    });
    if (plan.outcome === "create" && !run.dryRun) {
      await ctx.db.insert("organizationLeaveSettings", {
        ...plan.value,
        createdAt: now,
        updatedAt: now,
      });
    } else if (plan.outcome === "conflict") {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: settings.organizationId,
        entityType: "settings",
        entityId: settings._id,
        issues: plan.issues,
        now,
      });
    }
    counters = addCounters(counters, countersForPlan(plan));
  }
  return { ...page, counters };
}

type EmbeddedLeaveType = NonNullable<Doc<"settings">["leaveTypes"]>[number];

function leaveTypeProjection(
  organizationId: Id<"organizations">,
  leaveType: EmbeddedLeaveType,
): Omit<
  Doc<"leaveTypes">,
  "_id" | "_creationTime" | "createdAt" | "updatedAt"
> {
  return {
    organizationId,
    sourceKey: normalizeMigrationSourceKey(leaveType.type),
    name: leaveType.name,
    maxDays: leaveType.defaultCredits,
    requiresApproval: leaveType.requiresApproval,
    isPaid: leaveType.isPaid,
    defaultCredits: leaveType.defaultCredits,
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
    migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
  };
}

async function processLeaveTypes(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
): Promise<{
  isDone: boolean;
  continueCursor: string;
  counters: MigrationCounters;
}> {
  const page = await ctx.db.query("settings").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const settings of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const seen = new Set<string>();
    for (const leaveType of settings.leaveTypes ?? []) {
      const projection = leaveTypeProjection(
        settings.organizationId,
        leaveType,
      );
      const sourceKey = projection.sourceKey!;
      if (seen.has(sourceKey)) {
        const issues: LeaveEmployeeMigrationIssue[] = [
          { code: "DUPLICATE_LEAVE_TYPE", field: "sourceKey" },
        ];
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: settings.organizationId,
          entityType: "leaveType",
          entityId: sourceKey,
          issues,
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      seen.add(sourceKey);
      const rows = await ctx.db
        .query("leaveTypes")
        .withIndex("by_organization_source_key", (query) =>
          query
            .eq("organizationId", settings.organizationId)
            .eq("sourceKey", sourceKey),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        mismatchCode: "LEAVE_TYPE_MISMATCH",
        duplicateCode: "DUPLICATE_LEAVE_TYPE",
        field: "sourceKey",
      });
      if (plan.outcome === "create" && !run.dryRun) {
        await ctx.db.insert("leaveTypes", {
          ...plan.value,
          createdAt: now,
          updatedAt: now,
        });
      } else if (plan.outcome === "conflict") {
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: settings.organizationId,
          entityType: "leaveType",
          entityId: sourceKey,
          issues: plan.issues,
          now,
        });
      }
      counters = addCounters(counters, countersForPlan(plan));
    }
  }
  return { ...page, counters };
}

async function applyEmployeePlan<T>(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    plan: ProjectionPlan<T>;
    write: (value: T, now: number) => Promise<unknown>;
    now: number;
  },
): Promise<Partial<MigrationCounters>> {
  if (args.plan.outcome === "create" && !run.dryRun) {
    await args.write(args.plan.value, args.now);
  } else if (args.plan.outcome === "conflict") {
    await recordIssues(ctx, {
      runId: run._id,
      organizationId: args.organizationId,
      entityType: "employee",
      entityId: args.employeeId,
      issues: args.plan.issues,
      now: args.now,
    });
  }
  return countersForPlan(args.plan);
}

async function processEmployeeChildren(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
): Promise<{
  isDone: boolean;
  continueCursor: string;
  counters: MigrationCounters;
}> {
  const page = await ctx.db.query("employees").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const employee of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const duplicateSource = async (
      code: LeaveEmployeeMigrationIssue["code"],
      field: string,
    ) => {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        issues: [{ code, field }],
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
    };
    const requirementKeys = new Map<string, number>();
    for (const requirement of employee.requirements ?? []) {
      const baseKey = normalizeMigrationSourceKey(requirement.type);
      const sequence = requirementKeys.get(baseKey) ?? 0;
      requirementKeys.set(baseKey, sequence + 1);
      const sourceKey = `${baseKey}:${sequence}`;
      const definitions = await ctx.db
        .query("organizationRequirementDefinitions")
        .withIndex("by_organization_normalized_type", (query) =>
          query
            .eq("organizationId", employee.organizationId)
            .eq("normalizedType", baseKey),
        )
        .take(2);
      if (definitions.length > 1) {
        const issues: LeaveEmployeeMigrationIssue[] = [
          { code: "DUPLICATE_REQUIREMENT_DEFINITION", field: "type" },
        ];
        await recordIssues(ctx, {
          runId: run._id,
          organizationId: employee.organizationId,
          entityType: "employee",
          entityId: employee._id,
          issues,
          now,
        });
        counters = addCounters(counters, { conflicts: 1 });
        continue;
      }
      const projection = {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        ...(definitions[0]
          ? { requirementDefinitionId: definitions[0]._id }
          : {}),
        sourceKey,
        ...requirement,
        migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      };
      const destinations = await ctx.db
        .query("employeeRequirements")
        .withIndex("by_employee_source_key", (query) =>
          query.eq("employeeId", employee._id).eq("sourceKey", sourceKey),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: destinations.map(stripDocumentMetadata),
        mismatchCode: "REQUIREMENT_MISMATCH",
        duplicateCode: "DUPLICATE_REQUIREMENT",
        field: "sourceKey",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) =>
            ctx.db.insert("employeeRequirements", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const deductionIds = new Set<string>();
    for (const deduction of employee.deductions ?? []) {
      if (deductionIds.has(deduction.id)) {
        await duplicateSource("DUPLICATE_DEDUCTION", "sourceId");
        continue;
      }
      deductionIds.add(deduction.id);
      const projection = {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        sourceId: deduction.id,
        type: deduction.type,
        name: deduction.name,
        amount: deduction.amount,
        frequency: deduction.frequency,
        startDate: deduction.startDate,
        ...(deduction.endDate !== undefined
          ? { endDate: deduction.endDate }
          : {}),
        isActive: deduction.isActive,
        migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("employeeDeductions")
        .withIndex("by_employee_source_id", (query) =>
          query.eq("employeeId", employee._id).eq("sourceId", deduction.id),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        mismatchCode: "DEDUCTION_MISMATCH",
        duplicateCode: "DUPLICATE_DEDUCTION",
        field: "sourceId",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) =>
            ctx.db.insert("employeeDeductions", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const incentiveIds = new Set<string>();
    for (const incentive of employee.incentives ?? []) {
      if (incentiveIds.has(incentive.id)) {
        await duplicateSource("DUPLICATE_INCENTIVE", "sourceId");
        continue;
      }
      incentiveIds.add(incentive.id);
      const projection = {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        sourceId: incentive.id,
        name: incentive.name,
        amount: incentive.amount,
        frequency: incentive.frequency,
        isActive: incentive.isActive,
        migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("employeeIncentives")
        .withIndex("by_employee_source_id", (query) =>
          query.eq("employeeId", employee._id).eq("sourceId", incentive.id),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        mismatchCode: "INCENTIVE_MISMATCH",
        duplicateCode: "DUPLICATE_INCENTIVE",
        field: "sourceId",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) =>
            ctx.db.insert("employeeIncentives", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const overrideDates = new Set<number>();
    for (const override of employee.schedule.scheduleOverrides ?? []) {
      if (overrideDates.has(override.date)) {
        await duplicateSource("DUPLICATE_SCHEDULE_OVERRIDE", "date");
        continue;
      }
      overrideDates.add(override.date);
      const projection = {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        ...override,
        migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("employeeScheduleOverrides")
        .withIndex("by_employee_date", (query) =>
          query.eq("employeeId", employee._id).eq("date", override.date),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        mismatchCode: "SCHEDULE_OVERRIDE_MISMATCH",
        duplicateCode: "DUPLICATE_SCHEDULE_OVERRIDE",
        field: "date",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) =>
            ctx.db.insert("employeeScheduleOverrides", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    const bank = employee.compensation.bankDetails;
    if (bank) {
      const projection = {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        ...bank,
        migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("employeePaymentAccounts")
        .withIndex("by_employee", (query) =>
          query.eq("employeeId", employee._id),
        )
        .take(2);
      const plan = planUniqueProjection({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        mismatchCode: "PAYMENT_ACCOUNT_MISMATCH",
        duplicateCode: "DUPLICATE_PAYMENT_ACCOUNT",
        field: "employeeId",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) =>
            ctx.db.insert("employeePaymentAccounts", {
              ...value,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          now,
        }),
      );
    }

    if (
      employee.customFields &&
      typeof employee.customFields === "object" &&
      !Array.isArray(employee.customFields)
    ) {
      const customFieldKeys = new Set<string>();
      for (const [sourceKey, rawValue] of Object.entries(
        employee.customFields as Record<string, unknown>,
      )) {
        let custom;
        try {
          custom = buildCustomFieldProjection(sourceKey, rawValue);
        } catch {
          const issues: LeaveEmployeeMigrationIssue[] = [
            { code: "CUSTOM_FIELD_VALUE_UNSUPPORTED", field: "customFields" },
          ];
          await recordIssues(ctx, {
            runId: run._id,
            organizationId: employee.organizationId,
            entityType: "employee",
            entityId: employee._id,
            issues,
            now,
          });
          counters = addCounters(counters, { conflicts: 1 });
          continue;
        }
        const normalizedKey = normalizeMigrationSourceKey(custom.sourceKey);
        if (customFieldKeys.has(normalizedKey)) {
          await duplicateSource("DUPLICATE_CUSTOM_FIELD_VALUE", "sourceKey");
          continue;
        }
        customFieldKeys.add(normalizedKey);
        const definitionProjection = {
          organizationId: employee.organizationId,
          entityType: "employee" as const,
          sourceKey: normalizedKey,
          label: normalizedKey,
          valueType: "mixed" as const,
          isActive: true,
          migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
        };
        const definitions = await ctx.db
          .query("organizationCustomFieldDefinitions")
          .withIndex("by_organization_entity_key", (query) =>
            query
              .eq("organizationId", employee.organizationId)
              .eq("entityType", "employee")
              .eq("sourceKey", normalizedKey),
          )
          .take(2);
        const definitionPlan = planUniqueProjection({
          expected: definitionProjection,
          destinations: definitions.map(stripDocumentMetadata),
          mismatchCode: "CUSTOM_FIELD_DEFINITION_MISMATCH",
          duplicateCode: "DUPLICATE_CUSTOM_FIELD_DEFINITION",
          field: "sourceKey",
        });
        const values = await ctx.db
          .query("employeeCustomFieldValues")
          .withIndex("by_employee_source_key", (query) =>
            query.eq("employeeId", employee._id).eq("sourceKey", normalizedKey),
          )
          .take(2);
        let definitionId = definitions[0]?._id;
        if (definitionPlan.outcome === "create" && !run.dryRun) {
          definitionId = await ctx.db.insert(
            "organizationCustomFieldDefinitions",
            {
              ...definitionPlan.value,
              createdAt: now,
              updatedAt: now,
            },
          );
        } else if (definitionPlan.outcome === "conflict") {
          await recordIssues(ctx, {
            runId: run._id,
            organizationId: employee.organizationId,
            entityType: "employee",
            entityId: employee._id,
            issues: definitionPlan.issues,
            now,
          });
        }
        counters = addCounters(counters, countersForPlan(definitionPlan));
        if (definitionPlan.outcome === "conflict") continue;
        if (!definitionId && run.dryRun) {
          if (values.length > 0) {
            const issues: LeaveEmployeeMigrationIssue[] = [
              {
                code:
                  values.length > 1
                    ? "DUPLICATE_CUSTOM_FIELD_VALUE"
                    : "CUSTOM_FIELD_VALUE_MISMATCH",
                field: "sourceKey",
              },
            ];
            await recordIssues(ctx, {
              runId: run._id,
              organizationId: employee.organizationId,
              entityType: "employee",
              entityId: employee._id,
              issues,
              now,
            });
            counters = addCounters(counters, { conflicts: 1 });
          } else {
            counters = addCounters(counters, { changed: 1 });
          }
          continue;
        }
        const valueProjection = {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          definitionId: definitionId!,
          sourceKey: normalizedKey,
          valueType: custom.valueType,
          valueJson: custom.valueJson,
          migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
        };
        const valuePlan = planUniqueProjection({
          expected: valueProjection,
          destinations: values.map(stripDocumentMetadata),
          mismatchCode: "CUSTOM_FIELD_VALUE_MISMATCH",
          duplicateCode: "DUPLICATE_CUSTOM_FIELD_VALUE",
          field: "sourceKey",
        });
        counters = addCounters(
          counters,
          await applyEmployeePlan(ctx, run, {
            organizationId: employee.organizationId,
            employeeId: employee._id,
            plan: valuePlan,
            write: (value, timestamp) =>
              ctx.db.insert("employeeCustomFieldValues", {
                ...value,
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            now,
          }),
        );
      }
    }
  }
  return { ...page, counters };
}

function yearManila(timestamp: number): number {
  return getManilaDateParts(timestamp).year;
}

function leaveTypeKey(request: Doc<"leaveRequests">): string {
  return request.leaveType === "custom"
    ? normalizeMigrationSourceKey(request.customLeaveType ?? "custom")
    : request.leaveType;
}

async function approvedDaysByType(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  year: number,
): Promise<Map<string, number> | LeaveEmployeeMigrationIssue> {
  const requests = await ctx.db
    .query("leaveRequests")
    .withIndex("by_employee", (query) => query.eq("employeeId", employee._id))
    .take(MAX_APPROVED_REQUESTS_PER_EMPLOYEE_YEAR + 1);
  if (requests.length > MAX_APPROVED_REQUESTS_PER_EMPLOYEE_YEAR) {
    return {
      code: "APPROVED_LEAVE_SCAN_LIMIT_EXCEEDED",
      field: "leaveRequests",
    };
  }
  const result = new Map<string, number>();
  for (const request of requests) {
    if (request.organizationId !== employee.organizationId) {
      return {
        code: "APPROVED_LEAVE_ORGANIZATION_MISMATCH",
        field: "organizationId",
      };
    }
    if (
      request.status !== "approved" ||
      request.isPaid === false ||
      yearManila(request.startDate) !== year
    ) {
      continue;
    }
    const key = leaveTypeKey(request);
    result.set(key, (result.get(key) ?? 0) + request.numberOfDays);
  }
  return result;
}

function employeeCreditProjections(
  employee: Doc<"employees">,
  year: number,
  approved: Map<string, number>,
  mode: "general" | "by_type",
): LeaveBalanceProjection[] {
  const credits = employee.leaveCredits;
  if (!credits) return [];
  const entries = [
    ["vacation", credits.vacation],
    ["sick", credits.sick],
    ...(credits.custom ?? []).map(
      (credit) => [normalizeMigrationSourceKey(credit.type), credit] as const,
    ),
  ] as const;
  return entries.map(([key, credit]) => {
    const reconcilesIndividually =
      mode === "by_type" || (key !== "vacation" && key !== "sick");
    const approvedDays = reconcilesIndividually ? (approved.get(key) ?? 0) : 0;
    return {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      year,
      leaveTypeKey: key,
      total: credit.total,
      used: credit.used,
      balance: credit.balance,
      source: "employee_credits",
      approvedDays,
      reconciliationStatus: reconcilesIndividually
        ? credit.used === approvedDays
          ? "matching"
          : "mismatched"
        : "not_applicable",
      migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
    };
  });
}

async function processBalances(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
): Promise<{
  isDone: boolean;
  continueCursor: string;
  counters: MigrationCounters;
}> {
  const page = await ctx.db.query("employees").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  const currentYear = getManilaDateParts(run.startedAt).year;

  for (const employee of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const approvedResult = await approvedDaysByType(ctx, employee, currentYear);
    if (!(approvedResult instanceof Map)) {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        issues: [approvedResult],
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const settingsRows = await ctx.db
      .query("settings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", employee.organizationId),
      )
      .take(2);
    if (settingsRows.length > 1) {
      const issues: LeaveEmployeeMigrationIssue[] = [
        { code: "DUPLICATE_SETTINGS", field: "organizationId" },
      ];
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        issues,
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
      continue;
    }
    const settings = settingsRows[0];
    const leaveTrackerMode = settings?.leaveTrackerMode ?? "general";
    const creditEntries = [
      ...(employee.leaveCredits
        ? [
            { key: "vacation", used: employee.leaveCredits.vacation.used },
            { key: "sick", used: employee.leaveCredits.sick.used },
            ...(employee.leaveCredits.custom ?? []).map((credit) => ({
              key: normalizeMigrationSourceKey(credit.type),
              used: credit.used,
            })),
          ]
        : []),
    ];
    const reconciliationIssues = reconcileLeaveCreditUsage({
      mode: leaveTrackerMode,
      credits: creditEntries,
      approvedDays: approvedResult,
      generalKey: normalizeMigrationSourceKey(GENERAL_LEAVE_CREDIT_KEY),
    });
    let projections: LeaveBalanceProjection[] = [];
    if (reconciliationIssues.length > 0) {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        issues: reconciliationIssues,
        now,
      });
      counters = addCounters(counters, { conflicts: 1 });
    } else {
      projections = employeeCreditProjections(
        employee,
        currentYear,
        approvedResult,
        leaveTrackerMode,
      );
    }
    if (settings) {
      const trackers = [
        ...(settings.leaveTrackerRows?.some(
          (row) => row.employeeId === employee._id,
        )
          ? [
              {
                year: currentYear,
                row: settings.leaveTrackerRows.find(
                  (row) => row.employeeId === employee._id,
                )!,
                source: "legacy_tracker" as const,
                overrideReason: undefined,
                updatedBy: undefined,
              },
            ]
          : []),
        ...(settings.leaveTrackerByYear ?? []).flatMap((entry) =>
          entry.rows
            .filter((row) => row.employeeId === employee._id)
            .map((row) => ({
              year: entry.year,
              row,
              source: "yearly_tracker" as const,
              overrideReason: entry.overrideReason,
              updatedBy: entry.updatedBy,
            })),
        ),
      ];
      const seenYears = new Set<number>();
      for (const tracker of trackers) {
        if (seenYears.has(tracker.year)) {
          const issues: LeaveEmployeeMigrationIssue[] = [
            { code: "DUPLICATE_LEGACY_TRACKER_ROW", field: "year" },
          ];
          await recordIssues(ctx, {
            runId: run._id,
            organizationId: employee.organizationId,
            entityType: "employee",
            entityId: employee._id,
            issues,
            now,
          });
          counters = addCounters(counters, { conflicts: 1 });
          continue;
        }
        seenYears.add(tracker.year);
        const total = tracker.row.annualSilOverride ?? settings.annualSil ?? 0;
        const used = tracker.row.availed ?? 0;
        projections.push({
          organizationId: employee.organizationId,
          employeeId: employee._id,
          year: tracker.year,
          leaveTypeKey: "general",
          total,
          used,
          balance: total - used,
          source: tracker.source,
          ...(tracker.row.annualSilOverride !== undefined
            ? { annualSilOverride: tracker.row.annualSilOverride }
            : {}),
          ...(tracker.overrideReason !== undefined
            ? { overrideReason: tracker.overrideReason }
            : {}),
          ...(tracker.updatedBy !== undefined
            ? { updatedBy: tracker.updatedBy }
            : {}),
          approvedDays: 0,
          reconciliationStatus: "not_applicable",
          migrationVersion: LEAVE_EMPLOYEE_MIGRATION_VERSION,
        });
      }
    }
    for (const projection of projections) {
      const rows = await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_employee_year_type", (query) =>
          query
            .eq("employeeId", employee._id)
            .eq("year", projection.year)
            .eq("leaveTypeKey", projection.leaveTypeKey),
        )
        .take(2);
      const plan = planLeaveBalance({
        expected: projection,
        destinations: rows.map(stripDocumentMetadata),
        reconcileUsage:
          projection.source === "employee_credits" &&
          projection.reconciliationStatus !== "not_applicable",
      });
      counters = addCounters(
        counters,
        await applyEmployeePlan(ctx, run, {
          organizationId: employee.organizationId,
          employeeId: employee._id,
          plan,
          write: (value, timestamp) => {
            const { organizationId, employeeId, updatedBy, ...balance } = value;
            return ctx.db.insert("employeeLeaveBalances", {
              ...balance,
              organizationId: organizationId as Id<"organizations">,
              employeeId: employeeId as Id<"employees">,
              ...(updatedBy ? { updatedBy: updatedBy as Id<"users"> } : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          },
          now,
        }),
      );
    }
  }
  return { ...page, counters };
}

async function processPhase(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: LeaveEmployeePhase },
) {
  switch (run.phase) {
    case "leave_organizations":
      return processOrganizations(ctx, run);
    case "leave_types":
      return processLeaveTypes(ctx, run);
    case "employee_children":
      return processEmployeeChildren(ctx, run);
    case "leave_balances":
      return processBalances(ctx, run);
  }
}

export const startLeaveEmployeeMigration = internalMutation({
  args: {
    dryRun: v.boolean(),
    dryRunId: v.optional(v.id("migrationRuns")),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      throw new Error("Batch size must be between 1 and 50");
    }
    const active = [
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query.eq("key", LEAVE_EMPLOYEE_MIGRATION_KEY).eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query.eq("key", LEAVE_EMPLOYEE_MIGRATION_KEY).eq("status", "running"),
        )
        .take(1)),
    ];
    if (active.length > 0) {
      throw new Error("A leave employee migration is already active");
    }
    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (
        !dryRun ||
        dryRun.key !== LEAVE_EMPLOYEE_MIGRATION_KEY ||
        dryRun.version !== LEAVE_EMPLOYEE_MIGRATION_VERSION ||
        !dryRun.dryRun ||
        dryRun.status !== "completed" ||
        dryRun.counters.conflicts > 0 ||
        dryRun.counters.errors > 0
      ) {
        throw new Error("Conflict-free completed dry-run is required");
      }
      requiredDryRunId = dryRun._id;
    }
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: LEAVE_EMPLOYEE_MIGRATION_KEY,
      version: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "leave_organizations",
      batchSize,
      counters: EMPTY_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueMigrationReference, { runId });
    return {
      runId,
      key: LEAVE_EMPLOYEE_MIGRATION_KEY,
      version: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      dryRun: args.dryRun,
    };
  },
});

export const processLeaveEmployeeMigrationBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      return { done: true };
    }
    if (run.status === "queued") {
      await ctx.db.patch(run._id, { status: "running", updatedAt: Date.now() });
    }
    const result = await processPhase(ctx, run);
    const now = Date.now();
    if (!result.isDone) {
      await ctx.db.patch(run._id, {
        status: "running",
        cursor: result.continueCursor,
        counters: result.counters,
        updatedAt: now,
      });
      return { done: false };
    }
    const followingPhase = nextPhase(run.phase);
    if (followingPhase) {
      await ctx.db.patch(run._id, {
        status: "running",
        phase: followingPhase,
        cursor: undefined,
        counters: result.counters,
        updatedAt: now,
      });
      return { done: false };
    }
    await ctx.db.patch(run._id, {
      status: "completed",
      cursor: undefined,
      counters: result.counters,
      updatedAt: now,
      completedAt: now,
    });
    return { done: true };
  },
});

export const continueLeaveEmployeeMigration = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const result = await ctx.runMutation(processBatchReference, args);
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueMigrationReference, args);
      }
      return { done: result.done };
    } catch {
      await ctx.runMutation(failMigrationReference, {
        runId: args.runId,
        failureCode: "BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failLeaveEmployeeMigration = internalMutation({
  args: { runId: v.id("migrationRuns"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== LEAVE_EMPLOYEE_MIGRATION_KEY ||
      run.version !== LEAVE_EMPLOYEE_MIGRATION_VERSION ||
      run.status === "completed" ||
      run.status === "failed"
    ) {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "failed",
      failureCode: args.failureCode,
      counters: addCounters(run.counters, { errors: 1 }),
      updatedAt: now,
      completedAt: now,
    });
  },
});

export const getLeaveEmployeeMigrationRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const issues = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .take(MAX_STATUS_ISSUES + 1);
    return {
      run,
      issues: issues
        .slice(0, MAX_STATUS_ISSUES)
        .map(
          ({
            code,
            field,
            entityType,
            entityId,
            organizationId,
            createdAt,
          }) => ({
            code,
            field,
            entityType,
            entityId,
            organizationId,
            createdAt,
          }),
        ),
      issuesTruncated: issues.length > MAX_STATUS_ISSUES,
      canStartWrite:
        run.dryRun &&
        run.status === "completed" &&
        run.counters.conflicts === 0 &&
        run.counters.errors === 0,
    };
  },
});

export const listLeaveEmployeeMigrationIssues = internalQuery({
  args: {
    runId: v.id("migrationRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (query) => query.eq("runId", run._id))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(
        ({ code, field, entityType, entityId, organizationId, createdAt }) => ({
          code,
          field,
          entityType,
          entityId,
          organizationId,
          createdAt,
        }),
      ),
    };
  },
});

export const resumeLeaveEmployeeMigration = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Only an active leave employee migration can resume");
    }
    if (Date.now() - run.updatedAt < STALE_RUN_MILLISECONDS) {
      throw new Error("Leave employee migration is not stale");
    }
    await ctx.scheduler.runAfter(0, continueMigrationReference, {
      runId: run._id,
    });
    return { resumed: true, runId: run._id };
  },
});

type LeaveEmployeeAuditPhase =
  | "leave_source_verification"
  | "leave_target_settings"
  | "leave_target_types"
  | "leave_target_requirements"
  | "leave_target_deductions"
  | "leave_target_incentives"
  | "leave_target_overrides"
  | "leave_target_payments"
  | "leave_target_definitions"
  | "leave_target_values"
  | "leave_target_balances";

const LEAVE_AUDIT_PHASES: readonly LeaveEmployeeAuditPhase[] = [
  "leave_source_verification",
  "leave_target_settings",
  "leave_target_types",
  "leave_target_requirements",
  "leave_target_deductions",
  "leave_target_incentives",
  "leave_target_overrides",
  "leave_target_payments",
  "leave_target_definitions",
  "leave_target_values",
  "leave_target_balances",
];

function isLeaveEmployeeAuditPhase(
  phase: Doc<"migrationAudits">["phase"],
): phase is LeaveEmployeeAuditPhase {
  return LEAVE_AUDIT_PHASES.includes(phase as LeaveEmployeeAuditPhase);
}

function nextLeaveAuditPhase(
  phase: LeaveEmployeeAuditPhase,
): LeaveEmployeeAuditPhase | null {
  const index = LEAVE_AUDIT_PHASES.indexOf(phase);
  return LEAVE_AUDIT_PHASES[index + 1] ?? null;
}

async function getLatestLeaveAudit(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (query) => query.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

async function recordUnexpectedAuditRow(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    auditId: Id<"migrationAudits">;
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    field: string;
    now: number;
  },
): Promise<void> {
  await recordIssues(ctx, {
    runId: args.runId,
    auditId: args.auditId,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    issues: [{ code: "UNEXPECTED_DESTINATION_ROW", field: args.field }],
    now: args.now,
  });
}

type AuditPageResult = {
  isDone: boolean;
  continueCursor: string;
  destination: Doc<"migrationAudits">["destination"];
  sourceConflicts: number;
};

async function auditVerificationIssues(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
): Promise<AuditPageResult> {
  if (!audit.verificationRunId)
    throw new Error("Audit verification run is missing");
  const page = await ctx.db
    .query("migrationIssues")
    .withIndex("by_run", (query) => query.eq("runId", audit.verificationRunId!))
    .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  for (const issue of page.page) {
    sourceConflicts += 1;
    if (issue.code.startsWith("DUPLICATE_")) destination.duplicate += 1;
    if (
      issue.code.includes("MISMATCH") &&
      !issue.code.includes("RECONCILIATION")
    ) {
      destination.mismatched += 1;
    }
    await ctx.db.insert("migrationIssues", {
      runId: run._id,
      auditId: audit._id,
      ...(issue.organizationId ? { organizationId: issue.organizationId } : {}),
      entityType: issue.entityType,
      ...(issue.entityId ? { entityId: issue.entityId } : {}),
      field: issue.field,
      code: issue.code,
      createdAt: issue.createdAt,
    });
  }
  return { ...page, destination, sourceConflicts };
}

async function auditTargetSettings(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
): Promise<AuditPageResult> {
  const page = await ctx.db.query("organizationLeaveSettings").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  const initialUnexpected = destination.unexpected;
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();
  for (const row of page.page) {
    destination.totalRows += 1;
    const settings = row.sourceSettingsId
      ? await ctx.db.get(row.sourceSettingsId)
      : null;
    if (!settings || settings.organizationId !== row.organizationId) {
      destination.unexpected += 1;
      sourceConflicts += 1;
      await recordUnexpectedAuditRow(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: row.organizationId,
        entityType: "leaveSettings",
        entityId: row._id,
        field: "sourceSettingsId",
        now,
      });
    }
  }
  destination.matching +=
    page.page.length - (destination.unexpected - initialUnexpected);
  return { ...page, destination, sourceConflicts };
}

async function auditTargetLeaveTypes(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
): Promise<AuditPageResult> {
  const page = await ctx.db.query("leaveTypes").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  const initialTotalRows = destination.totalRows;
  const initialUnexpected = destination.unexpected;
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();
  for (const row of page.page) {
    if (
      !row.sourceKey ||
      row.migrationVersion !== LEAVE_EMPLOYEE_MIGRATION_VERSION
    ) {
      continue;
    }
    destination.totalRows += 1;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_organization", (query) =>
        query.eq("organizationId", row.organizationId),
      )
      .take(2);
    const exists =
      settings.length === 1 &&
      (settings[0].leaveTypes ?? []).some(
        (source) => normalizeMigrationSourceKey(source.type) === row.sourceKey,
      );
    if (!exists) {
      destination.unexpected += 1;
      sourceConflicts += 1;
      await recordUnexpectedAuditRow(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: row.organizationId,
        entityType: "leaveType",
        entityId: row._id,
        field: "sourceKey",
        now,
      });
    }
  }
  destination.matching +=
    destination.totalRows -
    initialTotalRows -
    (destination.unexpected - initialUnexpected);
  return { ...page, destination, sourceConflicts };
}

function requirementSourceKeys(employee: Doc<"employees">): Set<string> {
  const counts = new Map<string, number>();
  return new Set(
    (employee.requirements ?? []).map((requirement) => {
      const base = normalizeMigrationSourceKey(requirement.type);
      const sequence = counts.get(base) ?? 0;
      counts.set(base, sequence + 1);
      return `${base}:${sequence}`;
    }),
  );
}

async function auditEmployeeChildTarget(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
): Promise<AuditPageResult> {
  const destination = { ...audit.destination };
  const initialTotalRows = destination.totalRows;
  const initialUnexpected = destination.unexpected;
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();
  const mark = async (args: {
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    field: string;
  }) => {
    destination.unexpected += 1;
    sourceConflicts += 1;
    await recordUnexpectedAuditRow(ctx, {
      runId: run._id,
      auditId: audit._id,
      ...args,
      now,
    });
  };
  const finishPage = <T extends { isDone: boolean; continueCursor: string }>(
    page: T,
  ): T & {
    destination: Doc<"migrationAudits">["destination"];
    sourceConflicts: number;
  } => {
    destination.matching +=
      destination.totalRows -
      initialTotalRows -
      (destination.unexpected - initialUnexpected);
    return { ...page, destination, sourceConflicts };
  };

  switch (audit.phase) {
    case "leave_target_requirements": {
      const page = await ctx.db.query("employeeRequirements").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        if (
          !employee ||
          employee.organizationId !== row.organizationId ||
          !requirementSourceKeys(employee).has(row.sourceKey)
        ) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeRequirement",
            entityId: row._id,
            field: "sourceKey",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_deductions": {
      const page = await ctx.db.query("employeeDeductions").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        if (
          !employee ||
          employee.organizationId !== row.organizationId ||
          !(employee.deductions ?? []).some(({ id }) => id === row.sourceId)
        ) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeDeduction",
            entityId: row._id,
            field: "sourceId",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_incentives": {
      const page = await ctx.db.query("employeeIncentives").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        if (
          !employee ||
          employee.organizationId !== row.organizationId ||
          !(employee.incentives ?? []).some(({ id }) => id === row.sourceId)
        ) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeIncentive",
            entityId: row._id,
            field: "sourceId",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_overrides": {
      const page = await ctx.db.query("employeeScheduleOverrides").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        if (
          !employee ||
          employee.organizationId !== row.organizationId ||
          !(employee.schedule.scheduleOverrides ?? []).some(
            ({ date }) => date === row.date,
          )
        ) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeScheduleOverride",
            entityId: row._id,
            field: "date",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_payments": {
      const page = await ctx.db.query("employeePaymentAccounts").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        if (
          !employee ||
          employee.organizationId !== row.organizationId ||
          !employee.compensation.bankDetails
        ) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeePaymentAccount",
            entityId: row._id,
            field: "employeeId",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_definitions": {
      const page = await ctx.db
        .query("organizationCustomFieldDefinitions")
        .paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      for (const row of page.page) {
        destination.totalRows += 1;
        const value = await ctx.db
          .query("employeeCustomFieldValues")
          .withIndex("by_definition", (query) =>
            query.eq("definitionId", row._id),
          )
          .first();
        const employee = value ? await ctx.db.get(value.employeeId) : null;
        const customFields =
          employee?.customFields &&
          typeof employee.customFields === "object" &&
          !Array.isArray(employee.customFields)
            ? (employee.customFields as Record<string, unknown>)
            : null;
        const exists =
          employee?.organizationId === row.organizationId &&
          value?.organizationId === row.organizationId &&
          value?.sourceKey === row.sourceKey &&
          customFields !== null &&
          Object.keys(customFields).some(
            (key) => normalizeMigrationSourceKey(key) === row.sourceKey,
          );
        if (!exists) {
          await mark({
            organizationId: row.organizationId,
            entityType: "customFieldDefinition",
            entityId: row._id,
            field: "sourceKey",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_values": {
      const page = await ctx.db.query("employeeCustomFieldValues").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const [employee, definition] = await Promise.all([
          ctx.db.get(row.employeeId),
          ctx.db.get(row.definitionId),
        ]);
        const customFields =
          employee?.customFields &&
          typeof employee.customFields === "object" &&
          !Array.isArray(employee.customFields)
            ? (employee.customFields as Record<string, unknown>)
            : null;
        const exists =
          employee?.organizationId === row.organizationId &&
          definition?.organizationId === row.organizationId &&
          definition.sourceKey === row.sourceKey &&
          customFields !== null &&
          Object.keys(customFields).some(
            (key) => normalizeMigrationSourceKey(key) === row.sourceKey,
          );
        if (!exists) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeCustomFieldValue",
            entityId: row._id,
            field: "sourceKey",
          });
        }
      }
      return finishPage(page);
    }
    case "leave_target_balances": {
      const page = await ctx.db.query("employeeLeaveBalances").paginate({
        cursor: audit.cursor ?? null,
        numItems: audit.batchSize,
      });
      for (const row of page.page) {
        destination.totalRows += 1;
        const employee = await ctx.db.get(row.employeeId);
        let exists = employee?.organizationId === row.organizationId;
        if (exists && row.source === "employee_credits") {
          const keys = new Set([
            "vacation",
            "sick",
            ...(employee?.leaveCredits?.custom ?? []).map(({ type }) =>
              normalizeMigrationSourceKey(type),
            ),
          ]);
          exists =
            row.year === getManilaDateParts(audit.startedAt).year &&
            Boolean(employee?.leaveCredits) &&
            keys.has(row.leaveTypeKey);
        } else if (exists) {
          const settings = await ctx.db
            .query("settings")
            .withIndex("by_organization", (query) =>
              query.eq("organizationId", row.organizationId),
            )
            .take(2);
          exists =
            settings.length === 1 &&
            (row.source === "legacy_tracker"
              ? row.year === getManilaDateParts(audit.startedAt).year &&
                Boolean(
                  settings[0].leaveTrackerRows?.some(
                    ({ employeeId }) => employeeId === row.employeeId,
                  ),
                )
              : Boolean(
                  settings[0].leaveTrackerByYear?.some(
                    (entry) =>
                      entry.year === row.year &&
                      entry.rows.some(
                        ({ employeeId }) => employeeId === row.employeeId,
                      ),
                  ),
                ));
        }
        if (!exists) {
          await mark({
            organizationId: row.organizationId,
            entityType: "employeeLeaveBalance",
            entityId: row._id,
            field: "leaveTypeKey",
          });
        }
      }
      return finishPage(page);
    }
    default:
      throw new Error("Unsupported leave employee audit phase");
  }
}

async function runLeaveAuditBatch(
  ctx: MutationCtx,
  auditId: Id<"migrationAudits">,
): Promise<{ done: boolean }> {
  const audit = await ctx.db.get(auditId);
  if (!audit || !isLeaveEmployeeAuditPhase(audit.phase)) {
    throw new Error("Leave employee audit was not found");
  }
  if (audit.status !== "running") {
    throw new Error("Leave employee audit is not active");
  }
  const run = await ctx.db.get(audit.migrationRunId);
  assertRun(run);
  const page =
    audit.phase === "leave_source_verification"
      ? await auditVerificationIssues(ctx, audit, run)
      : audit.phase === "leave_target_settings"
        ? await auditTargetSettings(ctx, audit, run)
        : audit.phase === "leave_target_types"
          ? await auditTargetLeaveTypes(ctx, audit, run)
          : await auditEmployeeChildTarget(ctx, audit, run);
  const now = Date.now();
  if (!page.isDone) {
    await ctx.db.patch(audit._id, {
      cursor: page.continueCursor,
      destination: page.destination,
      sourceConflicts: page.sourceConflicts,
      updatedAt: now,
    });
    return { done: false };
  }
  const nextPhase = nextLeaveAuditPhase(audit.phase);
  if (nextPhase) {
    await ctx.db.patch(audit._id, {
      phase: nextPhase,
      cursor: undefined,
      destination: page.destination,
      sourceConflicts: page.sourceConflicts,
      updatedAt: now,
    });
    return { done: false };
  }
  await ctx.db.patch(audit._id, {
    status: "completed",
    cursor: undefined,
    destination: {
      ...page.destination,
      expected: page.destination.matching + page.destination.missing,
    },
    sourceConflicts: page.sourceConflicts,
    updatedAt: now,
    completedAt: now,
  });
  return { done: true };
}

const continueAuditReference = makeFunctionReference<
  "action",
  { auditId: Id<"migrationAudits"> }
>("leaveEmployeeMigrations:continueLeaveEmployeeAudit");
const getAuditStateReference = makeFunctionReference<
  "query",
  { auditId: Id<"migrationAudits"> },
  {
    status: Doc<"migrationAudits">["status"];
    phase: Doc<"migrationAudits">["phase"];
    verificationRunId?: Id<"migrationRuns">;
  }
>("leaveEmployeeMigrations:getLeaveEmployeeAuditState");
const prepareAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> }
>("leaveEmployeeMigrations:prepareLeaveEmployeeAudit");
const processAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> },
  { done: boolean }
>("leaveEmployeeMigrations:processLeaveEmployeeAuditBatch");
const failAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("leaveEmployeeMigrations:failLeaveEmployeeAudit");

export const startLeaveEmployeeAudit = internalMutation({
  args: { runId: v.id("migrationRuns"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
      throw new Error("Audit batch size must be between 1 and 10");
    }
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const existing = await getLatestLeaveAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") {
      throw new Error("Leave employee audit is already active");
    }
    const now = Date.now();
    const verificationRunId = await ctx.db.insert("migrationRuns", {
      key: LEAVE_EMPLOYEE_MIGRATION_KEY,
      version: LEAVE_EMPLOYEE_MIGRATION_VERSION,
      dryRun: true,
      status: "queued",
      phase: "leave_organizations",
      batchSize,
      counters: EMPTY_COUNTERS,
      startedAt: now,
      updatedAt: now,
    });
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      verificationRunId,
      status: "queued",
      phase: "leave_organizations",
      batchSize,
      organizations: 0,
      destination: {
        expected: 0,
        matching: 0,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 0,
      },
      duplicateLegacySettings: 0,
      sourceConflicts: 0,
      auditTruncated: false,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueAuditReference, { auditId });
    return { auditId, runId: run._id };
  },
});

export const getLeaveEmployeeAuditState = internalQuery({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Leave employee audit was not found");
    return {
      status: audit.status,
      phase: audit.phase,
      verificationRunId: audit.verificationRunId,
    };
  },
});

export const prepareLeaveEmployeeAudit = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit?.verificationRunId || audit.phase !== "leave_organizations") {
      throw new Error("Leave employee audit verification is not pending");
    }
    const verification = await ctx.db.get(audit.verificationRunId);
    assertRun(verification);
    if (verification.status !== "completed") {
      throw new Error("Leave employee audit verification is not completed");
    }
    await ctx.db.patch(audit._id, {
      status: "running",
      phase: "leave_source_verification",
      destination: {
        expected: 0,
        matching: 0,
        missing: verification.counters.changed,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 0,
      },
      updatedAt: Date.now(),
    });
  },
});

export const processLeaveEmployeeAuditBatch = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: (ctx, args) => runLeaveAuditBatch(ctx, args.auditId),
});

export const continueLeaveEmployeeAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const state = await ctx.runQuery(getAuditStateReference, args);
      if (state.status === "completed" || state.status === "failed") {
        return { done: true };
      }
      if (state.phase === "leave_organizations") {
        if (!state.verificationRunId) {
          throw new Error("Audit verification run is missing");
        }
        const result = await ctx.runMutation(processBatchReference, {
          runId: state.verificationRunId,
        });
        if (result.done) {
          await ctx.runMutation(prepareAuditReference, args);
        }
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
        return { done: false };
      }
      const result = await ctx.runMutation(processAuditReference, args);
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
      }
      return { done: result.done };
    } catch {
      await ctx.runMutation(failAuditReference, {
        auditId: args.auditId,
        failureCode: "AUDIT_BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failLeaveEmployeeAudit = internalMutation({
  args: { auditId: v.id("migrationAudits"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.status === "completed" || audit.status === "failed") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(audit._id, {
      status: "failed",
      failureCode: args.failureCode,
      updatedAt: now,
      completedAt: now,
    });
  },
});

export const resumeLeaveEmployeeAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await getLatestLeaveAudit(ctx, run._id);
    if (!audit) throw new Error("Leave employee audit was not found");
    if (audit.status === "completed") {
      throw new Error("Completed leave employee audit cannot resume");
    }
    if (
      audit.status !== "failed" &&
      Date.now() - audit.updatedAt < STALE_RUN_MILLISECONDS
    ) {
      throw new Error("Leave employee audit is not stale");
    }
    await ctx.db.patch(audit._id, {
      status: audit.phase === "leave_organizations" ? "queued" : "running",
      failureCode: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, continueAuditReference, {
      auditId: audit._id,
    });
    return { resumed: true, auditId: audit._id };
  },
});

export const getLeaveEmployeeAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await ctx.db
      .query("migrationAudits")
      .withIndex("by_run", (query) => query.eq("migrationRunId", run._id))
      .order("desc")
      .first();
    if (!audit) return { status: "not_started" as const, ready: false };
    const ready =
      audit.status === "completed" &&
      !audit.auditTruncated &&
      audit.sourceConflicts === 0 &&
      audit.destination.missing === 0 &&
      audit.destination.duplicate === 0 &&
      audit.destination.mismatched === 0 &&
      audit.destination.unexpected === 0 &&
      audit.destination.matching === audit.destination.expected &&
      audit.destination.totalRows === audit.destination.expected;
    return { ...audit, ready };
  },
});

export const listLeaveEmployeeAuditIssues = internalQuery({
  args: {
    auditId: v.id("migrationAudits"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Leave employee audit was not found");
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_audit", (query) => query.eq("auditId", audit._id))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(
        ({ code, field, entityType, entityId, organizationId, createdAt }) => ({
          code,
          field,
          entityType,
          entityId,
          organizationId,
          createdAt,
        }),
      ),
    };
  },
});
