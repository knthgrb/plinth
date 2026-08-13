import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  ASSETS_PAYROLL_MIGRATION_KEY,
  ASSETS_PAYROLL_MIGRATION_VERSION,
  buildAssetCustodyEvents,
  planAssetsPayrollProjection,
} from "./assetsPayrollMigrationPlanner";
import type {
  AssetsPayrollMigrationIssue,
  AssetsPayrollMigrationIssueCode,
  AssetsPayrollProjectionPlan,
} from "./assetsPayrollMigrationTypes";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;

type MigrationPhase =
  | "assets_payroll_runs"
  | "assets_accounting_items"
  | "assets_assets";
type AuditPhase =
  | "assets_source_verification"
  | "assets_target_payroll_notes"
  | "assets_target_accounting_receipts"
  | "assets_target_custody_events"
  | "assets_target_maintenance_events";
type MigrationRun = Doc<"migrationRuns"> & { phase: MigrationPhase };
type MigrationCounters = Doc<"migrationRuns">["counters"];
type AuditDestination = Doc<"migrationAudits">["destination"];

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};
const EMPTY_DESTINATION: AuditDestination = {
  expected: 0,
  matching: 0,
  missing: 0,
  duplicate: 0,
  mismatched: 0,
  unexpected: 0,
  totalRows: 0,
};
const PHASES: readonly MigrationPhase[] = [
  "assets_payroll_runs",
  "assets_accounting_items",
  "assets_assets",
];
const AUDIT_PHASES: readonly AuditPhase[] = [
  "assets_source_verification",
  "assets_target_payroll_notes",
  "assets_target_accounting_receipts",
  "assets_target_custody_events",
  "assets_target_maintenance_events",
];

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

function countersForPlan<T>(plan: AssetsPayrollProjectionPlan<T>) {
  if (plan.outcome === "create") return { changed: 1 };
  if (plan.outcome === "unchanged") return { unchanged: 1 };
  return { conflicts: 1 };
}

function assertRun(
  run: Doc<"migrationRuns"> | null,
): asserts run is MigrationRun {
  if (
    !run ||
    run.key !== ASSETS_PAYROLL_MIGRATION_KEY ||
    run.version !== ASSETS_PAYROLL_MIGRATION_VERSION ||
    !PHASES.includes(run.phase as MigrationPhase)
  ) {
    throw new Error("Assets and payroll migration run was not found");
  }
}

function nextPhase(phase: MigrationPhase): MigrationPhase | null {
  return PHASES[PHASES.indexOf(phase) + 1] ?? null;
}

function isAuditPhase(phase: Doc<"migrationAudits">["phase"]): phase is AuditPhase {
  return AUDIT_PHASES.includes(phase as AuditPhase);
}

function nextAuditPhase(phase: AuditPhase): AuditPhase | null {
  return AUDIT_PHASES[AUDIT_PHASES.indexOf(phase) + 1] ?? null;
}

async function recordIssues(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    organizationId?: Id<"organizations">;
    entityType: string;
    entityId?: string;
    issues: AssetsPayrollMigrationIssue[];
    now: number;
    auditId?: Id<"migrationAudits">;
  },
) {
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

async function recordConflict(
  ctx: MutationCtx,
  run: MigrationRun,
  args: {
    organizationId?: Id<"organizations">;
    entityType: string;
    entityId: string;
    code: AssetsPayrollMigrationIssueCode;
    field: string;
    now: number;
  },
) {
  await recordIssues(ctx, {
    runId: run._id,
    organizationId: args.organizationId,
    entityType: args.entityType,
    entityId: args.entityId,
    issues: [{ code: args.code, field: args.field }],
    now: args.now,
  });
  return { conflicts: 1 };
}

async function applyPlan<T>(
  ctx: MutationCtx,
  run: MigrationRun,
  args: {
    organizationId: Id<"organizations">;
    entityType: string;
    entityId: string;
    plan: AssetsPayrollProjectionPlan<T>;
    insert: (value: T, now: number) => Promise<unknown>;
    now: number;
  },
) {
  if (args.plan.outcome === "create" && !run.dryRun) {
    await args.insert(args.plan.value, args.now);
  } else if (args.plan.outcome === "conflict") {
    await recordIssues(ctx, {
      runId: run._id,
      organizationId: args.organizationId,
      entityType: args.entityType,
      entityId: args.entityId,
      issues: args.plan.issues,
      now: args.now,
    });
  }
  return countersForPlan(args.plan);
}

async function organizationExists(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
) {
  return Boolean(await ctx.db.get(organizationId));
}

async function userBelongsToOrganization(
  ctx: MutationCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
) {
  const membership = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (query) =>
      query.eq("userId", userId).eq("organizationId", organizationId),
    )
    .first();
  if (membership) return true;
  return (await ctx.db.get(userId))?.organizationId === organizationId;
}

async function employeeBelongsToOrganization(
  ctx: MutationCtx,
  employeeId: Id<"employees">,
  organizationId: Id<"organizations">,
) {
  return (await ctx.db.get(employeeId))?.organizationId === organizationId;
}

async function processPayrollRuns(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("payrollRuns").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const payrollRun of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, payrollRun.organizationId))) {
      counters = addCounters(counters, await recordConflict(ctx, run, {
        organizationId: payrollRun.organizationId,
        entityType: "payrollRun",
        entityId: payrollRun._id,
        code: "ORGANIZATION_NOT_FOUND",
        field: "organizationId",
        now,
      }));
      continue;
    }
    for (const [sourceIndex, note] of (payrollRun.notes ?? []).entries()) {
      if (
        !(await employeeBelongsToOrganization(ctx, note.employeeId, payrollRun.organizationId)) ||
        !(await userBelongsToOrganization(ctx, note.addedBy, payrollRun.organizationId))
      ) {
        counters = addCounters(counters, await recordConflict(ctx, run, {
          organizationId: payrollRun.organizationId,
          entityType: "payrollRunNote",
          entityId: payrollRun._id,
          code: "PAYROLL_NOTE_EMPLOYEE_TENANT_MISMATCH",
          field: "notes",
          now,
        }));
        continue;
      }
      const expected = {
        organizationId: payrollRun.organizationId,
        payrollRunId: payrollRun._id,
        employeeId: note.employeeId,
        noteDate: note.date,
        note: note.note,
        addedBy: note.addedBy,
        addedAt: note.addedAt,
        sourceIndex,
        migrationVersion: ASSETS_PAYROLL_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("payrollRunNotes")
        .withIndex("by_payroll_run_source", (query) =>
          query.eq("payrollRunId", payrollRun._id).eq("sourceIndex", sourceIndex),
        )
        .take(2);
      counters = addCounters(counters, await applyPlan(ctx, run, {
        organizationId: payrollRun.organizationId,
        entityType: "payrollRunNote",
        entityId: payrollRun._id,
        plan: planAssetsPayrollProjection({
          expected,
          destinations: rows,
          duplicateCode: "DUPLICATE_PAYROLL_NOTE",
          mismatchCode: "PAYROLL_NOTE_MISMATCH",
          field: "notes",
        }),
        insert: (value, timestamp) => ctx.db.insert("payrollRunNotes", {
          ...value,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        now,
      }));
    }
  }
  return { ...page, counters };
}

async function processAccountingItems(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("accountingCostItems").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const item of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, item.organizationId))) {
      counters = addCounters(counters, await recordConflict(ctx, run, {
        organizationId: item.organizationId,
        entityType: "accountingCostItem",
        entityId: item._id,
        code: "ORGANIZATION_NOT_FOUND",
        field: "organizationId",
        now,
      }));
      continue;
    }
    for (const [sourceIndex, storageId] of (item.receipts ?? []).entries()) {
      const objects = await ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (query) => query.eq("storageId", storageId))
        .take(2);
      const object = objects.length === 1 ? objects[0] : undefined;
      let code: AssetsPayrollMigrationIssueCode | undefined;
      if (!object) code = "STORAGE_OBJECT_NOT_FOUND";
      else if (object.organizationId !== item.organizationId) code = "STORAGE_OBJECT_TENANT_MISMATCH";
      else if (object.purpose !== "accounting_receipt" || object.state !== "active") code = "STORAGE_OBJECT_PURPOSE_MISMATCH";
      if (code) {
        counters = addCounters(counters, await recordConflict(ctx, run, {
          organizationId: item.organizationId,
          entityType: "accountingReceipt",
          entityId: item._id,
          code,
          field: "receipts",
          now,
        }));
        continue;
      }
      const expected = {
        organizationId: item.organizationId,
        storageId,
        parentType: "accounting_cost_item" as const,
        parentId: item._id,
        purpose: "accounting_receipt" as const,
        sourceIndex,
        migrationVersion: ASSETS_PAYROLL_MIGRATION_VERSION,
      };
      const rows = (await ctx.db
        .query("storageObjectLinks")
        .withIndex("by_storage_parent", (query) =>
          query.eq("storageId", storageId).eq("parentType", "accounting_cost_item").eq("parentId", item._id),
        )
        .collect()).filter((row) => row.sourceIndex === sourceIndex);
      counters = addCounters(counters, await applyPlan(ctx, run, {
        organizationId: item.organizationId,
        entityType: "accountingReceiptLink",
        entityId: item._id,
        plan: planAssetsPayrollProjection({
          expected,
          destinations: rows,
          duplicateCode: "DUPLICATE_ACCOUNTING_RECEIPT_LINK",
          mismatchCode: "ACCOUNTING_RECEIPT_LINK_MISMATCH",
          field: "receipts",
        }),
        insert: (value, timestamp) => ctx.db.insert("storageObjectLinks", {
          ...value,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        now,
      }));
    }
  }
  return { ...page, counters };
}

async function processAssets(ctx: MutationCtx, run: MigrationRun) {
  const page = await ctx.db.query("assets").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();
  for (const asset of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    if (!(await organizationExists(ctx, asset.organizationId))) {
      counters = addCounters(counters, await recordConflict(ctx, run, {
        organizationId: asset.organizationId,
        entityType: "asset",
        entityId: asset._id,
        code: "ORGANIZATION_NOT_FOUND",
        field: "organizationId",
        now,
      }));
      continue;
    }
    if (asset.assignedEmployeeId && !(await employeeBelongsToOrganization(ctx, asset.assignedEmployeeId, asset.organizationId))) {
      counters = addCounters(counters, await recordConflict(ctx, run, {
        organizationId: asset.organizationId,
        entityType: "asset",
        entityId: asset._id,
        code: "ASSET_EMPLOYEE_TENANT_MISMATCH",
        field: "assignedEmployeeId",
        now,
      }));
      continue;
    }
    if (asset.assignedBy && !(await userBelongsToOrganization(ctx, asset.assignedBy, asset.organizationId))) {
      counters = addCounters(counters, await recordConflict(ctx, run, {
        organizationId: asset.organizationId,
        entityType: "asset",
        entityId: asset._id,
        code: "ASSET_USER_TENANT_MISMATCH",
        field: "assignedBy",
        now,
      }));
      continue;
    }
    const custody = buildAssetCustodyEvents(asset);
    if (custody.outcome === "conflict") {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: asset.organizationId,
        entityType: "asset",
        entityId: asset._id,
        issues: custody.issues,
        now,
      });
      counters = addCounters(counters, { conflicts: custody.issues.length });
    } else {
      for (const event of custody.events) {
        const expected = {
          organizationId: asset.organizationId,
          assetId: asset._id,
          eventType: event.eventType,
          ...(event.employeeId ? { employeeId: event.employeeId as Id<"employees"> } : {}),
          ...(event.actorUserId ? { actorUserId: event.actorUserId as Id<"users"> } : {}),
          occurredAt: event.occurredAt,
          ...(event.returnDueDate !== undefined ? { returnDueDate: event.returnDueDate } : {}),
          sourceIndex: event.sourceIndex,
          migrationVersion: ASSETS_PAYROLL_MIGRATION_VERSION,
        };
        const rows = await ctx.db
          .query("assetCustodyEvents")
          .withIndex("by_asset_source", (query) => query.eq("assetId", asset._id).eq("sourceIndex", event.sourceIndex))
          .take(2);
        counters = addCounters(counters, await applyPlan(ctx, run, {
          organizationId: asset.organizationId,
          entityType: "assetCustodyEvent",
          entityId: asset._id,
          plan: planAssetsPayrollProjection({
            expected,
            destinations: rows,
            duplicateCode: "DUPLICATE_ASSET_CUSTODY_EVENT",
            mismatchCode: "ASSET_CUSTODY_EVENT_MISMATCH",
            field: "custody",
          }),
          insert: (value, timestamp) => ctx.db.insert("assetCustodyEvents", {
            ...value,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          now,
        }));
      }
    }
    for (const [sourceIndex, entry] of (asset.maintenanceHistory ?? []).entries()) {
      const expected = {
        organizationId: asset.organizationId,
        assetId: asset._id,
        serviceDate: entry.date,
        description: entry.description,
        ...(entry.cost !== undefined ? { cost: entry.cost } : {}),
        ...(entry.performedBy !== undefined ? { performedBy: entry.performedBy } : {}),
        ...(entry.nextServiceDate !== undefined ? { nextServiceDate: entry.nextServiceDate } : {}),
        sourceIndex,
        migrationVersion: ASSETS_PAYROLL_MIGRATION_VERSION,
      };
      const rows = await ctx.db
        .query("assetMaintenanceEvents")
        .withIndex("by_asset_source", (query) => query.eq("assetId", asset._id).eq("sourceIndex", sourceIndex))
        .take(2);
      counters = addCounters(counters, await applyPlan(ctx, run, {
        organizationId: asset.organizationId,
        entityType: "assetMaintenanceEvent",
        entityId: asset._id,
        plan: planAssetsPayrollProjection({
          expected,
          destinations: rows,
          duplicateCode: "DUPLICATE_ASSET_MAINTENANCE_EVENT",
          mismatchCode: "ASSET_MAINTENANCE_EVENT_MISMATCH",
          field: "maintenanceHistory",
        }),
        insert: (value, timestamp) => ctx.db.insert("assetMaintenanceEvents", {
          ...value,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        now,
      }));
    }
  }
  return { ...page, counters };
}

function processPhase(ctx: MutationCtx, run: MigrationRun) {
  switch (run.phase) {
    case "assets_payroll_runs": return processPayrollRuns(ctx, run);
    case "assets_accounting_items": return processAccountingItems(ctx, run);
    case "assets_assets": return processAssets(ctx, run);
  }
}

const continueReference = makeFunctionReference<"action", { runId: Id<"migrationRuns"> }>("assetsPayrollMigrations:continueAssetsPayrollMigration");
const processReference = makeFunctionReference<"mutation", { runId: Id<"migrationRuns"> }, { done: boolean }>("assetsPayrollMigrations:processAssetsPayrollMigrationBatch");
const failReference = makeFunctionReference<"mutation", { runId: Id<"migrationRuns">; failureCode: string }>("assetsPayrollMigrations:failAssetsPayrollMigration");

export const startAssetsPayrollMigration = internalMutation({
  args: { dryRun: v.boolean(), dryRunId: v.optional(v.id("migrationRuns")), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error("Batch size must be between 1 and 50");
    const active = [
      ...(await ctx.db.query("migrationRuns").withIndex("by_key_status", (query) => query.eq("key", ASSETS_PAYROLL_MIGRATION_KEY).eq("status", "queued")).take(1)),
      ...(await ctx.db.query("migrationRuns").withIndex("by_key_status", (query) => query.eq("key", ASSETS_PAYROLL_MIGRATION_KEY).eq("status", "running")).take(1)),
    ];
    if (active.length > 0) throw new Error("An assets and payroll migration is already active");
    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (!dryRun || dryRun.key !== ASSETS_PAYROLL_MIGRATION_KEY || dryRun.version !== ASSETS_PAYROLL_MIGRATION_VERSION || !dryRun.dryRun || dryRun.status !== "completed" || dryRun.counters.conflicts > 0 || dryRun.counters.errors > 0) {
        throw new Error("Conflict-free completed dry-run is required");
      }
      requiredDryRunId = dryRun._id;
    }
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: ASSETS_PAYROLL_MIGRATION_KEY,
      version: ASSETS_PAYROLL_MIGRATION_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "assets_payroll_runs",
      batchSize,
      counters: EMPTY_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueReference, { runId });
    return { runId, dryRun: args.dryRun, key: ASSETS_PAYROLL_MIGRATION_KEY, version: ASSETS_PAYROLL_MIGRATION_VERSION };
  },
});

export const processAssetsPayrollMigrationBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") return { done: true };
    const result = await processPhase(ctx, run);
    const now = Date.now();
    if (!result.isDone) {
      await ctx.db.patch(run._id, { status: "running", cursor: result.continueCursor, counters: result.counters, updatedAt: now });
      return { done: false };
    }
    const following = nextPhase(run.phase);
    if (following) {
      await ctx.db.patch(run._id, { status: "running", phase: following, cursor: undefined, counters: result.counters, updatedAt: now });
      return { done: false };
    }
    await ctx.db.patch(run._id, { status: "completed", cursor: undefined, counters: result.counters, completedAt: now, updatedAt: now });
    return { done: true };
  },
});

export const continueAssetsPayrollMigration = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const result = await ctx.runMutation(processReference, args);
      if (!result.done) await ctx.scheduler.runAfter(0, continueReference, args);
      return { done: result.done };
    } catch {
      await ctx.runMutation(failReference, { runId: args.runId, failureCode: "BATCH_FAILED" });
      return { done: true, failed: true };
    }
  },
});

export const failAssetsPayrollMigration = internalMutation({
  args: { runId: v.id("migrationRuns"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.key !== ASSETS_PAYROLL_MIGRATION_KEY || run.version !== ASSETS_PAYROLL_MIGRATION_VERSION || run.status === "completed" || run.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(run._id, { status: "failed", failureCode: args.failureCode, counters: addCounters(run.counters, { errors: 1 }), updatedAt: now, completedAt: now });
  },
});

export const getAssetsPayrollMigrationRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const issues = await ctx.db.query("migrationIssues").withIndex("by_run", (query) => query.eq("runId", run._id)).take(MAX_STATUS_ISSUES + 1);
    return {
      run,
      issues: issues.slice(0, MAX_STATUS_ISSUES).map(({ code, field, entityType, entityId, organizationId, createdAt }) => ({ code, field, entityType, entityId, organizationId, createdAt })),
      issuesTruncated: issues.length > MAX_STATUS_ISSUES,
      canStartWrite: run.dryRun && run.status === "completed" && run.counters.conflicts === 0 && run.counters.errors === 0,
    };
  },
});

export const listAssetsPayrollMigrationIssues = internalQuery({
  args: { runId: v.id("migrationRuns"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const result = await ctx.db.query("migrationIssues").withIndex("by_run", (query) => query.eq("runId", run._id)).paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ code, field, entityType, entityId, organizationId, createdAt }) => ({ code, field, entityType, entityId, organizationId, createdAt })) };
  },
});

export const resumeAssetsPayrollMigration = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") throw new Error("Only an active assets and payroll migration can resume");
    if (Date.now() - run.updatedAt < STALE_RUN_MILLISECONDS) throw new Error("Assets and payroll migration is not stale");
    await ctx.scheduler.runAfter(0, continueReference, { runId: run._id });
    return { resumed: true, runId: run._id };
  },
});

type AuditPage = { isDone: boolean; continueCursor: string; destination: AuditDestination; sourceConflicts: number };

async function latestAudit(ctx: Pick<MutationCtx | QueryCtx, "db">, runId: Id<"migrationRuns">) {
  return ctx.db.query("migrationAudits").withIndex("by_run", (query) => query.eq("migrationRunId", runId)).order("desc").first();
}

async function auditVerification(ctx: MutationCtx, audit: Doc<"migrationAudits">, run: MigrationRun): Promise<AuditPage> {
  if (!audit.verificationRunId) throw new Error("Assets and payroll audit verification is missing");
  const page = await ctx.db.query("migrationIssues").withIndex("by_run", (query) => query.eq("runId", audit.verificationRunId!)).paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  for (const issue of page.page) {
    sourceConflicts += 1;
    if (issue.code.startsWith("DUPLICATE_")) destination.duplicate += 1;
    else if (issue.code.includes("MISMATCH")) destination.mismatched += 1;
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

async function markUnexpected(ctx: MutationCtx, audit: Doc<"migrationAudits">, run: MigrationRun, row: { _id: string; organizationId: Id<"organizations"> }, entityType: string, field: string) {
  await recordIssues(ctx, {
    runId: run._id,
    auditId: audit._id,
    organizationId: row.organizationId,
    entityType,
    entityId: row._id,
    issues: [{ code: "UNEXPECTED_DESTINATION_ROW", field }],
    now: Date.now(),
  });
}

async function auditTarget(ctx: MutationCtx, audit: Doc<"migrationAudits"> & { phase: AuditPhase }, run: MigrationRun): Promise<AuditPage> {
  const destination = { ...audit.destination };
  const acceptRows = async <T extends { _id: string; organizationId: Id<"organizations"> }>(page: { page: T[]; isDone: boolean; continueCursor: string }, entityType: string, field: string, exists: (row: T) => Promise<boolean>): Promise<AuditPage> => {
    let unexpected = 0;
    for (const row of page.page) {
      destination.totalRows += 1;
      if (!(await exists(row))) {
        unexpected += 1;
        destination.unexpected += 1;
        await markUnexpected(ctx, audit, run, row, entityType, field);
      }
    }
    destination.matching += page.page.length - unexpected;
    return { ...page, destination, sourceConflicts: audit.sourceConflicts + unexpected };
  };
  switch (audit.phase) {
    case "assets_target_payroll_notes": {
      const page = await ctx.db.query("payrollRunNotes").paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(page, "payrollRunNote", "sourceIndex", async (row) => {
        const source = await ctx.db.get(row.payrollRunId);
        const note = source?.notes?.[row.sourceIndex];
        return source?.organizationId === row.organizationId && note?.employeeId === row.employeeId && note.date === row.noteDate && note.note === row.note && note.addedBy === row.addedBy && note.addedAt === row.addedAt && row.migrationVersion === ASSETS_PAYROLL_MIGRATION_VERSION;
      });
    }
    case "assets_target_accounting_receipts": {
      const rawPage = await ctx.db.query("storageObjectLinks").paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      const page = { ...rawPage, page: rawPage.page.filter((row) => row.parentType === "accounting_cost_item") };
      return acceptRows(page, "accountingReceiptLink", "sourceIndex", async (row) => {
        if (row.parentType !== "accounting_cost_item") return false;
        const source = await ctx.db.get(row.parentId as Id<"accountingCostItems">);
        return source?.organizationId === row.organizationId && source.receipts?.[row.sourceIndex] === row.storageId && row.purpose === "accounting_receipt" && row.migrationVersion === ASSETS_PAYROLL_MIGRATION_VERSION;
      });
    }
    case "assets_target_custody_events": {
      const page = await ctx.db.query("assetCustodyEvents").paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(page, "assetCustodyEvent", "sourceIndex", async (row) => {
        const source = await ctx.db.get(row.assetId);
        if (source?.organizationId !== row.organizationId) return false;
        const planned = buildAssetCustodyEvents(source);
        if (planned.outcome !== "valid") return false;
        const expected = planned.events.find((event) => event.sourceIndex === row.sourceIndex);
        return expected !== undefined && planAssetsPayrollProjection({ expected: { organizationId: row.organizationId, assetId: row.assetId, ...expected, migrationVersion: ASSETS_PAYROLL_MIGRATION_VERSION }, destinations: [row], duplicateCode: "DUPLICATE_ASSET_CUSTODY_EVENT", mismatchCode: "ASSET_CUSTODY_EVENT_MISMATCH", field: "custody" }).outcome === "unchanged";
      });
    }
    case "assets_target_maintenance_events": {
      const page = await ctx.db.query("assetMaintenanceEvents").paginate({ cursor: audit.cursor ?? null, numItems: audit.batchSize });
      return acceptRows(page, "assetMaintenanceEvent", "sourceIndex", async (row) => {
        const source = await ctx.db.get(row.assetId);
        const entry = source?.maintenanceHistory?.[row.sourceIndex];
        return source?.organizationId === row.organizationId && entry?.date === row.serviceDate && entry.description === row.description && entry.cost === row.cost && entry.performedBy === row.performedBy && entry.nextServiceDate === row.nextServiceDate && row.migrationVersion === ASSETS_PAYROLL_MIGRATION_VERSION;
      });
    }
    case "assets_source_verification": throw new Error("Source verification uses migration issues");
  }
}

async function runAuditBatch(ctx: MutationCtx, auditId: Id<"migrationAudits">) {
  const audit = await ctx.db.get(auditId);
  if (!audit || !isAuditPhase(audit.phase)) throw new Error("Assets and payroll audit was not found");
  if (audit.status !== "queued" && audit.status !== "running") return { done: true };
  const rawRun = await ctx.db.get(audit.migrationRunId);
  assertRun(rawRun);
  const page = audit.phase === "assets_source_verification" ? await auditVerification(ctx, audit, rawRun) : await auditTarget(ctx, audit as Doc<"migrationAudits"> & { phase: AuditPhase }, rawRun);
  const now = Date.now();
  if (!page.isDone) {
    await ctx.db.patch(audit._id, { status: "running", cursor: page.continueCursor, destination: page.destination, sourceConflicts: page.sourceConflicts, updatedAt: now });
    return { done: false };
  }
  const following = nextAuditPhase(audit.phase);
  if (following) {
    await ctx.db.patch(audit._id, { status: "running", phase: following, cursor: undefined, destination: page.destination, sourceConflicts: page.sourceConflicts, updatedAt: now });
    return { done: false };
  }
  await ctx.db.patch(audit._id, { status: "completed", cursor: undefined, destination: { ...page.destination, expected: page.destination.matching + page.destination.missing }, sourceConflicts: page.sourceConflicts, completedAt: now, updatedAt: now });
  return { done: true };
}

const continueAuditReference = makeFunctionReference<"action", { auditId: Id<"migrationAudits"> }>("assetsPayrollMigrations:continueAssetsPayrollAudit");
const getAuditStateReference = makeFunctionReference<"query", { auditId: Id<"migrationAudits"> }, { status: Doc<"migrationAudits">["status"]; phase: Doc<"migrationAudits">["phase"]; verificationRunId?: Id<"migrationRuns"> }>("assetsPayrollMigrations:getAssetsPayrollAuditState");
const prepareAuditReference = makeFunctionReference<"mutation", { auditId: Id<"migrationAudits"> }>("assetsPayrollMigrations:prepareAssetsPayrollAudit");
const processAuditReference = makeFunctionReference<"mutation", { auditId: Id<"migrationAudits"> }, { done: boolean }>("assetsPayrollMigrations:processAssetsPayrollAuditBatch");
const failAuditReference = makeFunctionReference<"mutation", { auditId: Id<"migrationAudits">; failureCode: string }>("assetsPayrollMigrations:failAssetsPayrollAudit");

export const startAssetsPayrollAudit = internalMutation({
  args: { runId: v.id("migrationRuns"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) throw new Error("Audit batch size must be between 1 and 10");
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.dryRun || run.status !== "completed" || run.counters.errors > 0 || run.counters.conflicts > 0) throw new Error("Conflict-free completed write run is required");
    const existing = await latestAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") throw new Error("Assets and payroll audit is already active");
    const now = Date.now();
    const verificationRunId = await ctx.db.insert("migrationRuns", { key: ASSETS_PAYROLL_MIGRATION_KEY, version: ASSETS_PAYROLL_MIGRATION_VERSION, dryRun: true, status: "queued", phase: "assets_payroll_runs", batchSize, counters: EMPTY_COUNTERS, startedAt: now, updatedAt: now });
    const auditId = await ctx.db.insert("migrationAudits", { migrationRunId: run._id, verificationRunId, status: "queued", phase: "assets_payroll_runs", batchSize, organizations: 0, destination: EMPTY_DESTINATION, duplicateLegacySettings: 0, sourceConflicts: 0, auditTruncated: false, startedAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, continueAuditReference, { auditId });
    return { auditId, runId: run._id };
  },
});

export const getAssetsPayrollAuditState = internalQuery({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Assets and payroll audit was not found");
    return { status: audit.status, phase: audit.phase, verificationRunId: audit.verificationRunId };
  },
});

export const prepareAssetsPayrollAudit = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit?.verificationRunId || audit.phase !== "assets_payroll_runs") throw new Error("Assets and payroll audit verification is not pending");
    const verification = await ctx.db.get(audit.verificationRunId);
    assertRun(verification);
    if (verification.status !== "completed") throw new Error("Assets and payroll audit verification is not completed");
    await ctx.db.patch(audit._id, { status: "running", phase: "assets_source_verification", destination: { ...EMPTY_DESTINATION, missing: verification.counters.changed }, updatedAt: Date.now() });
  },
});

export const processAssetsPayrollAuditBatch = internalMutation({ args: { auditId: v.id("migrationAudits") }, handler: (ctx, args) => runAuditBatch(ctx, args.auditId) });

export const continueAssetsPayrollAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const state = await ctx.runQuery(getAuditStateReference, args);
      if (state.status === "completed" || state.status === "failed") return { done: true };
      if (state.phase === "assets_payroll_runs") {
        if (!state.verificationRunId) throw new Error("Assets and payroll audit verification is missing");
        const result = await ctx.runMutation(processReference, { runId: state.verificationRunId });
        if (result.done) await ctx.runMutation(prepareAuditReference, args);
        await ctx.scheduler.runAfter(0, continueAuditReference, args);
        return { done: false };
      }
      const result = await ctx.runMutation(processAuditReference, args);
      if (!result.done) await ctx.scheduler.runAfter(0, continueAuditReference, args);
      return { done: result.done };
    } catch {
      await ctx.runMutation(failAuditReference, { auditId: args.auditId, failureCode: "AUDIT_BATCH_FAILED" });
      return { done: true, failed: true };
    }
  },
});

export const failAssetsPayrollAudit = internalMutation({
  args: { auditId: v.id("migrationAudits"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.status === "completed" || audit.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(audit._id, { status: "failed", failureCode: args.failureCode, completedAt: now, updatedAt: now });
  },
});

export const resumeAssetsPayrollAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit || audit.status === "completed") throw new Error("Resumable assets and payroll audit was not found");
    if (audit.status !== "failed" && Date.now() - audit.updatedAt < STALE_RUN_MILLISECONDS) throw new Error("Assets and payroll audit is not stale");
    await ctx.db.patch(audit._id, { status: audit.phase === "assets_payroll_runs" ? "queued" : "running", failureCode: undefined, completedAt: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, continueAuditReference, { auditId: audit._id });
    return { resumed: true, auditId: audit._id };
  },
});

export const getAssetsPayrollAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit) throw new Error("Assets and payroll audit was not found");
    return { ...audit, ready: audit.status === "completed" && audit.sourceConflicts === 0 && audit.destination.missing === 0 && audit.destination.duplicate === 0 && audit.destination.mismatched === 0 && audit.destination.unexpected === 0 && audit.destination.matching === audit.destination.expected && audit.destination.totalRows === audit.destination.expected };
  },
});

export const listAssetsPayrollAuditIssues = internalQuery({
  args: { auditId: v.id("migrationAudits"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Assets and payroll audit was not found");
    const run = await ctx.db.get(audit.migrationRunId);
    assertRun(run);
    const result = await ctx.db.query("migrationIssues").withIndex("by_audit", (query) => query.eq("auditId", audit._id)).paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ code, field, entityType, entityId, organizationId, createdAt }) => ({ code, field, entityType, entityId, organizationId, createdAt })) };
  },
});
