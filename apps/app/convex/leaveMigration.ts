import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireActiveMembership } from "./access";
import {
  appendLedgerEntry,
  getOrCreateBalanceProjection,
} from "./leaveLedger";
import {
  GENERAL_LEAVE_MIGRATION_KEY,
  LEAVE_ENGINE_MIGRATION_VERSION,
} from "./leaveMigrationPlanner";
import { synchronizeOrganizationStatutoryPolicies } from "./leaveStatutorySync";

export { planOrganizationLeaveMigration } from "./leaveMigrationPlanner";

const MIGRATION_KEY = "leave-engine-v2" as const;
const MAX_BATCH_SIZE = 100;
const MAX_COMPARISON_ROWS = 1_000;

type MigrationContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;
type ComparisonContext = Pick<QueryCtx | MutationCtx, "db">;
type MigrationRun = Doc<"leaveMigrationRuns">;
type BalanceSnapshot = Doc<"leaveMigrationBalanceSnapshots">;
type LegacyLeaveTypeSnapshot = MigrationRun["legacyLeaveTypes"][number];

export type LeaveMigrationBatchResult = {
  createdRows: number;
  nextCursor?: string;
};

export type LeaveMigrationComparison = {
  policyMismatches: string[];
  versionMismatches: string[];
  balanceMismatches: string[];
  requestMismatches: string[];
  ledgerMismatches: string[];
  settingsMismatches: string[];
  cutoverMismatches: string[];
};

function normalizeSourceKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unnamed";
}

function sourceKeyForRequest(
  run: MigrationRun,
  request: Doc<"leaveRequests">,
): string {
  if (run.leaveTrackerMode === "general") return GENERAL_LEAVE_MIGRATION_KEY;
  return normalizeSourceKey(
    request.leaveType === "custom"
      ? request.customLeaveType ?? request.leaveType
      : request.leaveType,
  );
}

function assertBatchSize(batchSize: number): void {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(`Migration batch size must be between 1 and ${MAX_BATCH_SIZE}`);
  }
}

async function requireMigrationOwner(
  ctx: MigrationContext,
  organizationId: Id<"organizations">,
) {
  const access = await requireActiveMembership(ctx, organizationId);
  if (access.membership.role !== "owner") {
    throw new Error("Organization owner access is required");
  }
  return access;
}

async function findMigrationRun(
  ctx: ComparisonContext,
  organizationId: Id<"organizations">,
): Promise<MigrationRun | null> {
  return ctx.db
    .query("leaveMigrationRuns")
    .withIndex("by_organization_key", (builder) =>
      builder.eq("organizationId", organizationId).eq("key", MIGRATION_KEY),
    )
    .unique();
}

export async function assertLegacyLeaveWriteAllowed(
  ctx: ComparisonContext,
  organizationId: Id<"organizations">,
): Promise<void> {
  const run = await findMigrationRun(ctx, organizationId);
  if (
    run &&
    (run.status === "auditing" ||
      run.status === "ready" ||
      run.status === "reconciliation_required" ||
      run.status === "active")
  ) {
    throw new Error(
      "Legacy leave writes are locked while the canonical leave engine is being finalized",
    );
  }
}

export async function assertLeavePolicyAdministrationAllowed(
  ctx: ComparisonContext,
  organizationId: Id<"organizations">,
): Promise<void> {
  const run = await findMigrationRun(ctx, organizationId);
  if (run && run.status !== "active") {
    throw new Error(
      "Leave policies are locked until migration comparison and activation are complete",
    );
  }
}

async function loadLeaveSettings(
  ctx: ComparisonContext,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizationLeaveSettings"> | null> {
  const rows = await ctx.db
    .query("organizationLeaveSettings")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .take(2);
  if (rows.length > 1) throw new Error("Duplicate organization leave settings");
  return rows[0] ?? null;
}

async function createMigrationRun(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  now: number,
): Promise<MigrationRun> {
  const [settings, leaveTypes] = await Promise.all([
    loadLeaveSettings(ctx, organizationId),
    ctx.db
      .query("leaveTypes")
      .withIndex("by_organization", (builder) =>
        builder.eq("organizationId", organizationId),
      )
      .take(101),
  ]);
  if (leaveTypes.length > 100) {
    throw new Error("Organization leave type configuration exceeds the migration limit");
  }
  const runId = await ctx.db.insert("leaveMigrationRuns", {
    organizationId,
    key: MIGRATION_KEY,
    version: LEAVE_ENGINE_MIGRATION_VERSION,
    status: "migrating",
    cutoverCandidateAt: now,
    employmentSector: settings?.employmentSector,
    leaveTrackerMode: settings?.leaveTrackerMode ?? "by_type",
    proratedLeave: settings?.proratedLeave,
    leaveAccrualFrequency: settings?.leaveAccrualFrequency,
    enableAnniversaryLeave: settings?.enableAnniversaryLeave,
    anniversaryLeaveMaxDays: settings?.anniversaryLeaveMaxDays,
    maxConvertibleLeaveDays: settings?.maxConvertibleLeaveDays,
    annualSil: settings?.annualSil,
    grantLeaveUponRegularization: settings?.grantLeaveUponRegularization,
    paidLeaveRequiresRegularization:
      settings?.paidLeaveRequiresRegularization,
    leaveGuidelines: settings?.leaveGuidelines,
    leaveRequestFormTemplate: settings?.leaveRequestFormTemplate,
    legacyLeaveTypes: leaveTypes.map((leaveType) => ({
      sourceKey: normalizeSourceKey(leaveType.sourceKey ?? leaveType.name),
      name: leaveType.name,
      maxDays: leaveType.maxDays,
      isPaid: leaveType.isPaid,
      accrualRate: leaveType.accrualRate,
      defaultCredits: leaveType.defaultCredits,
      maxConsecutiveDays: leaveType.maxConsecutiveDays,
      carryOver: leaveType.carryOver,
      maxCarryOver: leaveType.maxCarryOver,
      isAnniversary: leaveType.isAnniversary,
    })),
    sourceBalanceCount: 0,
    sourceRequestCount: 0,
    sourcePolicyCount: 0,
    reconciliationRequired: false,
    snapshotPhase: "balances",
    migrationPhase: "balances",
    auditPhase: "balances",
    auditedBalanceCount: 0,
    auditedRequestCount: 0,
    sourceDriftMismatches: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  const run = await ctx.db.get(runId);
  if (!run) throw new Error("Failed to create leave migration run");
  return run;
}

function legacyBalanceDigest(balance: Doc<"employeeLeaveBalances">): string {
  return JSON.stringify(balance);
}

function legacyRequestDigest(request: Doc<"leaveRequests">): string {
  const {
    policyId,
    policyVersionId,
    engineVersion,
    cutoverAt,
    ...businessHistory
  } = request;
  void policyId;
  void policyVersionId;
  void engineVersion;
  void cutoverAt;
  return JSON.stringify(businessHistory);
}

function snapshotSourceKey(run: MigrationRun, leaveTypeKey: string): string {
  return run.leaveTrackerMode === "general"
    ? GENERAL_LEAVE_MIGRATION_KEY
    : normalizeSourceKey(leaveTypeKey);
}

async function snapshotLegacyBalances(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  now: number,
): Promise<{ run: MigrationRun; createdRows: number; complete: boolean }> {
  if (run.snapshotPhase !== "balances") {
    return { run, createdRows: 0, complete: true };
  }
  const page = await ctx.db
    .query("employeeLeaveBalances")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", run.organizationId),
    )
    .filter((builder) => builder.eq(builder.field("periodStart"), undefined))
    .paginate({ cursor: run.snapshotCursor ?? null, numItems: batchSize });
  let createdRows = 0;
  let sourceBalanceCount = run.sourceBalanceCount;
  let reconciliationRequired = run.reconciliationRequired;
  for (const balance of page.page) {
    const policySourceKey = snapshotSourceKey(run, balance.leaveTypeKey);
    const existing = await ctx.db
      .query("leaveMigrationBalanceSnapshots")
      .withIndex("by_run_employee_year_account", (builder) =>
        builder
          .eq("migrationRunId", run._id)
          .eq("employeeId", balance.employeeId)
          .eq("year", balance.year)
          .eq("policySourceKey", policySourceKey),
      )
      .unique();
    if (existing?.sourceBalanceIds.includes(balance._id)) continue;
    const total = (existing?.total ?? 0) + balance.total;
    const used = (existing?.used ?? 0) + balance.used;
    const available = (existing?.balance ?? 0) + balance.balance;
    const reconciliationAmount = available - (total - used);
    const reconciliationStatus =
      reconciliationAmount === 0 ? "matching" : "reconciliation_required";
    const sourceBalanceIds = [...(existing?.sourceBalanceIds ?? []), balance._id];
    const sourceRowDigests = [
      ...(existing?.sourceRowDigests ?? []),
      legacyBalanceDigest(balance),
    ];
    const sourceLeaveTypeKeys = [
      ...new Set([
        ...(existing?.sourceLeaveTypeKeys ?? []),
        normalizeSourceKey(balance.leaveTypeKey),
      ]),
    ].sort();
    if (existing) {
      await ctx.db.patch(existing._id, {
        sourceBalanceIds,
        sourceRowDigests,
        sourceLeaveTypeKeys,
        total,
        used,
        balance: available,
        reconciliationAmount,
        reconciliationStatus,
      });
    } else {
      await ctx.db.insert("leaveMigrationBalanceSnapshots", {
        migrationRunId: run._id,
        organizationId: run.organizationId,
        employeeId: balance.employeeId,
        year: balance.year,
        sourceBalanceIds,
        sourceRowDigests,
        sourceLeaveTypeKeys,
        policySourceKey,
        accountBehavior:
          run.leaveTrackerMode === "general"
            ? "shared_pool"
            : "individual_account",
        poolKey:
          run.leaveTrackerMode === "general"
            ? GENERAL_LEAVE_MIGRATION_KEY
            : undefined,
        total,
        used,
        balance: available,
        reconciliationAmount,
        reconciliationStatus,
        createdAt: now,
      });
      createdRows += 1;
    }
    sourceBalanceCount += 1;
    reconciliationRequired ||= reconciliationAmount !== 0;
  }
  await ctx.db.patch(run._id, {
    sourceBalanceCount,
    reconciliationRequired,
    snapshotPhase: page.isDone ? "requests" : "balances",
    snapshotCursor: page.isDone ? undefined : page.continueCursor,
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, createdRows, complete: page.isDone };
}

async function snapshotLegacyRequests(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  now: number,
): Promise<{ run: MigrationRun; createdRows: number; complete: boolean }> {
  if (run.snapshotPhase !== "requests") {
    return { run, createdRows: 0, complete: run.snapshotPhase === "complete" };
  }
  const page = await ctx.db
    .query("leaveRequests")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", run.organizationId),
    )
    .paginate({ cursor: run.snapshotCursor ?? null, numItems: batchSize });
  let createdRows = 0;
  let sourceRequestCount = run.sourceRequestCount;
  for (const request of page.page) {
    const existing = await ctx.db
      .query("leaveMigrationRequestSnapshots")
      .withIndex("by_run_request", (builder) =>
        builder.eq("migrationRunId", run._id).eq("leaveRequestId", request._id),
      )
      .unique();
    if (existing) continue;
    await ctx.db.insert("leaveMigrationRequestSnapshots", {
      migrationRunId: run._id,
      organizationId: run.organizationId,
      leaveRequestId: request._id,
      employeeId: request.employeeId,
      status: request.status,
      numberOfDays: request.numberOfDays,
      policyId: request.policyId,
      policyVersionId: request.policyVersionId,
      sourceDigest: legacyRequestDigest(request),
      createdAt: now,
    });
    sourceRequestCount += 1;
    createdRows += 1;
  }
  await ctx.db.patch(run._id, {
    sourceRequestCount,
    snapshotPhase: page.isDone ? "complete" : "requests",
    snapshotCursor: page.isDone ? undefined : page.continueCursor,
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, createdRows, complete: page.isDone };
}

type MigratedPolicySpec = {
  name: string;
  category: Doc<"leavePolicies">["category"];
  confidentiality: Doc<"leavePolicies">["confidentiality"];
  accountBehavior: Doc<"leavePolicyVersions">["accountBehavior"];
  poolKey?: string;
  payTreatment: Doc<"leavePolicyVersions">["payTreatment"];
  durationBasis: Doc<"leavePolicyVersions">["durationBasis"];
  entitlementMethod: Doc<"leavePolicyVersions">["entitlementMethod"];
  annualUnits?: number;
  accrualRate?: number;
  eligibilityBasis: Doc<"leavePolicyVersions">["eligibilityBasis"];
  completedServiceMonths: number;
  prorationMethod: Doc<"leavePolicyVersions">["prorationMethod"];
  carryoverMode: Doc<"leavePolicyVersions">["carryoverMode"];
  carryoverCap?: number;
  conversionAllowed: boolean;
  maxConvertibleUnits?: number;
  maximumConsecutiveUnits?: number;
  qualifyingEventRequired?: boolean;
};

const RESTRICTED_LEAVE_KEYS = new Set(["vawc", "solo-parent"]);
const EVENT_LEAVE_KEYS = new Set([
  "maternity",
  "paternity",
  "vawc",
  "special-leave-women",
  "adoption",
]);

function matchingLegacyLeaveType(
  run: MigrationRun,
  sourceKey: string,
): LegacyLeaveTypeSnapshot | undefined {
  return run.legacyLeaveTypes.find(
    (leaveType) => leaveType.sourceKey === sourceKey,
  );
}

function displayName(sourceKey: string): string {
  return sourceKey
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function migratedPolicySpec(
  run: MigrationRun,
  sourceKey: string,
  requestedAccountBehavior: "shared_pool" | "individual_account",
): MigratedPolicySpec {
  const legacyType = matchingLegacyLeaveType(run, sourceKey);
  const normalizedKey = sourceKey.replace(/^private-|^government-/, "");
  const isEventLeave = EVENT_LEAVE_KEYS.has(normalizedKey);
  if (isEventLeave && !legacyType) {
    return {
      name: displayName(normalizedKey),
      category: "statutory",
      confidentiality: RESTRICTED_LEAVE_KEYS.has(normalizedKey)
        ? "restricted"
        : "standard",
      accountBehavior: "non_credit",
      payTreatment:
        normalizedKey === "maternity"
          ? "statutory_benefit_supported"
          : "statutory_paid",
      durationBasis:
        normalizedKey === "maternity" || normalizedKey === "paternity"
          ? "calendar_days"
          : "event_defined",
      entitlementMethod: "event_based",
      eligibilityBasis: "event",
      completedServiceMonths: 0,
      prorationMethod: "none",
      carryoverMode: "none",
      conversionAllowed: false,
      qualifyingEventRequired: true,
    };
  }
  const annualUnits =
    sourceKey === GENERAL_LEAVE_MIGRATION_KEY
      ? run.annualSil
      : legacyType?.defaultCredits ?? legacyType?.maxDays;
  const entitlementMethod = legacyType?.isAnniversary
    ? ("anniversary" as const)
    : legacyType?.accrualRate !== undefined
      ? ("monthly" as const)
      : run.leaveAccrualFrequency ?? "annual";
  const carryoverMode = legacyType?.carryOver
    ? legacyType.maxCarryOver !== undefined
      ? ("capped" as const)
      : ("unlimited" as const)
    : ("none" as const);
  const accountBehavior =
    sourceKey === GENERAL_LEAVE_MIGRATION_KEY
      ? ("shared_pool" as const)
      : requestedAccountBehavior;
  return {
    name:
      sourceKey === GENERAL_LEAVE_MIGRATION_KEY
        ? "General Leave"
        : legacyType?.name ?? displayName(sourceKey),
    category: "company",
    confidentiality: "standard",
    accountBehavior,
    poolKey:
      accountBehavior === "shared_pool" ? GENERAL_LEAVE_MIGRATION_KEY : undefined,
    payTreatment: legacyType?.isPaid === false ? "unpaid" : "company_paid",
    durationBasis: "scheduled_work",
    entitlementMethod,
    annualUnits,
    accrualRate:
      legacyType?.accrualRate ??
      (entitlementMethod === "monthly" && annualUnits !== undefined
        ? annualUnits / 12
        : undefined),
    eligibilityBasis: run.paidLeaveRequiresRegularization
      ? "regularization_date"
      : "hire_date",
    completedServiceMonths: 0,
    prorationMethod: run.proratedLeave ? "calendar_months" : "none",
    carryoverMode,
    carryoverCap: carryoverMode === "capped" ? legacyType?.maxCarryOver : undefined,
    conversionAllowed: (run.maxConvertibleLeaveDays ?? 0) > 0,
    maxConvertibleUnits: run.maxConvertibleLeaveDays,
    maximumConsecutiveUnits: legacyType?.maxConsecutiveDays,
  };
}

function policyMatchesSpec(
  policy: Doc<"leavePolicies">,
  spec: MigratedPolicySpec,
): boolean {
  return (
    policy.name === spec.name &&
    policy.category === spec.category &&
    policy.confidentiality === spec.confidentiality &&
    policy.state === "active"
  );
}

function versionMatchesSpec(
  version: Doc<"leavePolicyVersions">,
  spec: MigratedPolicySpec,
  effectiveStart: number,
): boolean {
  return (
    version.version === 1 &&
    version.effectiveStart === effectiveStart &&
    version.effectiveEnd === undefined &&
    version.accountBehavior === spec.accountBehavior &&
    version.poolKey === spec.poolKey &&
    version.payTreatment === spec.payTreatment &&
    version.durationBasis === spec.durationBasis &&
    version.entitlementMethod === spec.entitlementMethod &&
    version.annualUnits === spec.annualUnits &&
    version.accrualRate === spec.accrualRate &&
    version.eligibilityBasis === spec.eligibilityBasis &&
    version.completedServiceMonths === spec.completedServiceMonths &&
    version.prorationMethod === spec.prorationMethod &&
    version.roundingIncrement === 0.5 &&
    version.carryoverMode === spec.carryoverMode &&
    version.carryoverCap === spec.carryoverCap &&
    version.conversionAllowed === spec.conversionAllowed &&
    version.maxConvertibleUnits === spec.maxConvertibleUnits &&
    version.maximumConsecutiveUnits === spec.maximumConsecutiveUnits &&
    version.qualifyingEventRequired === spec.qualifyingEventRequired
  );
}

async function ensurePolicy(
  ctx: MutationCtx,
  run: MigrationRun,
  sourceKey: string,
  accountBehavior: "shared_pool" | "individual_account",
  userId: Id<"users">,
  now: number,
): Promise<{
  policy: Doc<"leavePolicies">;
  version: Doc<"leavePolicyVersions">;
  createdRows: number;
}> {
  const spec = migratedPolicySpec(run, sourceKey, accountBehavior);
  let createdRows = 0;
  let policy = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization_source_key", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("sourceKey", sourceKey),
    )
    .unique();
  if (!policy) {
    const policyId = await ctx.db.insert("leavePolicies", {
      organizationId: run.organizationId,
      sourceKey,
      name: spec.name,
      description: "Migrated from the existing organization leave configuration.",
      category: spec.category,
      confidentiality: spec.confidentiality,
      state: "active",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Failed to create migrated leave policy");
    createdRows += 1;
  }
  let version = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_version", (builder) =>
      builder.eq("leavePolicyId", policy._id).eq("version", 1),
    )
    .unique();
  if (!version) {
    const versionId = await ctx.db.insert("leavePolicyVersions", {
      organizationId: run.organizationId,
      leavePolicyId: policy._id,
      version: 1,
      effectiveStart: run.cutoverCandidateAt,
      accountBehavior: spec.accountBehavior,
      poolKey: spec.poolKey,
      payTreatment: spec.payTreatment,
      durationBasis: spec.durationBasis,
      entitlementMethod: spec.entitlementMethod,
      annualUnits: spec.annualUnits,
      accrualRate: spec.accrualRate,
      eligibilityBasis: spec.eligibilityBasis,
      completedServiceMonths: spec.completedServiceMonths,
      prorationMethod: spec.prorationMethod,
      roundingIncrement: 0.5,
      carryoverMode: spec.carryoverMode,
      carryoverCap: spec.carryoverCap,
      conversionAllowed: spec.conversionAllowed,
      maxConvertibleUnits: spec.maxConvertibleUnits,
      maximumConsecutiveUnits: spec.maximumConsecutiveUnits,
      qualifyingEventRequired: spec.qualifyingEventRequired,
      createdBy: userId,
      createdAt: now,
      changeReason: "Opening migration to leave policy engine v2",
    });
    version = await ctx.db.get(versionId);
    if (!version) throw new Error("Failed to create migrated leave policy version");
    createdRows += 1;
  }
  if (
    !policyMatchesSpec(policy, spec) ||
    !versionMatchesSpec(version, spec, run.cutoverCandidateAt)
  ) {
    throw new Error("Migrated leave policy conflicts with an existing version");
  }
  return { policy, version, createdRows };
}

function periodForYear(year: number): { start: number; end: number } {
  return {
    start: Date.parse(`${year}-01-01T00:00:00+08:00`),
    end: Date.parse(`${year + 1}-01-01T00:00:00+08:00`) - 1,
  };
}

function openingEntries(snapshot: BalanceSnapshot): Array<{
  kind: "opening_grant" | "opening_usage" | "migration_reconciliation";
  amount: number;
  suffix: string;
}> {
  const entries: Array<{
    kind: "opening_grant" | "opening_usage" | "migration_reconciliation";
    amount: number;
    suffix: string;
  }> = [];
  if (snapshot.total !== 0) {
    entries.push({ kind: "opening_grant", amount: snapshot.total, suffix: "grant" });
  }
  if (snapshot.used !== 0) {
    entries.push({ kind: "opening_usage", amount: -snapshot.used, suffix: "usage" });
  }
  if (snapshot.reconciliationAmount !== 0) {
    entries.push({
      kind: "migration_reconciliation",
      amount: snapshot.reconciliationAmount,
      suffix: "reconciliation",
    });
  }
  return entries;
}

function entryIdempotencyKey(
  run: MigrationRun,
  snapshot: BalanceSnapshot,
  suffix: string,
): string {
  return [
    MIGRATION_KEY,
    run._id,
    snapshot.employeeId,
    snapshot.year,
    snapshot.policySourceKey,
    suffix,
  ].join(":");
}

async function migrateBalanceSnapshots(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  userId: Id<"users">,
  now: number,
): Promise<{ run: MigrationRun; createdRows: number; complete: boolean }> {
  if (run.migrationPhase !== "balances") {
    return { run, createdRows: 0, complete: true };
  }
  const page = await ctx.db
    .query("leaveMigrationBalanceSnapshots")
    .withIndex("by_organization_run", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("migrationRunId", run._id),
    )
    .paginate({ cursor: run.migrationCursor ?? null, numItems: batchSize });
  let createdRows = 0;
  let sourcePolicyCount = run.sourcePolicyCount;
  for (const snapshot of page.page) {
    const ensured = await ensurePolicy(
      ctx,
      run,
      snapshot.policySourceKey,
      snapshot.accountBehavior,
      userId,
      now,
    );
    createdRows += ensured.createdRows;
    sourcePolicyCount += ensured.createdRows > 0 ? 1 : 0;
    const period = periodForYear(snapshot.year);
    const existingBalance = snapshot.poolKey
      ? await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_pool_period", (builder) =>
            builder
              .eq("organizationId", run.organizationId)
              .eq("employeeId", snapshot.employeeId)
              .eq("poolKey", snapshot.poolKey)
              .eq("periodStart", period.start)
              .eq("periodEnd", period.end),
          )
          .unique()
      : await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_policy_period", (builder) =>
            builder
              .eq("organizationId", run.organizationId)
              .eq("employeeId", snapshot.employeeId)
              .eq("policyId", ensured.policy._id)
              .eq("periodStart", period.start)
              .eq("periodEnd", period.end),
          )
          .unique();
    const balance = await getOrCreateBalanceProjection(ctx, {
      organizationId: run.organizationId,
      employeeId: snapshot.employeeId,
      policyId: ensured.policy._id,
      policyVersionId: ensured.version._id,
      poolKey: snapshot.poolKey,
      periodStart: period.start,
      periodEnd: period.end,
      year: snapshot.year,
      leaveTypeKey: snapshot.policySourceKey,
      total: 0,
      used: 0,
      balance: 0,
      source: "legacy_tracker",
      updatedBy: userId,
      approvedDays: 0,
      reconciliationStatus:
        snapshot.reconciliationStatus === "matching" ? "matching" : "mismatched",
      migrationVersion: LEAVE_ENGINE_MIGRATION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    if (!existingBalance) createdRows += 1;
    for (const entry of openingEntries(snapshot)) {
      const idempotencyKey = entryIdempotencyKey(run, snapshot, entry.suffix);
      const existingEntry = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (builder) =>
          builder
            .eq("organizationId", run.organizationId)
            .eq("idempotencyKey", idempotencyKey),
        )
        .unique();
      await appendLedgerEntry(ctx, {
        organizationId: run.organizationId,
        employeeId: snapshot.employeeId,
        balanceId: balance._id,
        policyVersionId: ensured.version._id,
        effectiveDate: run.cutoverCandidateAt,
        kind: entry.kind,
        amount: entry.amount,
        unit: "day",
        referenceType: "migration",
        leaveMigrationRunId: run._id,
        actorId: userId,
        reason: "Opening balance migrated to leave policy engine v2",
        idempotencyKey,
        createdAt: now,
      });
      if (!existingEntry) createdRows += 1;
    }
    if (snapshot.reconciliationStatus === "reconciliation_required") {
      await ctx.db.patch(balance._id, { engineStatus: "reconciliation_required" });
    }
  }
  await ctx.db.patch(run._id, {
    sourcePolicyCount,
    migrationPhase: page.isDone ? "requests" : "balances",
    migrationCursor: page.isDone ? undefined : page.continueCursor,
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, createdRows, complete: page.isDone };
}

async function migrateRequestSnapshots(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  userId: Id<"users">,
  now: number,
): Promise<{ run: MigrationRun; createdRows: number; complete: boolean }> {
  if (run.migrationPhase !== "requests") {
    return { run, createdRows: 0, complete: run.migrationPhase === "complete" };
  }
  const page = await ctx.db
    .query("leaveMigrationRequestSnapshots")
    .withIndex("by_organization_run", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("migrationRunId", run._id),
    )
    .paginate({ cursor: run.migrationCursor ?? null, numItems: batchSize });
  let createdRows = 0;
  let sourcePolicyCount = run.sourcePolicyCount;
  for (const snapshot of page.page) {
    const request = await ctx.db.get(snapshot.leaveRequestId);
    if (
      !request ||
      request.organizationId !== run.organizationId ||
      request.employeeId !== snapshot.employeeId
    ) {
      throw new Error("Leave request changed during migration");
    }
    const sourceKey = sourceKeyForRequest(run, request);
    const ensured = await ensurePolicy(
      ctx,
      run,
      sourceKey,
      run.leaveTrackerMode === "general" ? "shared_pool" : "individual_account",
      userId,
      now,
    );
    createdRows += ensured.createdRows;
    sourcePolicyCount += ensured.createdRows > 0 ? 1 : 0;
    if (
      request.policyId !== ensured.policy._id ||
      request.policyVersionId !== ensured.version._id ||
      request.engineVersion !== LEAVE_ENGINE_MIGRATION_VERSION ||
      request.cutoverAt !== run.cutoverCandidateAt
    ) {
      await ctx.db.patch(request._id, {
        policyId: ensured.policy._id,
        policyVersionId: ensured.version._id,
        engineVersion: LEAVE_ENGINE_MIGRATION_VERSION,
        cutoverAt: run.cutoverCandidateAt,
      });
    }
  }
  const complete = page.isDone;
  await ctx.db.patch(run._id, {
    sourcePolicyCount,
    migrationPhase: complete ? "complete" : "requests",
    migrationCursor: complete ? undefined : page.continueCursor,
    status: complete ? "auditing" : "migrating",
    completedAt: complete ? now : undefined,
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, createdRows, complete };
}

async function canonicalBalanceSnapshotMatches(
  ctx: ComparisonContext,
  run: MigrationRun,
  snapshot: BalanceSnapshot,
): Promise<boolean> {
  const policy = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization_source_key", (builder) =>
      builder
        .eq("organizationId", run.organizationId)
        .eq("sourceKey", snapshot.policySourceKey),
    )
    .unique();
  if (!policy) return false;
  const version = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_version", (builder) =>
      builder.eq("leavePolicyId", policy._id).eq("version", 1),
    )
    .unique();
  const spec = migratedPolicySpec(
    run,
    snapshot.policySourceKey,
    snapshot.accountBehavior,
  );
  if (
    !version ||
    !policyMatchesSpec(policy, spec) ||
    !versionMatchesSpec(version, spec, run.cutoverCandidateAt)
  ) {
    return false;
  }
  const period = periodForYear(snapshot.year);
  const balance = snapshot.poolKey
    ? await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization_employee_pool_period", (builder) =>
          builder
            .eq("organizationId", run.organizationId)
            .eq("employeeId", snapshot.employeeId)
            .eq("poolKey", snapshot.poolKey)
            .eq("periodStart", period.start)
            .eq("periodEnd", period.end),
        )
        .unique()
    : await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization_employee_policy_period", (builder) =>
          builder
            .eq("organizationId", run.organizationId)
            .eq("employeeId", snapshot.employeeId)
            .eq("policyId", policy._id)
            .eq("periodStart", period.start)
            .eq("periodEnd", period.end),
        )
        .unique();
  if (
    !balance ||
    balance.total !== snapshot.total ||
    balance.used !== snapshot.used ||
    balance.balance !== snapshot.balance
  ) {
    return false;
  }
  for (const expected of openingEntries(snapshot)) {
    const entry = await ctx.db
      .query("leaveLedgerEntries")
      .withIndex("by_organization_idempotency_key", (builder) =>
        builder
          .eq("organizationId", run.organizationId)
          .eq(
            "idempotencyKey",
            entryIdempotencyKey(run, snapshot, expected.suffix),
          ),
      )
      .unique();
    if (
      !entry ||
      entry.kind !== expected.kind ||
      entry.amount !== expected.amount ||
      entry.leaveMigrationRunId !== run._id
    ) {
      return false;
    }
  }
  return true;
}

async function canonicalRequestSnapshotMatches(
  ctx: ComparisonContext,
  run: MigrationRun,
  snapshot: Doc<"leaveMigrationRequestSnapshots">,
  request: Doc<"leaveRequests">,
): Promise<boolean> {
  const sourceKey = sourceKeyForRequest(run, request);
  const policy = await ctx.db
    .query("leavePolicies")
    .withIndex("by_organization_source_key", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("sourceKey", sourceKey),
    )
    .unique();
  if (!policy) return false;
  const version = await ctx.db
    .query("leavePolicyVersions")
    .withIndex("by_policy_version", (builder) =>
      builder.eq("leavePolicyId", policy._id).eq("version", 1),
    )
    .unique();
  const behavior =
    run.leaveTrackerMode === "general" ? "shared_pool" : "individual_account";
  const spec = migratedPolicySpec(run, sourceKey, behavior);
  return (
    version !== null &&
    policyMatchesSpec(policy, spec) &&
    versionMatchesSpec(version, spec, run.cutoverCandidateAt) &&
    request.policyId === policy._id &&
    request.policyVersionId === version._id &&
    request.engineVersion === LEAVE_ENGINE_MIGRATION_VERSION &&
    request.cutoverAt === run.cutoverCandidateAt &&
    legacyRequestDigest(request) === snapshot.sourceDigest
  );
}

async function auditLegacyBalances(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  now: number,
): Promise<{ run: MigrationRun; complete: boolean }> {
  const page = await ctx.db
    .query("employeeLeaveBalances")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", run.organizationId),
    )
    .filter((builder) => builder.eq(builder.field("periodStart"), undefined))
    .paginate({ cursor: run.auditCursor ?? null, numItems: batchSize });
  let auditedBalanceCount = run.auditedBalanceCount;
  let sourceDriftMismatches = run.sourceDriftMismatches;
  for (const balance of page.page) {
    const sourceKey = snapshotSourceKey(run, balance.leaveTypeKey);
    const snapshot = await ctx.db
      .query("leaveMigrationBalanceSnapshots")
      .withIndex("by_run_employee_year_account", (builder) =>
        builder
          .eq("migrationRunId", run._id)
          .eq("employeeId", balance.employeeId)
          .eq("year", balance.year)
          .eq("policySourceKey", sourceKey),
      )
      .unique();
    const sourceIndex = snapshot?.sourceBalanceIds.indexOf(balance._id) ?? -1;
    if (
      sourceIndex < 0 ||
      snapshot?.sourceRowDigests[sourceIndex] !== legacyBalanceDigest(balance) ||
      !(snapshot && (await canonicalBalanceSnapshotMatches(ctx, run, snapshot)))
    ) {
      sourceDriftMismatches += 1;
    }
    auditedBalanceCount += 1;
  }
  if (page.isDone && auditedBalanceCount !== run.sourceBalanceCount) {
    sourceDriftMismatches += 1;
  }
  await ctx.db.patch(run._id, {
    auditedBalanceCount,
    sourceDriftMismatches,
    auditPhase: page.isDone ? "requests" : "balances",
    auditCursor: page.isDone ? undefined : page.continueCursor,
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, complete: page.isDone };
}

async function auditLegacyRequests(
  ctx: MutationCtx,
  run: MigrationRun,
  batchSize: number,
  now: number,
): Promise<{ run: MigrationRun; complete: boolean }> {
  const page = await ctx.db
    .query("leaveRequests")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", run.organizationId),
    )
    .paginate({ cursor: run.auditCursor ?? null, numItems: batchSize });
  let auditedRequestCount = run.auditedRequestCount;
  let sourceDriftMismatches = run.sourceDriftMismatches;
  for (const request of page.page) {
    const snapshot = await ctx.db
      .query("leaveMigrationRequestSnapshots")
      .withIndex("by_run_request", (builder) =>
        builder.eq("migrationRunId", run._id).eq("leaveRequestId", request._id),
      )
      .unique();
    if (
      !snapshot ||
      snapshot.sourceDigest !== legacyRequestDigest(request) ||
      !(await canonicalRequestSnapshotMatches(ctx, run, snapshot, request))
    ) {
      sourceDriftMismatches += 1;
    }
    auditedRequestCount += 1;
  }
  if (page.isDone && auditedRequestCount !== run.sourceRequestCount) {
    sourceDriftMismatches += 1;
  }
  const complete = page.isDone;
  await ctx.db.patch(run._id, {
    auditedRequestCount,
    sourceDriftMismatches,
    auditPhase: complete ? "complete" : "requests",
    auditCursor: complete ? undefined : page.continueCursor,
    status: complete
      ? sourceDriftMismatches > 0 || run.reconciliationRequired
        ? "reconciliation_required"
        : "ready"
      : "auditing",
    updatedAt: now,
  });
  const updated = await ctx.db.get(run._id);
  if (!updated) throw new Error("Leave migration run disappeared");
  return { run: updated, complete };
}

export const runOrganizationLeaveMigrationBatch = mutation({
  args: {
    organizationId: v.id("organizations"),
    batchSize: v.number(),
  },
  handler: async (ctx, args): Promise<LeaveMigrationBatchResult> => {
    assertBatchSize(args.batchSize);
    const access = await requireMigrationOwner(ctx, args.organizationId);
    const now = Date.now();
    let run = await findMigrationRun(ctx, args.organizationId);
    let createdRows = 0;
    if (!run) {
      run = await createMigrationRun(ctx, args.organizationId, access.user._id, now);
      createdRows += 1;
    }
    if (run.status === "active" || run.auditPhase === "complete") {
      return { createdRows };
    }
    if (run.snapshotPhase === "balances") {
      const result = await snapshotLegacyBalances(ctx, run, args.batchSize, now);
      return {
        createdRows: createdRows + result.createdRows,
        nextCursor: result.complete ? "snapshot:requests" : result.run.snapshotCursor,
      };
    }
    if (run.snapshotPhase === "requests") {
      const result = await snapshotLegacyRequests(ctx, run, args.batchSize, now);
      return {
        createdRows: createdRows + result.createdRows,
        nextCursor: result.complete
          ? "migration:balances"
          : result.run.snapshotCursor,
      };
    }
    if (run.migrationPhase === "balances") {
      const result = await migrateBalanceSnapshots(
        ctx,
        run,
        args.batchSize,
        access.user._id,
        now,
      );
      return {
        createdRows: createdRows + result.createdRows,
        nextCursor: result.complete
          ? "migration:requests"
          : result.run.migrationCursor,
      };
    }
    if (run.migrationPhase === "requests") {
      const result = await migrateRequestSnapshots(
        ctx,
        run,
        args.batchSize,
        access.user._id,
        now,
      );
      return {
        createdRows: createdRows + result.createdRows,
        nextCursor: result.complete ? "audit:balances" : result.run.migrationCursor,
      };
    }
    if (run.auditPhase === "balances") {
      const result = await auditLegacyBalances(ctx, run, args.batchSize, now);
      return {
        createdRows,
        nextCursor: result.complete ? "audit:requests" : result.run.auditCursor,
      };
    }
    const result = await auditLegacyRequests(ctx, run, args.batchSize, now);
    return {
      createdRows,
      ...(result.complete ? {} : { nextCursor: result.run.auditCursor }),
    };
  },
});

async function boundedBalanceSnapshots(
  ctx: ComparisonContext,
  run: MigrationRun,
): Promise<{
  rows: Array<Doc<"leaveMigrationBalanceSnapshots">>;
  complete: boolean;
}> {
  const rows = await ctx.db
    .query("leaveMigrationBalanceSnapshots")
    .withIndex("by_organization_run", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("migrationRunId", run._id),
    )
    .take(MAX_COMPARISON_ROWS + 1);
  return {
    rows: rows.slice(0, MAX_COMPARISON_ROWS),
    complete: rows.length <= MAX_COMPARISON_ROWS,
  };
}

async function boundedRequestSnapshots(
  ctx: ComparisonContext,
  run: MigrationRun,
): Promise<{
  rows: Array<Doc<"leaveMigrationRequestSnapshots">>;
  complete: boolean;
}> {
  const rows = await ctx.db
    .query("leaveMigrationRequestSnapshots")
    .withIndex("by_organization_run", (builder) =>
      builder.eq("organizationId", run.organizationId).eq("migrationRunId", run._id),
    )
    .take(MAX_COMPARISON_ROWS + 1);
  return {
    rows: rows.slice(0, MAX_COMPARISON_ROWS),
    complete: rows.length <= MAX_COMPARISON_ROWS,
  };
}

function sameOptional<T>(left: T | undefined, right: T | undefined): boolean {
  return left === right;
}

async function compareDurableMigration(
  ctx: ComparisonContext,
  run: MigrationRun,
): Promise<LeaveMigrationComparison> {
  const [balancePage, requestPage, settings] = await Promise.all([
    boundedBalanceSnapshots(ctx, run),
    boundedRequestSnapshots(ctx, run),
    loadLeaveSettings(ctx, run.organizationId),
  ]);
  const balanceSnapshots = balancePage.rows;
  const requestSnapshots = requestPage.rows;
  const expectedSourceKeys = new Set(balanceSnapshots.map((row) => row.policySourceKey));
  for (const snapshot of requestSnapshots) {
    const request = await ctx.db.get(snapshot.leaveRequestId);
    if (request) expectedSourceKeys.add(sourceKeyForRequest(run, request));
  }
  const policyMismatches: string[] = [];
  const versionMismatches: string[] = [];
  const policyBySourceKey = new Map<
    string,
    { policy: Doc<"leavePolicies">; version: Doc<"leavePolicyVersions"> }
  >();
  for (const sourceKey of expectedSourceKeys) {
    const policy = await ctx.db
      .query("leavePolicies")
      .withIndex("by_organization_source_key", (builder) =>
        builder.eq("organizationId", run.organizationId).eq("sourceKey", sourceKey),
      )
      .unique();
    if (!policy) {
      policyMismatches.push(sourceKey);
      continue;
    }
    const version = await ctx.db
      .query("leavePolicyVersions")
      .withIndex("by_policy_version", (builder) =>
        builder.eq("leavePolicyId", policy._id).eq("version", 1),
      )
      .unique();
    const expectedBehavior =
      run.leaveTrackerMode === "general" ? "shared_pool" : "individual_account";
    const spec = migratedPolicySpec(run, sourceKey, expectedBehavior);
    if (
      !version ||
      version.organizationId !== run.organizationId ||
      !policyMatchesSpec(policy, spec) ||
      !versionMatchesSpec(version, spec, run.cutoverCandidateAt)
    ) {
      versionMismatches.push(sourceKey);
      continue;
    }
    policyBySourceKey.set(sourceKey, { policy, version });
  }
  const balanceMismatches: string[] = [];
  const ledgerMismatches: string[] = [];
  const cutoverMismatches: string[] = [];
  for (const snapshot of balanceSnapshots) {
    const canonicalPolicy = policyBySourceKey.get(snapshot.policySourceKey);
    if (!canonicalPolicy) continue;
    const period = periodForYear(snapshot.year);
    const balance = snapshot.poolKey
      ? await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_pool_period", (builder) =>
            builder
              .eq("organizationId", run.organizationId)
              .eq("employeeId", snapshot.employeeId)
              .eq("poolKey", snapshot.poolKey)
              .eq("periodStart", period.start)
              .eq("periodEnd", period.end),
          )
          .unique()
      : await ctx.db
          .query("employeeLeaveBalances")
          .withIndex("by_organization_employee_policy_period", (builder) =>
            builder
              .eq("organizationId", run.organizationId)
              .eq("employeeId", snapshot.employeeId)
              .eq("policyId", canonicalPolicy.policy._id)
              .eq("periodStart", period.start)
              .eq("periodEnd", period.end),
          )
          .unique();
    const identity = `${snapshot.employeeId}:${snapshot.year}:${snapshot.policySourceKey}`;
    if (
      !balance ||
      balance.total !== snapshot.total ||
      balance.used !== snapshot.used ||
      balance.balance !== snapshot.balance
    ) {
      balanceMismatches.push(identity);
    }
    for (const expected of openingEntries(snapshot)) {
      const idempotencyKey = entryIdempotencyKey(run, snapshot, expected.suffix);
      const entry = await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (builder) =>
          builder
            .eq("organizationId", run.organizationId)
            .eq("idempotencyKey", idempotencyKey),
        )
        .unique();
      if (
        !entry ||
        entry.kind !== expected.kind ||
        entry.amount !== expected.amount ||
        entry.leaveMigrationRunId !== run._id
      ) {
        ledgerMismatches.push(idempotencyKey);
      }
    }
    if (balance && (balance.periodStart !== period.start || balance.periodEnd !== period.end)) {
      cutoverMismatches.push(identity);
    }
  }
  const requestMismatches: string[] = [];
  for (const snapshot of requestSnapshots) {
    const request = await ctx.db.get(snapshot.leaveRequestId);
    const sourceKey = request ? sourceKeyForRequest(run, request) : "missing";
    const canonicalPolicy = policyBySourceKey.get(sourceKey);
    if (
      !request ||
      request.organizationId !== run.organizationId ||
      request.employeeId !== snapshot.employeeId ||
      request.status !== snapshot.status ||
      request.numberOfDays !== snapshot.numberOfDays ||
      legacyRequestDigest(request) !== snapshot.sourceDigest ||
      request.policyId !== canonicalPolicy?.policy._id ||
      request.policyVersionId !== canonicalPolicy?.version._id ||
      request.engineVersion !== LEAVE_ENGINE_MIGRATION_VERSION
    ) {
      requestMismatches.push(String(snapshot.leaveRequestId));
    }
    if (request && request.cutoverAt !== run.cutoverCandidateAt) {
      cutoverMismatches.push(String(snapshot.leaveRequestId));
    }
  }
  const settingsMismatches: string[] = [];
  if (
    !settings ||
    settings.leaveTrackerMode !== run.leaveTrackerMode ||
    !sameOptional(settings.proratedLeave, run.proratedLeave) ||
    !sameOptional(settings.leaveAccrualFrequency, run.leaveAccrualFrequency) ||
    !sameOptional(settings.enableAnniversaryLeave, run.enableAnniversaryLeave) ||
    !sameOptional(settings.anniversaryLeaveMaxDays, run.anniversaryLeaveMaxDays) ||
    !sameOptional(settings.maxConvertibleLeaveDays, run.maxConvertibleLeaveDays) ||
    !sameOptional(settings.annualSil, run.annualSil) ||
    !sameOptional(
      settings.grantLeaveUponRegularization,
      run.grantLeaveUponRegularization,
    ) ||
    !sameOptional(
      settings.paidLeaveRequiresRegularization,
      run.paidLeaveRequiresRegularization,
    )
  ) {
    settingsMismatches.push(String(run.organizationId));
  }
  if (
    balancePage.complete &&
    run.sourceBalanceCount !==
      balanceSnapshots.reduce(
        (count, snapshot) => count + snapshot.sourceBalanceIds.length,
        0,
      )
  ) {
    balanceMismatches.push("source-balance-count");
  }
  if (requestPage.complete && run.sourceRequestCount !== requestSnapshots.length) {
    requestMismatches.push("source-request-count");
  }
  if (
    run.auditPhase !== "complete" ||
    run.auditedBalanceCount !== run.sourceBalanceCount ||
    run.auditedRequestCount !== run.sourceRequestCount ||
    run.sourceDriftMismatches > 0
  ) {
    settingsMismatches.push("source-drift-audit");
  }
  return {
    policyMismatches,
    versionMismatches,
    balanceMismatches,
    requestMismatches,
    ledgerMismatches,
    settingsMismatches,
    cutoverMismatches,
  };
}

export const compareOrganizationLeaveMigration = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args): Promise<LeaveMigrationComparison> => {
    await requireMigrationOwner(ctx, args.organizationId);
    const run = await findMigrationRun(ctx, args.organizationId);
    if (!run || run.snapshotPhase !== "complete" || run.migrationPhase !== "complete") {
      throw new Error("Leave migration is not complete");
    }
    return compareDurableMigration(ctx, run);
  },
});

function hasMismatches(comparison: LeaveMigrationComparison): boolean {
  return Object.values(comparison).some((mismatches) => mismatches.length > 0);
}

export const activateOrganizationLeaveEngine = mutation({
  args: {
    organizationId: v.id("organizations"),
    employmentSector: v.union(v.literal("private"), v.literal("government")),
  },
  handler: async (ctx, args): Promise<{ activated: true }> => {
    await requireMigrationOwner(ctx, args.organizationId);
    const run = await findMigrationRun(ctx, args.organizationId);
    if (!run || run.status !== "ready" || run.reconciliationRequired) {
      throw new Error("Leave migration is not ready for activation");
    }
    const comparison = await compareDurableMigration(ctx, run);
    if (hasMismatches(comparison)) {
      throw new Error("Leave migration has unresolved mismatches");
    }
    const settings = await loadLeaveSettings(ctx, args.organizationId);
    if (!settings) throw new Error("Organization leave settings are missing");
    const now = Date.now();
    await synchronizeOrganizationStatutoryPolicies(ctx, {
      organizationId: args.organizationId,
      employmentSector: args.employmentSector,
      effectiveStart: run.cutoverCandidateAt,
      changeReason: "Synchronize statutory policies during leave migration",
      userId: run.createdBy,
      now,
    });
    const companyModels = await ctx.db
      .query("leaveCompanyModelVersions")
      .withIndex("by_organization_effective", (query) =>
        query.eq("organizationId", args.organizationId),
      )
      .take(1);
    if (companyModels.length === 0) {
      await ctx.db.insert("leaveCompanyModelVersions", {
        organizationId: args.organizationId,
        version: 1,
        mode: run.leaveTrackerMode === "general" ? "pooled" : "by_type",
        effectiveStart: run.cutoverCandidateAt,
        createdBy: run.createdBy,
        changeReason: "Activate migrated company leave model",
        createdAt: now,
      });
    }
    await ctx.db.patch(settings._id, {
      employmentSector: args.employmentSector,
      companyLeaveDefaultMode:
        run.leaveTrackerMode === "general" ? "pooled" : "by_type",
      migrationState: "active",
      activePolicyEngineVersion: LEAVE_ENGINE_MIGRATION_VERSION,
      policyEngineCutoverAt: run.cutoverCandidateAt,
      migrationVersion: LEAVE_ENGINE_MIGRATION_VERSION,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      employmentSector: args.employmentSector,
      status: "active",
      updatedAt: now,
    });
    return { activated: true };
  },
});
