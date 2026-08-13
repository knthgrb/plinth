import { v } from "convex/values";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  normalizeDepartmentName,
  planOrganizationNormalization,
  valuesEqual,
} from "./databaseMigrationPlanner";
import {
  EMPTY_SCHEMA_CLEANUP_COUNTERS,
  SCHEMA_CLEANUP_MIGRATION_KEY,
  SCHEMA_CLEANUP_VERSION,
  type SchemaCleanupCounters,
  type SchemaCleanupIssue,
} from "./databaseMigrationTypes";
import {
  FULL_SCHEMA_CLEANUP_DOMAINS,
  FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
  FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
  type FullSchemaCleanupDomain,
  type FullSchemaDomainReadiness,
} from "./fullSchemaCleanupRegistry";
import {
  CURRENT_SCHEMA_TABLES,
  FULL_SCHEMA_TABLE_POLICIES,
} from "./fullSchemaInventory";
import { ORGANIZATION_CONFIGURATION_FIELD_MANIFEST } from "./schemaFieldManifest";

const MAX_STATUS_ISSUES = 200;
const MAX_DESTINATION_ROWS_PER_ORGANIZATION = 500;
// Readiness is fail-closed when a migration key's recent history exceeds this bound.
const MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK = 100;

type FullSchemaCleanupReadinessRegistration = {
  domain: FullSchemaCleanupDomain;
  migrationKey: string;
  migrationVersion: number;
  implementation: "compatibility" | "migration" | "not_started";
};

type FullSchemaCleanupReadinessMode =
  | "not_started"
  | "organization_configuration"
  | "identity_credentials"
  | "leave_employee_children"
  | "workflow_events"
  | "communications_documents"
  | "assets_payroll_compatibility"
  | "unsupported";

function addCounters(
  current: SchemaCleanupCounters,
  increment: Partial<SchemaCleanupCounters>,
): SchemaCleanupCounters {
  return {
    scanned: current.scanned + (increment.scanned ?? 0),
    changed: current.changed + (increment.changed ?? 0),
    unchanged: current.unchanged + (increment.unchanged ?? 0),
    skipped: current.skipped + (increment.skipped ?? 0),
    conflicts: current.conflicts + (increment.conflicts ?? 0),
    errors: current.errors + (increment.errors ?? 0),
  };
}

type DestinationResult = "changed" | "unchanged" | "conflict";

function comparableRow(
  row: object,
  ignoredFields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !ignoredFields.includes(key)),
  );
}

function destinationResult(
  rows: object[],
  expected: object,
): DestinationResult {
  if (rows.length === 0) return "changed";
  if (rows.length > 1) return "conflict";
  const ignoredFields = [
    "_id",
    "_creationTime",
    "createdAt",
    "updatedAt",
    "migrationVersion",
  ];
  return valuesEqual(
    comparableRow(rows[0], ignoredFields),
    comparableRow(expected, ignoredFields),
  )
    ? "unchanged"
    : "conflict";
}

async function recordIssue(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    organizationId: Id<"organizations">;
    entityType: string;
    entityId?: string;
    field: string;
    code: string;
    now: number;
  },
) {
  await ctx.db.insert("migrationIssues", {
    runId: args.runId,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    field: args.field,
    code: args.code,
    createdAt: args.now,
  });
}

async function findUnexpectedDestinationFields(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  plan: ReturnType<typeof planOrganizationNormalization>,
): Promise<string[]> {
  const [attendanceRows, departmentRows, requirementRows] = await Promise.all([
    ctx.db
      .query("organizationAttendanceSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .take(2),
    ctx.db
      .query("organizationDepartments")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .take(MAX_DESTINATION_ROWS_PER_ORGANIZATION + 1),
    ctx.db
      .query("organizationRequirementDefinitions")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .take(MAX_DESTINATION_ROWS_PER_ORGANIZATION + 1),
  ]);
  const fields: string[] = [];
  if (!plan.attendance && attendanceRows.length > 0) {
    fields.push("attendanceSettings");
  }
  const departmentNames = new Set(
    plan.departments.map((department) => department.normalizedName),
  );
  if (
    departmentRows.length > MAX_DESTINATION_ROWS_PER_ORGANIZATION ||
    departmentRows.some(
      (department) => !departmentNames.has(department.normalizedName),
    )
  ) {
    fields.push("departments");
  }
  const requirementTypes = new Set(
    plan.requirements.map((requirement) => requirement.normalizedType),
  );
  if (
    requirementRows.length > MAX_DESTINATION_ROWS_PER_ORGANIZATION ||
    requirementRows.some(
      (requirement) => !requirementTypes.has(requirement.normalizedType),
    )
  ) {
    fields.push("defaultRequirements");
  }
  return fields;
}

async function validateDepartmentHeads(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  departments: ReturnType<typeof planOrganizationNormalization>["departments"],
) {
  const validDepartments: typeof departments = [];
  let invalidCount = 0;
  for (const department of departments) {
    if (!department.departmentHeadUserId) {
      validDepartments.push(department);
      continue;
    }
    const memberships = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (q) =>
        q
          .eq("userId", department.departmentHeadUserId!)
          .eq("organizationId", organizationId),
      )
      .take(2);
    const membership = memberships.length === 1 ? memberships[0] : null;
    if (membership && (membership.accessStatus ?? "active") === "active") {
      validDepartments.push(department);
    } else {
      invalidCount += 1;
    }
  }
  return { validDepartments, invalidCount };
}

async function runSchemaCleanupBatch(
  ctx: MutationCtx,
  runId: Id<"migrationRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run || run.key !== SCHEMA_CLEANUP_MIGRATION_KEY) {
    throw new Error("Schema cleanup run was not found");
  }
  if (run.status === "queued") {
    await ctx.db.patch(run._id, {
      status: "running",
      updatedAt: Date.now(),
    });
  } else if (run.status !== "running") {
    throw new Error("Schema cleanup run is not active");
  }

  const page = await ctx.db.query("organizations").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const organization of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const settingsRows = await ctx.db
      .query("settings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(2);

    const issues: SchemaCleanupIssue[] = [];
    if (settingsRows.length > 1) {
      issues.push({
        code: "DUPLICATE_SETTINGS_ROWS",
        field: "settings",
      });
    }
    const legacySettings = settingsRows.length === 1 ? settingsRows[0] : null;
    const plan = planOrganizationNormalization({
      organization,
      legacySettings,
    });
    issues.push(...plan.issues);
    const departmentValidation = await validateDepartmentHeads(
      ctx,
      organization._id,
      plan.departments,
    );
    for (let index = 0; index < departmentValidation.invalidCount; index += 1) {
      issues.push({
        code: "INVALID_DEPARTMENT_HEAD_MEMBERSHIP",
        field: "departments",
      });
    }
    const effectivePlan = {
      ...plan,
      departments: departmentValidation.validDepartments,
    };
    const unexpectedDestinationFields = await findUnexpectedDestinationFields(
      ctx,
      organization._id,
      effectivePlan,
    );
    for (const field of unexpectedDestinationFields) {
      issues.push({ code: "UNEXPECTED_DESTINATION_ROWS", field });
    }

    for (const issue of issues) {
      await recordIssue(ctx, {
        runId: run._id,
        organizationId: organization._id,
        entityType: "organization",
        entityId: organization._id,
        field: issue.field,
        code: issue.code,
        now,
      });
    }
    counters = addCounters(counters, { conflicts: issues.length });

    const payrollExpected = {
      organizationId: organization._id,
      ...plan.payroll,
      ...(legacySettings?._id ? { sourceSettingsId: legacySettings._id } : {}),
      migrationVersion: run.version,
    };
    const payrollRows = await ctx.db
      .query("organizationPayrollSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(2);
    const payrollResult = destinationResult(payrollRows, payrollExpected);
    if (payrollResult === "changed" && !run.dryRun) {
      await ctx.db.insert("organizationPayrollSettings", {
        ...payrollExpected,
        createdAt: now,
        updatedAt: now,
      });
    } else if (payrollResult === "conflict") {
      await recordIssue(ctx, {
        runId: run._id,
        organizationId: organization._id,
        entityType: "organizationPayrollSettings",
        field: "organizationId",
        code:
          payrollRows.length > 1
            ? "DUPLICATE_DESTINATION_ROWS"
            : "DESTINATION_VALUE_CONFLICT",
        now,
      });
    }
    counters = addCounters(counters, {
      changed: payrollResult === "changed" && !run.dryRun ? 1 : 0,
      unchanged: payrollResult === "unchanged" ? 1 : 0,
      conflicts: payrollResult === "conflict" ? 1 : 0,
    });

    if (plan.attendance) {
      const attendanceExpected = {
        organizationId: organization._id,
        attendanceSettings: plan.attendance,
        ...(legacySettings?._id
          ? { sourceSettingsId: legacySettings._id }
          : {}),
        migrationVersion: run.version,
      };
      const attendanceRows = await ctx.db
        .query("organizationAttendanceSettings")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", organization._id),
        )
        .take(2);
      const attendanceResult = destinationResult(
        attendanceRows,
        attendanceExpected,
      );
      if (attendanceResult === "changed" && !run.dryRun) {
        await ctx.db.insert("organizationAttendanceSettings", {
          ...attendanceExpected,
          createdAt: now,
          updatedAt: now,
        });
      } else if (attendanceResult === "conflict") {
        await recordIssue(ctx, {
          runId: run._id,
          organizationId: organization._id,
          entityType: "organizationAttendanceSettings",
          field: "organizationId",
          code:
            attendanceRows.length > 1
              ? "DUPLICATE_DESTINATION_ROWS"
              : "DESTINATION_VALUE_CONFLICT",
          now,
        });
      }
      counters = addCounters(counters, {
        changed: attendanceResult === "changed" && !run.dryRun ? 1 : 0,
        unchanged: attendanceResult === "unchanged" ? 1 : 0,
        conflicts: attendanceResult === "conflict" ? 1 : 0,
      });
    }

    for (const department of effectivePlan.departments) {
      const departmentExpected = {
        organizationId: organization._id,
        name: department.name,
        normalizedName: department.normalizedName,
        color: department.color,
        ...(department.departmentHeadUserId
          ? { departmentHeadUserId: department.departmentHeadUserId }
          : {}),
        ...(department.costCenter ? { costCenter: department.costCenter } : {}),
        ...(department.location ? { location: department.location } : {}),
        ...(department.parentDepartmentName
          ? {
              parentDepartmentNormalizedName: normalizeDepartmentName(
                department.parentDepartmentName,
              ),
            }
          : {}),
        ...(legacySettings?._id
          ? { sourceSettingsId: legacySettings._id }
          : {}),
        migrationVersion: run.version,
      };
      const departmentRows = await ctx.db
        .query("organizationDepartments")
        .withIndex("by_organization_normalized_name", (q) =>
          q
            .eq("organizationId", organization._id)
            .eq("normalizedName", department.normalizedName),
        )
        .take(2);
      const departmentResult = destinationResult(
        departmentRows,
        departmentExpected,
      );
      if (departmentResult === "changed" && !run.dryRun) {
        await ctx.db.insert("organizationDepartments", {
          ...departmentExpected,
          createdAt: now,
          updatedAt: now,
        });
      } else if (departmentResult === "conflict") {
        await recordIssue(ctx, {
          runId: run._id,
          organizationId: organization._id,
          entityType: "organizationDepartment",
          field: "normalizedName",
          code:
            departmentRows.length > 1
              ? "DUPLICATE_DESTINATION_ROWS"
              : "DESTINATION_VALUE_CONFLICT",
          now,
        });
      }
      counters = addCounters(counters, {
        changed: departmentResult === "changed" && !run.dryRun ? 1 : 0,
        unchanged: departmentResult === "unchanged" ? 1 : 0,
        conflicts: departmentResult === "conflict" ? 1 : 0,
      });
    }

    for (const requirement of plan.requirements) {
      const requirementExpected = {
        organizationId: organization._id,
        ...requirement,
        source: "organization" as const,
        migrationVersion: run.version,
      };
      const requirementRows = await ctx.db
        .query("organizationRequirementDefinitions")
        .withIndex("by_organization_normalized_type", (q) =>
          q
            .eq("organizationId", organization._id)
            .eq("normalizedType", requirement.normalizedType),
        )
        .take(2);
      const requirementResult = destinationResult(
        requirementRows,
        requirementExpected,
      );
      if (requirementResult === "changed" && !run.dryRun) {
        await ctx.db.insert("organizationRequirementDefinitions", {
          ...requirementExpected,
          createdAt: now,
          updatedAt: now,
        });
      } else if (requirementResult === "conflict") {
        await recordIssue(ctx, {
          runId: run._id,
          organizationId: organization._id,
          entityType: "organizationRequirementDefinition",
          field: "normalizedType",
          code:
            requirementRows.length > 1
              ? "DUPLICATE_DESTINATION_ROWS"
              : "DESTINATION_VALUE_CONFLICT",
          now,
        });
      }
      counters = addCounters(counters, {
        changed: requirementResult === "changed" && !run.dryRun ? 1 : 0,
        unchanged: requirementResult === "unchanged" ? 1 : 0,
        conflicts: requirementResult === "conflict" ? 1 : 0,
      });
    }
  }

  const done = page.isDone;
  await ctx.db.patch(run._id, {
    status: done ? "completed" : "running",
    cursor: done ? undefined : page.continueCursor,
    counters,
    updatedAt: now,
    completedAt: done ? now : undefined,
  });

  return {
    done,
    cursor: done ? null : page.continueCursor,
    counters,
  };
}

export const processSchemaCleanupBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: (ctx, args) => runSchemaCleanupBatch(ctx, args.runId),
});

const continueSchemaCleanupReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("databaseMigrations:continueSchemaCleanup");
const processSchemaCleanupBatchReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("databaseMigrations:processSchemaCleanupBatch");
const failSchemaCleanupReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("databaseMigrations:failSchemaCleanup");

export const startSchemaCleanup = internalMutation({
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

    const activeRuns = [
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (q) =>
          q.eq("key", SCHEMA_CLEANUP_MIGRATION_KEY).eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (q) =>
          q.eq("key", SCHEMA_CLEANUP_MIGRATION_KEY).eq("status", "running"),
        )
        .take(1)),
    ];
    if (activeRuns.length > 0) {
      throw new Error("A schema cleanup run is already active");
    }

    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (
        !dryRun ||
        !dryRun.dryRun ||
        dryRun.key !== SCHEMA_CLEANUP_MIGRATION_KEY ||
        dryRun.version !== SCHEMA_CLEANUP_VERSION ||
        dryRun.status !== "completed" ||
        dryRun.counters.errors > 0 ||
        dryRun.counters.conflicts > 0
      ) {
        throw new Error("Conflict-free completed dry-run is required");
      }
      requiredDryRunId = dryRun._id;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: SCHEMA_CLEANUP_MIGRATION_KEY,
      version: SCHEMA_CLEANUP_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "organizations",
      batchSize,
      counters: EMPTY_SCHEMA_CLEANUP_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueSchemaCleanupReference, { runId });

    return {
      runId,
      key: SCHEMA_CLEANUP_MIGRATION_KEY,
      version: SCHEMA_CLEANUP_VERSION,
      dryRun: args.dryRun,
    };
  },
});

export const continueSchemaCleanup = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runMutation(processSchemaCleanupBatchReference, {
        runId: args.runId,
      });
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueSchemaCleanupReference, {
          runId: args.runId,
        });
      }
      return { done: result.done };
    } catch {
      await ctx.runMutation(failSchemaCleanupReference, {
        runId: args.runId,
        failureCode: "BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failSchemaCleanup = internalMutation({
  args: {
    runId: v.id("migrationRuns"),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== SCHEMA_CLEANUP_MIGRATION_KEY) return;
    if (run.status === "completed" || run.status === "failed") return;
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

export const getSchemaCleanupRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== SCHEMA_CLEANUP_MIGRATION_KEY) {
      throw new Error("Schema cleanup run was not found");
    }
    const issues = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(MAX_STATUS_ISSUES + 1);
    const issuesTruncated = issues.length > MAX_STATUS_ISSUES;
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
      issuesTruncated,
      canStartWrite:
        run.dryRun &&
        run.version === SCHEMA_CLEANUP_VERSION &&
        run.status === "completed" &&
        run.counters.errors === 0 &&
        run.counters.conflicts === 0,
    };
  },
});

export const listSchemaCleanupIssues = internalQuery({
  args: {
    runId: v.id("migrationRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== SCHEMA_CLEANUP_MIGRATION_KEY) {
      throw new Error("Schema cleanup run was not found");
    }
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
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

export const resumeSchemaCleanup = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== SCHEMA_CLEANUP_MIGRATION_KEY) {
      throw new Error("Schema cleanup run was not found");
    }
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Only an active schema cleanup run can resume");
    }
    const staleBefore = Date.now() - 5 * 60 * 1_000;
    if (run.updatedAt > staleBefore) {
      throw new Error("Schema cleanup run is not stale");
    }
    await ctx.db.patch(run._id, {
      status: "queued",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, continueSchemaCleanupReference, {
      runId: run._id,
    });
    return { resumed: true, runId: run._id };
  },
});

type DestinationAudit = {
  expected: number;
  matching: number;
  missing: number;
  duplicate: number;
  mismatched: number;
  unexpected: number;
  totalRows: number;
};

const EMPTY_DESTINATION_AUDIT: DestinationAudit = {
  expected: 0,
  matching: 0,
  missing: 0,
  duplicate: 0,
  mismatched: 0,
  unexpected: 0,
  totalRows: 0,
};

function addDestinationAudit(
  current: DestinationAudit,
  increment: Partial<DestinationAudit>,
): DestinationAudit {
  return {
    expected: current.expected + (increment.expected ?? 0),
    matching: current.matching + (increment.matching ?? 0),
    missing: current.missing + (increment.missing ?? 0),
    duplicate: current.duplicate + (increment.duplicate ?? 0),
    mismatched: current.mismatched + (increment.mismatched ?? 0),
    unexpected: current.unexpected + (increment.unexpected ?? 0),
    totalRows: current.totalRows + (increment.totalRows ?? 0),
  };
}

function countDestination(
  audit: DestinationAudit,
  rows: object[],
  expected: object,
) {
  audit.expected += 1;
  const result = destinationResult(rows, expected);
  if (result === "unchanged") audit.matching += 1;
  else if (result === "changed") audit.missing += 1;
  else if (rows.length > 1) audit.duplicate += 1;
  else audit.mismatched += 1;
}

async function auditOrganizationDestinations(
  ctx: MutationCtx,
  organization: Doc<"organizations">,
  version: number,
  audit: DestinationAudit,
) {
  const settingsRows = await ctx.db
    .query("settings")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", organization._id),
    )
    .take(2);
  const legacySettings = settingsRows.length === 1 ? settingsRows[0] : null;
  const plan = planOrganizationNormalization({
    organization,
    legacySettings,
  });
  const departmentValidation = await validateDepartmentHeads(
    ctx,
    organization._id,
    plan.departments,
  );

  const payrollExpected = {
    organizationId: organization._id,
    ...plan.payroll,
    ...(legacySettings?._id ? { sourceSettingsId: legacySettings._id } : {}),
    migrationVersion: version,
  };
  const payrollRows = await ctx.db
    .query("organizationPayrollSettings")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", organization._id),
    )
    .take(2);
  countDestination(audit, payrollRows, payrollExpected);

  if (plan.attendance) {
    const attendanceExpected = {
      organizationId: organization._id,
      attendanceSettings: plan.attendance,
      ...(legacySettings?._id ? { sourceSettingsId: legacySettings._id } : {}),
      migrationVersion: version,
    };
    const attendanceRows = await ctx.db
      .query("organizationAttendanceSettings")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(2);
    countDestination(audit, attendanceRows, attendanceExpected);
  }

  for (const department of departmentValidation.validDepartments) {
    const departmentExpected = {
      organizationId: organization._id,
      name: department.name,
      normalizedName: department.normalizedName,
      color: department.color,
      ...(department.departmentHeadUserId
        ? { departmentHeadUserId: department.departmentHeadUserId }
        : {}),
      ...(department.costCenter ? { costCenter: department.costCenter } : {}),
      ...(department.location ? { location: department.location } : {}),
      ...(department.parentDepartmentName
        ? {
            parentDepartmentNormalizedName: normalizeDepartmentName(
              department.parentDepartmentName,
            ),
          }
        : {}),
      ...(legacySettings?._id ? { sourceSettingsId: legacySettings._id } : {}),
      migrationVersion: version,
    };
    const departmentRows = await ctx.db
      .query("organizationDepartments")
      .withIndex("by_organization_normalized_name", (q) =>
        q
          .eq("organizationId", organization._id)
          .eq("normalizedName", department.normalizedName),
      )
      .take(2);
    countDestination(audit, departmentRows, departmentExpected);
  }

  for (const requirement of plan.requirements) {
    const requirementExpected = {
      organizationId: organization._id,
      ...requirement,
      source: "organization" as const,
      migrationVersion: version,
    };
    const requirementRows = await ctx.db
      .query("organizationRequirementDefinitions")
      .withIndex("by_organization_normalized_type", (q) =>
        q
          .eq("organizationId", organization._id)
          .eq("normalizedType", requirement.normalizedType),
      )
      .take(2);
    countDestination(audit, requirementRows, requirementExpected);
  }

  return {
    destination: audit,
    duplicateLegacySettings: settingsRows.length > 1 ? 1 : 0,
    sourceConflicts:
      plan.issues.length +
      departmentValidation.invalidCount +
      (settingsRows.length > 1 ? 1 : 0),
  };
}

type AuditPhase = Doc<"migrationAudits">["phase"];

const AUDIT_PHASES: readonly AuditPhase[] = [
  "organizations",
  "payroll_settings",
  "attendance_settings",
  "departments",
  "requirements",
];

function nextAuditPhase(phase: AuditPhase): AuditPhase | null {
  const index = AUDIT_PHASES.indexOf(phase);
  return AUDIT_PHASES[index + 1] ?? null;
}

async function paginateAuditPhase(
  ctx: MutationCtx,
  phase: AuditPhase,
  cursor: string | null,
  batchSize: number,
) {
  const options = { cursor, numItems: batchSize };
  switch (phase) {
    case "organizations":
      return ctx.db.query("organizations").paginate(options);
    case "payroll_settings":
      return ctx.db.query("organizationPayrollSettings").paginate(options);
    case "attendance_settings":
      return ctx.db.query("organizationAttendanceSettings").paginate(options);
    case "departments":
      return ctx.db.query("organizationDepartments").paginate(options);
    case "requirements":
      return ctx.db
        .query("organizationRequirementDefinitions")
        .paginate(options);
    default:
      throw new Error(
        `Unsupported organization schema cleanup audit phase: ${phase}`,
      );
  }
}

export const processSchemaCleanupAuditBatch = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Schema cleanup audit was not found");
    if (audit.status === "queued") {
      await ctx.db.patch(audit._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    } else if (audit.status !== "running") {
      throw new Error("Schema cleanup audit is not active");
    }
    const run = await ctx.db.get(audit.migrationRunId);
    if (
      !run ||
      run.key !== SCHEMA_CLEANUP_MIGRATION_KEY ||
      run.version !== SCHEMA_CLEANUP_VERSION ||
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Completed write run is required");
    }

    const page = await paginateAuditPhase(
      ctx,
      audit.phase,
      audit.cursor ?? null,
      audit.batchSize,
    );
    let organizations = audit.organizations;
    let destination = audit.destination;
    let duplicateLegacySettings = audit.duplicateLegacySettings;
    let sourceConflicts = audit.sourceConflicts;

    if (audit.phase === "organizations") {
      for (const organization of page.page as Doc<"organizations">[]) {
        const localDestination = { ...EMPTY_DESTINATION_AUDIT };
        const result = await auditOrganizationDestinations(
          ctx,
          organization,
          run.version,
          localDestination,
        );
        organizations += 1;
        destination = addDestinationAudit(destination, result.destination);
        duplicateLegacySettings += result.duplicateLegacySettings;
        sourceConflicts += result.sourceConflicts;
      }
    } else {
      destination = addDestinationAudit(destination, {
        totalRows: page.page.length,
      });
    }

    const now = Date.now();
    if (!page.isDone) {
      await ctx.db.patch(audit._id, {
        cursor: page.continueCursor,
        organizations,
        destination,
        duplicateLegacySettings,
        sourceConflicts,
        updatedAt: now,
      });
      return { done: false };
    }

    const nextPhase = nextAuditPhase(audit.phase);
    if (nextPhase) {
      await ctx.db.patch(audit._id, {
        phase: nextPhase,
        cursor: undefined,
        organizations,
        destination,
        duplicateLegacySettings,
        sourceConflicts,
        updatedAt: now,
      });
      return { done: false };
    }

    destination = {
      ...destination,
      unexpected: Math.max(0, destination.totalRows - destination.expected),
    };
    await ctx.db.patch(audit._id, {
      status: "completed",
      cursor: undefined,
      organizations,
      destination,
      duplicateLegacySettings,
      sourceConflicts,
      updatedAt: now,
      completedAt: now,
    });
    return { done: true };
  },
});

const continueAuditReference = makeFunctionReference<
  "action",
  { auditId: Id<"migrationAudits"> }
>("databaseMigrations:continueSchemaCleanupAudit");
const processAuditBatchReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> },
  { done: boolean }
>("databaseMigrations:processSchemaCleanupAuditBatch");
const failAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("databaseMigrations:failSchemaCleanupAudit");

async function getLatestSchemaCleanupAudit(
  ctx: Pick<QueryCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (q) => q.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

function hasConflictFreeCompletedWriteRun(run: Doc<"migrationRuns">) {
  return (
    !run.dryRun &&
    run.status === "completed" &&
    run.counters.errors === 0 &&
    run.counters.conflicts === 0
  );
}

function isCurrentSchemaCleanupRun(run: Doc<"migrationRuns">) {
  return (
    run.key === SCHEMA_CLEANUP_MIGRATION_KEY &&
    run.version === SCHEMA_CLEANUP_VERSION
  );
}

function hasCleanCompletedSchemaCleanupAudit(
  run: Doc<"migrationRuns">,
  audit: Doc<"migrationAudits">,
) {
  return (
    isCurrentSchemaCleanupRun(run) &&
    hasConflictFreeCompletedWriteRun(run) &&
    audit.status === "completed" &&
    !audit.auditTruncated &&
    audit.sourceConflicts === 0 &&
    audit.destination.missing === 0 &&
    audit.destination.duplicate === 0 &&
    audit.destination.mismatched === 0 &&
    audit.destination.unexpected === 0 &&
    audit.destination.matching === audit.destination.expected &&
    audit.destination.totalRows === audit.destination.expected
  );
}

function hasCleanCompletedDomainAudit(
  registration: FullSchemaCleanupReadinessRegistration,
  run: Doc<"migrationRuns">,
  audit: Doc<"migrationAudits">,
) {
  return (
    run.key === registration.migrationKey &&
    run.version === registration.migrationVersion &&
    hasConflictFreeCompletedWriteRun(run) &&
    audit.status === "completed" &&
    !audit.auditTruncated &&
    audit.sourceConflicts === 0 &&
    audit.destination.missing === 0 &&
    audit.destination.duplicate === 0 &&
    audit.destination.mismatched === 0 &&
    audit.destination.unexpected === 0 &&
    audit.destination.matching === audit.destination.expected &&
    audit.destination.totalRows === audit.destination.expected
  );
}

async function getLatestWriteAttempt(
  ctx: Pick<QueryCtx, "db">,
  migrationKey: string,
) {
  const runs = await ctx.db
    .query("migrationRuns")
    .withIndex("by_key_started", (q) => q.eq("key", migrationKey))
    .order("desc")
    .take(MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK + 1);
  const run = runs
    .slice(0, MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK)
    .find((candidate) => !candidate.dryRun);
  if (run) return { status: "found" as const, run };
  if (runs.length > MAX_FULL_SCHEMA_MIGRATION_RUN_LOOKBACK) {
    return { status: "truncated" as const };
  }
  return { status: "not_found" as const };
}

function auditBlockers(audit: Doc<"migrationAudits">) {
  const blockers: string[] = [];
  if (audit.auditTruncated) blockers.push("AUDIT_TRUNCATED");
  if (audit.sourceConflicts > 0) blockers.push("AUDIT_SOURCE_CONFLICTS");
  if (
    audit.destination.missing > 0 ||
    audit.destination.duplicate > 0 ||
    audit.destination.mismatched > 0 ||
    audit.destination.unexpected > 0 ||
    audit.destination.matching !== audit.destination.expected ||
    audit.destination.totalRows !== audit.destination.expected
  ) {
    blockers.push("AUDIT_DESTINATION_DISCREPANCIES");
  }
  return blockers;
}

async function getOrganizationConfigurationReadiness(
  ctx: Pick<QueryCtx, "db">,
  registration: FullSchemaCleanupReadinessRegistration,
): Promise<FullSchemaDomainReadiness> {
  const runLookup = await getLatestWriteAttempt(ctx, registration.migrationKey);
  if (runLookup.status === "truncated") {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_RUN_HISTORY_TRUNCATED"],
    };
  }
  if (runLookup.status === "not_found") {
    return {
      domain: registration.domain,
      status: "not_started",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["COMPLETED_WRITE_RUN_NOT_FOUND"],
    };
  }
  const { run } = runLookup;
  if (run.version !== registration.migrationVersion) {
    return {
      domain: registration.domain,
      status: "stale",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_VERSION_STALE"],
    };
  }
  if (run.status === "failed") {
    return {
      domain: registration.domain,
      status: "failed",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_WRITE_FAILED"],
    };
  }
  if (run.status !== "completed") {
    return {
      domain: registration.domain,
      status: "running",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["MIGRATION_WRITE_NOT_COMPLETED"],
    };
  }
  const writeBlockers = [
    ...(run.counters.errors > 0 ? ["MIGRATION_WRITE_ERRORS"] : []),
    ...(run.counters.conflicts > 0 ? ["MIGRATION_WRITE_CONFLICTS"] : []),
  ];
  if (writeBlockers.length > 0) {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: writeBlockers,
    };
  }

  const audit = await getLatestSchemaCleanupAudit(ctx, run._id);
  if (!audit) {
    return {
      domain: registration.domain,
      status: "not_started",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_NOT_FOUND"],
    };
  }

  const auditMetadata = {
    auditId: audit._id,
    auditedAt: audit.completedAt ?? audit.updatedAt,
  };
  if (audit.status === "queued" || audit.status === "running") {
    return {
      domain: registration.domain,
      status: "running",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_NOT_COMPLETED"],
      ...auditMetadata,
    };
  }
  if (audit.status === "failed") {
    return {
      domain: registration.domain,
      status: "failed",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: ["AUDIT_FAILED"],
      ...auditMetadata,
    };
  }
  if (!hasCleanCompletedDomainAudit(registration, run, audit)) {
    return {
      domain: registration.domain,
      status: "blocked",
      migrationKey: registration.migrationKey,
      migrationVersion: registration.migrationVersion,
      blockers: auditBlockers(audit),
      ...auditMetadata,
    };
  }
  return {
    domain: registration.domain,
    status: "ready",
    migrationKey: registration.migrationKey,
    migrationVersion: registration.migrationVersion,
    blockers: [],
    ...auditMetadata,
  };
}

export function resolveFullSchemaCleanupReadinessMode(
  registration: FullSchemaCleanupReadinessRegistration,
): FullSchemaCleanupReadinessMode {
  if (registration.implementation === "not_started") return "not_started";
  if (
    registration.domain === "organization_configuration" &&
    registration.migrationKey === SCHEMA_CLEANUP_MIGRATION_KEY &&
    registration.migrationVersion === SCHEMA_CLEANUP_VERSION
  ) {
    return "organization_configuration";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "identity_credentials" &&
    registration.migrationKey === "full-schema-identity-credentials" &&
    registration.migrationVersion === 1
  ) {
    return "identity_credentials";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "leave_employee_children" &&
    registration.migrationKey === "full-schema-leave-employee-children" &&
    registration.migrationVersion === 1
  ) {
    return "leave_employee_children";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "workflow_events" &&
    registration.migrationKey === "full-schema-workflow-events" &&
    registration.migrationVersion === 1
  ) {
    return "workflow_events";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "communications_documents" &&
    registration.migrationKey === "full-schema-communications-documents" &&
    registration.migrationVersion === 1
  ) {
    return "communications_documents";
  }
  if (
    registration.implementation === "migration" &&
    registration.domain === "assets_payroll_compatibility" &&
    registration.migrationKey === "full-schema-assets-payroll" &&
    registration.migrationVersion === 1
  ) {
    return "assets_payroll_compatibility";
  }
  return "unsupported";
}

async function getFullSchemaDomainReadiness(
  ctx: Pick<QueryCtx, "db">,
  registration: FullSchemaCleanupReadinessRegistration,
): Promise<FullSchemaDomainReadiness> {
  switch (resolveFullSchemaCleanupReadinessMode(registration)) {
    case "not_started":
      return {
        domain: registration.domain,
        status: "not_started",
        migrationKey: registration.migrationKey,
        migrationVersion: registration.migrationVersion,
        blockers: ["DOMAIN_IMPLEMENTATION_NOT_DEPLOYED"],
      };
    case "organization_configuration":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "identity_credentials":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "leave_employee_children":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "workflow_events":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "communications_documents":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "assets_payroll_compatibility":
      return getOrganizationConfigurationReadiness(ctx, registration);
    case "unsupported":
      return {
        domain: registration.domain,
        status: "blocked",
        migrationKey: registration.migrationKey,
        migrationVersion: registration.migrationVersion,
        blockers: ["DOMAIN_IMPLEMENTATION_UNSUPPORTED"],
      };
  }
}

export const getFullSchemaInventory = internalQuery({
  args: {},
  handler: async () => ({
    programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
    programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
    currentTableCount: CURRENT_SCHEMA_TABLES.length,
    tables: CURRENT_SCHEMA_TABLES.map((table) => ({
      table,
      ...FULL_SCHEMA_TABLE_POLICIES[table],
    })),
  }),
});

export const getFullSchemaCleanupReadiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const domains = await Promise.all(
      FULL_SCHEMA_CLEANUP_DOMAINS.map((registration) =>
        getFullSchemaDomainReadiness(ctx, registration),
      ),
    );
    return {
      programKey: FULL_SCHEMA_CLEANUP_PROGRAM_KEY,
      programVersion: FULL_SCHEMA_CLEANUP_PROGRAM_VERSION,
      readyForRelease3: domains.every(({ status }) => status === "ready"),
      domains,
    };
  },
});

export const startSchemaCleanupAudit = internalMutation({
  args: {
    runId: v.id("migrationRuns"),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) {
      throw new Error("Audit batch size must be between 1 and 10");
    }
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== SCHEMA_CLEANUP_MIGRATION_KEY ||
      run.version !== SCHEMA_CLEANUP_VERSION ||
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const existing = await getLatestSchemaCleanupAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") {
      throw new Error("Schema cleanup audit is already active");
    }

    const now = Date.now();
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      status: "queued",
      phase: "organizations",
      batchSize,
      organizations: 0,
      destination: EMPTY_DESTINATION_AUDIT,
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

export const continueSchemaCleanupAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runMutation(processAuditBatchReference, args);
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

export const failSchemaCleanupAudit = internalMutation({
  args: {
    auditId: v.id("migrationAudits"),
    failureCode: v.string(),
  },
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

export const resumeSchemaCleanupAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== SCHEMA_CLEANUP_MIGRATION_KEY ||
      run.version !== SCHEMA_CLEANUP_VERSION ||
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const audit = await getLatestSchemaCleanupAudit(ctx, run._id);
    if (!audit) throw new Error("Schema cleanup audit was not found");
    if (audit.status === "completed") {
      throw new Error("Completed schema cleanup audit cannot resume");
    }
    const now = Date.now();
    if (audit.status !== "failed" && audit.updatedAt > now - 5 * 60 * 1_000) {
      throw new Error("Schema cleanup audit is not stale");
    }
    await ctx.db.patch(audit._id, {
      status: "queued",
      failureCode: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueAuditReference, {
      auditId: audit._id,
    });
    return { resumed: true, auditId: audit._id };
  },
});

export const getSchemaCleanupAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== SCHEMA_CLEANUP_MIGRATION_KEY ||
      run.version !== SCHEMA_CLEANUP_VERSION
    ) {
      throw new Error("Schema cleanup run was not found");
    }
    const audit = await getLatestSchemaCleanupAudit(ctx, run._id);
    if (!audit) return { status: "not_started" as const, ready: false };
    const ready = hasCleanCompletedSchemaCleanupAudit(run, audit);
    return {
      ...audit,
      ready,
      fieldManifest: ORGANIZATION_CONFIGURATION_FIELD_MANIFEST,
    };
  },
});
