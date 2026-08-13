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
  RELEASE_3_CONTRACT_KEY,
  RELEASE_3_CONTRACT_VERSION,
} from "./release3Contract";
import { planRelease3ContractCleanup } from "./release3MigrationPlanner";
import type { CurrentSchemaTable } from "./fullSchemaInventory";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;

type Release3Phase =
  | "release3_organizations"
  | "release3_users"
  | "release3_invitations"
  | "release3_employees"
  | "release3_payroll_runs"
  | "release3_assets"
  | "release3_payslips"
  | "release3_evaluations"
  | "release3_settings"
  | "release3_applicants"
  | "release3_memos"
  | "release3_conversations"
  | "release3_messages"
  | "release3_chat_preferences"
  | "release3_leave_requests"
  | "release3_documents"
  | "release3_accounting_items";

type Release3Run = Doc<"migrationRuns"> & { phase: Release3Phase };
type MigrationCounters = Doc<"migrationRuns">["counters"];
type CleanupDocument = { _id: string; organizationId?: Id<"organizations"> };

const PHASES: readonly Release3Phase[] = [
  "release3_organizations",
  "release3_users",
  "release3_invitations",
  "release3_employees",
  "release3_payroll_runs",
  "release3_assets",
  "release3_payslips",
  "release3_evaluations",
  "release3_settings",
  "release3_applicants",
  "release3_memos",
  "release3_conversations",
  "release3_messages",
  "release3_chat_preferences",
  "release3_leave_requests",
  "release3_documents",
  "release3_accounting_items",
];

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};

const EMPTY_DESTINATION: Doc<"migrationAudits">["destination"] = {
  expected: 0,
  matching: 0,
  missing: 0,
  duplicate: 0,
  mismatched: 0,
  unexpected: 0,
  totalRows: 0,
};

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

function assertRun(run: Doc<"migrationRuns"> | null): asserts run is Release3Run {
  if (
    !run ||
    run.key !== RELEASE_3_CONTRACT_KEY ||
    run.version !== RELEASE_3_CONTRACT_VERSION ||
    !PHASES.includes(run.phase as Release3Phase)
  ) {
    throw new Error("Release 3 contract cleanup run was not found");
  }
}

function nextPhase(phase: Release3Phase): Release3Phase | null {
  return PHASES[PHASES.indexOf(phase) + 1] ?? null;
}

async function recordIssue(
  ctx: MutationCtx,
  run: Release3Run,
  document: CleanupDocument,
  table: CurrentSchemaTable,
  code: string,
  field: string,
): Promise<void> {
  await ctx.db.insert("migrationIssues", {
    runId: run._id,
    ...(document.organizationId
      ? { organizationId: document.organizationId }
      : {}),
    entityType: table,
    entityId: document._id,
    field,
    code,
    createdAt: Date.now(),
  });
}

async function processPage<T extends CleanupDocument>(
  ctx: MutationCtx,
  run: Release3Run,
  table: CurrentSchemaTable,
  page: { page: T[]; isDone: boolean; continueCursor: string },
  apply: (document: T, patch: Record<string, unknown>) => Promise<void>,
) {
  let counters = run.counters;
  for (const document of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const plan = planRelease3ContractCleanup(
      table,
      document as unknown as Record<string, unknown>,
    );
    if (plan.outcome === "conflict") {
      for (const issue of plan.issues) {
        await recordIssue(ctx, run, document, table, issue.code, issue.field);
      }
      counters = addCounters(counters, { conflicts: plan.issues.length });
    } else if (plan.outcome === "change") {
      if (run.dryRun && run.requiredDryRunId) {
        for (const field of plan.changedFields) {
          await recordIssue(
            ctx,
            run,
            document,
            table,
            "LEGACY_FIELD_REMAINS",
            field,
          );
        }
      }
      if (!run.dryRun) await apply(document, plan.patch);
      counters = addCounters(counters, { changed: plan.changedFields.length });
    } else {
      counters = addCounters(counters, { unchanged: 1 });
    }
  }
  return { ...page, counters };
}

async function processPhase(ctx: MutationCtx, run: Release3Run) {
  const options = { cursor: run.cursor ?? null, numItems: run.batchSize };
  switch (run.phase) {
    case "release3_organizations": {
      const page = await ctx.db.query("organizations").paginate(options);
      return processPage(ctx, run, "organizations", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"organizations">>),
      );
    }
    case "release3_users": {
      const page = await ctx.db.query("users").paginate(options);
      return processPage(ctx, run, "users", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"users">>),
      );
    }
    case "release3_invitations": {
      const page = await ctx.db.query("invitations").paginate(options);
      return processPage(ctx, run, "invitations", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"invitations">>),
      );
    }
    case "release3_employees": {
      const page = await ctx.db.query("employees").paginate(options);
      return processPage(ctx, run, "employees", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"employees">>),
      );
    }
    case "release3_payroll_runs": {
      const page = await ctx.db.query("payrollRuns").paginate(options);
      return processPage(ctx, run, "payrollRuns", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"payrollRuns">>),
      );
    }
    case "release3_assets": {
      const page = await ctx.db.query("assets").paginate(options);
      return processPage(ctx, run, "assets", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"assets">>),
      );
    }
    case "release3_payslips": {
      const page = await ctx.db.query("payslips").paginate(options);
      return processPage(ctx, run, "payslips", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"payslips">>),
      );
    }
    case "release3_evaluations": {
      const page = await ctx.db.query("evaluations").paginate(options);
      return processPage(ctx, run, "evaluations", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"evaluations">>),
      );
    }
    case "release3_settings": {
      const page = await ctx.db.query("settings").paginate(options);
      return processPage(ctx, run, "settings", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"settings">>),
      );
    }
    case "release3_applicants": {
      const page = await ctx.db.query("applicants").paginate(options);
      return processPage(ctx, run, "applicants", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"applicants">>),
      );
    }
    case "release3_memos": {
      const page = await ctx.db.query("memos").paginate(options);
      return processPage(ctx, run, "memos", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"memos">>),
      );
    }
    case "release3_conversations": {
      const page = await ctx.db.query("conversations").paginate(options);
      return processPage(ctx, run, "conversations", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"conversations">>),
      );
    }
    case "release3_messages": {
      const page = await ctx.db.query("messages").paginate(options);
      return processPage(ctx, run, "messages", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"messages">>),
      );
    }
    case "release3_chat_preferences": {
      const page = await ctx.db.query("userChatPreferences").paginate(options);
      return processPage(ctx, run, "userChatPreferences", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"userChatPreferences">>),
      );
    }
    case "release3_leave_requests": {
      const page = await ctx.db.query("leaveRequests").paginate(options);
      return processPage(ctx, run, "leaveRequests", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"leaveRequests">>),
      );
    }
    case "release3_documents": {
      const page = await ctx.db.query("documents").paginate(options);
      return processPage(ctx, run, "documents", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"documents">>),
      );
    }
    case "release3_accounting_items": {
      const page = await ctx.db.query("accountingCostItems").paginate(options);
      return processPage(ctx, run, "accountingCostItems", page, (row, patch) =>
        ctx.db.patch(row._id, patch as Partial<Doc<"accountingCostItems">>),
      );
    }
  }
}

const continueReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("release3Migrations:continueRelease3ContractCleanup");
const processReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("release3Migrations:processRelease3ContractCleanupBatch");
const failReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("release3Migrations:failRelease3ContractCleanup");

export const startRelease3ContractCleanup = internalMutation({
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
        .withIndex("by_key_status", (q) =>
          q.eq("key", RELEASE_3_CONTRACT_KEY).eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (q) =>
          q.eq("key", RELEASE_3_CONTRACT_KEY).eq("status", "running"),
        )
        .take(1)),
    ];
    if (active.length > 0) throw new Error("A Release 3 cleanup is already active");

    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      assertRun(dryRun);
      if (
        !dryRun.dryRun ||
        dryRun.status !== "completed" ||
        dryRun.counters.conflicts > 0 ||
        dryRun.counters.errors > 0 ||
        !dryRun.exportReference ||
        !dryRun.exportAcknowledgedAt
      ) {
        throw new Error("Clean exported dry-run is required");
      }
      requiredDryRunId = dryRun._id;
    }
    const now = Date.now();
    const runId = await ctx.db.insert("migrationRuns", {
      key: RELEASE_3_CONTRACT_KEY,
      version: RELEASE_3_CONTRACT_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: PHASES[0],
      batchSize,
      counters: EMPTY_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueReference, { runId });
    return {
      runId,
      dryRun: args.dryRun,
      key: RELEASE_3_CONTRACT_KEY,
      version: RELEASE_3_CONTRACT_VERSION,
    };
  },
});

export const acknowledgeRelease3ContractExport = internalMutation({
  args: { dryRunId: v.id("migrationRuns"), exportReference: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.dryRunId);
    assertRun(run);
    const exportReference = args.exportReference.trim();
    if (
      !run.dryRun ||
      run.status !== "completed" ||
      run.counters.conflicts > 0 ||
      run.counters.errors > 0
    ) {
      throw new Error("Only a clean completed dry-run can be acknowledged");
    }
    if (!exportReference) throw new Error("Export reference is required");
    const exportAcknowledgedAt = Date.now();
    await ctx.db.patch(run._id, { exportReference, exportAcknowledgedAt });
    return { dryRunId: run._id, exportReference, exportAcknowledgedAt };
  },
});

export const processRelease3ContractCleanupBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") return { done: true };
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
    const following = nextPhase(run.phase);
    if (following) {
      await ctx.db.patch(run._id, {
        status: "running",
        phase: following,
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
      completedAt: now,
      updatedAt: now,
    });
    return { done: true };
  },
});

export const continueRelease3ContractCleanup = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const result = await ctx.runMutation(processReference, args);
      if (!result.done) await ctx.scheduler.runAfter(0, continueReference, args);
      return { done: result.done };
    } catch {
      await ctx.runMutation(failReference, {
        runId: args.runId,
        failureCode: "BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failRelease3ContractCleanup = internalMutation({
  args: { runId: v.id("migrationRuns"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== RELEASE_3_CONTRACT_KEY ||
      run.version !== RELEASE_3_CONTRACT_VERSION ||
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
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const getRelease3ContractCleanupRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const issues = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .take(MAX_STATUS_ISSUES + 1);
    return {
      run,
      issues: issues.slice(0, MAX_STATUS_ISSUES).map(redactIssue),
      issuesTruncated: issues.length > MAX_STATUS_ISSUES,
      canAcknowledgeExport:
        run.dryRun &&
        run.status === "completed" &&
        run.counters.conflicts === 0 &&
        run.counters.errors === 0,
      canStartWrite:
        run.dryRun &&
        run.status === "completed" &&
        run.counters.conflicts === 0 &&
        run.counters.errors === 0 &&
        Boolean(run.exportReference && run.exportAcknowledgedAt),
    };
  },
});

function redactIssue(issue: Doc<"migrationIssues">) {
  const { code, field, entityType, entityId, organizationId, createdAt } = issue;
  return { code, field, entityType, entityId, organizationId, createdAt };
}

export const listRelease3ContractCleanupIssues = internalQuery({
  args: { runId: v.id("migrationRuns"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(redactIssue) };
  },
});

export const resumeRelease3ContractCleanup = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Only an active Release 3 cleanup can resume");
    }
    if (Date.now() - run.updatedAt < STALE_RUN_MILLISECONDS) {
      throw new Error("Release 3 cleanup is not stale");
    }
    await ctx.scheduler.runAfter(0, continueReference, { runId: run._id });
    return { resumed: true, runId: run._id };
  },
});

async function latestAudit(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (q) => q.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

const continueAuditReference = makeFunctionReference<
  "action",
  { auditId: Id<"migrationAudits"> }
>("release3Migrations:continueRelease3ContractAudit");
const auditStateReference = makeFunctionReference<
  "query",
  { auditId: Id<"migrationAudits"> },
  {
    status: Doc<"migrationAudits">["status"];
    verificationRunId?: Id<"migrationRuns">;
  }
>("release3Migrations:getRelease3ContractAuditState");
const finalizeAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> }
>("release3Migrations:finalizeRelease3ContractAudit");
const failAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("release3Migrations:failRelease3ContractAudit");

export const startRelease3ContractAudit = internalMutation({
  args: { runId: v.id("migrationRuns"), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    if (
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.conflicts > 0 ||
      run.counters.errors > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const batchSize = args.batchSize ?? 10;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
      throw new Error("Audit batch size must be between 1 and 50");
    }
    const existing = await latestAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") {
      throw new Error("Release 3 contract audit is already active");
    }
    const now = Date.now();
    const verificationRunId = await ctx.db.insert("migrationRuns", {
      key: RELEASE_3_CONTRACT_KEY,
      version: RELEASE_3_CONTRACT_VERSION,
      dryRun: true,
      status: "queued",
      phase: PHASES[0],
      batchSize,
      counters: EMPTY_COUNTERS,
      requiredDryRunId: run._id,
      startedAt: now,
      updatedAt: now,
    });
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      verificationRunId,
      status: "queued",
      phase: "release3_contract",
      batchSize,
      organizations: 0,
      destination: EMPTY_DESTINATION,
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

export const getRelease3ContractAuditState = internalQuery({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.phase !== "release3_contract") {
      throw new Error("Release 3 contract audit was not found");
    }
    return { status: audit.status, verificationRunId: audit.verificationRunId };
  },
});

export const continueRelease3ContractAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args): Promise<{ done: boolean; failed?: boolean }> => {
    try {
      const state = await ctx.runQuery(auditStateReference, args);
      if (state.status === "completed" || state.status === "failed") {
        return { done: true };
      }
      if (!state.verificationRunId) {
        throw new Error("Release 3 audit verification run is missing");
      }
      const result = await ctx.runMutation(processReference, {
        runId: state.verificationRunId,
      });
      if (result.done) {
        await ctx.runMutation(finalizeAuditReference, args);
        return { done: true };
      }
      await ctx.scheduler.runAfter(0, continueAuditReference, args);
      return { done: false };
    } catch {
      await ctx.runMutation(failAuditReference, {
        auditId: args.auditId,
        failureCode: "AUDIT_BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const finalizeRelease3ContractAudit = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit?.verificationRunId || audit.phase !== "release3_contract") {
      throw new Error("Release 3 contract audit was not found");
    }
    const verification = await ctx.db.get(audit.verificationRunId);
    assertRun(verification);
    if (verification.status !== "completed") {
      throw new Error("Release 3 audit verification is incomplete");
    }
    const issues = await ctx.db
      .query("migrationIssues")
      .withIndex("by_run", (q) => q.eq("runId", verification._id))
      .collect();
    const now = Date.now();
    for (const issue of issues) {
      await ctx.db.insert("migrationIssues", {
        runId: audit.migrationRunId,
        auditId: audit._id,
        ...(issue.organizationId ? { organizationId: issue.organizationId } : {}),
        entityType: issue.entityType,
        ...(issue.entityId ? { entityId: issue.entityId } : {}),
        field: issue.field,
        code: issue.code,
        createdAt: now,
      });
    }
    await ctx.db.patch(audit._id, {
      status: "completed",
      destination: {
        ...EMPTY_DESTINATION,
        missing: verification.counters.changed,
      },
      sourceConflicts: verification.counters.conflicts,
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const failRelease3ContractAudit = internalMutation({
  args: { auditId: v.id("migrationAudits"), failureCode: v.string() },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.status === "completed" || audit.status === "failed") return;
    const now = Date.now();
    await ctx.db.patch(audit._id, {
      status: "failed",
      failureCode: args.failureCode,
      completedAt: now,
      updatedAt: now,
    });
  },
});

export const resumeRelease3ContractAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit || audit.phase !== "release3_contract" || audit.status === "completed") {
      throw new Error("Resumable Release 3 contract audit was not found");
    }
    if (
      audit.status !== "failed" &&
      Date.now() - audit.updatedAt < STALE_RUN_MILLISECONDS
    ) {
      throw new Error("Release 3 contract audit is not stale");
    }
    await ctx.db.patch(audit._id, {
      status: "queued",
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

export const getRelease3ContractAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertRun(run);
    const audit = await latestAudit(ctx, run._id);
    if (!audit || audit.phase !== "release3_contract") {
      throw new Error("Release 3 contract audit was not found");
    }
    return {
      ...audit,
      ready:
        audit.status === "completed" &&
        !audit.auditTruncated &&
        audit.sourceConflicts === 0 &&
        audit.destination.missing === 0 &&
        audit.destination.duplicate === 0 &&
        audit.destination.mismatched === 0 &&
        audit.destination.unexpected === 0,
    };
  },
});

export const listRelease3ContractAuditIssues = internalQuery({
  args: { auditId: v.id("migrationAudits"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || audit.phase !== "release3_contract") {
      throw new Error("Release 3 contract audit was not found");
    }
    const result = await ctx.db
      .query("migrationIssues")
      .withIndex("by_audit", (q) => q.eq("auditId", audit._id))
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(redactIssue) };
  },
});
