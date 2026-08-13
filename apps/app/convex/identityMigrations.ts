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
  IDENTITY_CREDENTIALS_MIGRATION_KEY,
  IDENTITY_CREDENTIALS_MIGRATION_VERSION,
  planInvitationTokenHash,
  planLegacyUserMembership,
  planPayslipCredential,
} from "./identityMigrationPlanner";
import type {
  IdentityMigrationIssue,
  IdentityPlan,
} from "./identityMigrationTypes";

const MAX_STATUS_ISSUES = 200;
const STALE_RUN_MILLISECONDS = 5 * 60 * 1_000;

type IdentityPhase =
  | "identity_users"
  | "identity_credentials"
  | "identity_invitations";

type MigrationCounters = Doc<"migrationRuns">["counters"];

const EMPTY_COUNTERS: MigrationCounters = {
  scanned: 0,
  changed: 0,
  unchanged: 0,
  skipped: 0,
  conflicts: 0,
  errors: 0,
};

const IDENTITY_PHASES: readonly IdentityPhase[] = [
  "identity_users",
  "identity_credentials",
  "identity_invitations",
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

function isIdentityPhase(phase: Doc<"migrationRuns">["phase"]): phase is IdentityPhase {
  return IDENTITY_PHASES.includes(phase as IdentityPhase);
}

function nextIdentityPhase(phase: IdentityPhase): IdentityPhase | null {
  const index = IDENTITY_PHASES.indexOf(phase);
  return IDENTITY_PHASES[index + 1] ?? null;
}

function assertIdentityRun(
  run: Doc<"migrationRuns"> | null,
): asserts run is Doc<"migrationRuns"> & { phase: IdentityPhase } {
  if (
    !run ||
    run.key !== IDENTITY_CREDENTIALS_MIGRATION_KEY ||
    run.version !== IDENTITY_CREDENTIALS_MIGRATION_VERSION ||
    !isIdentityPhase(run.phase)
  ) {
    throw new Error("Identity credentials migration run was not found");
  }
}

async function recordIssues(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    auditId?: Id<"migrationAudits">;
    organizationId?: Id<"organizations">;
    entityType: "user" | "employee" | "invitation";
    entityId: string;
    issues: IdentityMigrationIssue[];
    now: number;
  },
): Promise<void> {
  for (const issue of args.issues) {
    await ctx.db.insert("migrationIssues", {
      runId: args.runId,
      ...(args.auditId ? { auditId: args.auditId } : {}),
      ...(args.organizationId
        ? { organizationId: args.organizationId }
        : {}),
      entityType: args.entityType,
      entityId: args.entityId,
      field: issue.field,
      code: issue.code,
      createdAt: args.now,
    });
  }
}

function countersForPlan<T>(plan: IdentityPlan<T>): Partial<MigrationCounters> {
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

async function processUsers(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: IdentityPhase },
): Promise<{ isDone: boolean; continueCursor: string; counters: MigrationCounters }> {
  const page = await ctx.db.query("users").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const user of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const [organization, employee, lastActiveOrganization, memberships] =
      await Promise.all([
        user.organizationId ? ctx.db.get(user.organizationId) : null,
        user.employeeId ? ctx.db.get(user.employeeId) : null,
        user.lastActiveOrganizationId
          ? ctx.db.get(user.lastActiveOrganizationId)
          : null,
        user.organizationId
          ? ctx.db
              .query("userOrganizations")
              .withIndex("by_user_organization", (query) =>
                query
                  .eq("userId", user._id)
                  .eq("organizationId", user.organizationId!),
              )
              .take(2)
          : [],
      ]);
    const plan = planLegacyUserMembership({
      user: {
        ...(user.organizationId
          ? { organizationId: user.organizationId }
          : {}),
        ...(user.role ? { role: user.role } : {}),
        ...(user.employeeId ? { employeeId: user.employeeId } : {}),
        ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
        ...(user.lastActiveOrganizationId
          ? { lastActiveOrganizationId: user.lastActiveOrganizationId }
          : {}),
      },
      memberships,
      organizationExists:
        organization !== null && organization.status !== "archived",
      employee: employee
        ? {
            id: employee._id,
            organizationId: employee.organizationId,
            employmentStatus: employee.employment.status,
          }
        : null,
      lastActiveOrganizationExists:
        !user.lastActiveOrganizationId ||
        (lastActiveOrganization !== null &&
          lastActiveOrganization.status !== "archived"),
    });

    if (plan.outcome === "create" && !run.dryRun) {
      await ctx.db.insert("userOrganizations", {
        userId: user._id,
        organizationId: user.organizationId!,
        role: plan.value.role,
        accessStatus: plan.value.accessStatus,
        ...(user.employeeId ? { employeeId: user.employeeId } : {}),
        joinedAt: now,
        updatedAt: now,
      });
    } else if (plan.outcome === "conflict") {
      await recordIssues(ctx, {
        runId: run._id,
        ...(user.organizationId
          ? { organizationId: user.organizationId }
          : {}),
        entityType: "user",
        entityId: user._id,
        issues: plan.issues,
        now,
      });
    }
    counters = addCounters(counters, countersForPlan(plan));
  }

  return { ...page, counters };
}

async function processCredentials(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: IdentityPhase },
): Promise<{ isDone: boolean; continueCursor: string; counters: MigrationCounters }> {
  const page = await ctx.db.query("employees").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const employee of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const destinations = await ctx.db
      .query("payslipCredentials")
      .withIndex("by_employee", (query) =>
        query.eq("employeeId", employee._id),
      )
      .take(2);
    const plan = planPayslipCredential({
      organizationId: employee.organizationId,
      employeeId: employee._id,
      ...(employee.payslipPinHash
        ? { legacyCredentialHash: employee.payslipPinHash }
        : {}),
      destinations,
    });

    if (plan.outcome === "create" && !run.dryRun) {
      await ctx.db.insert("payslipCredentials", {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        credentialHash: plan.value.credentialHash,
        credentialVersion: plan.value.credentialVersion,
        migrationVersion: plan.value.migrationVersion,
        createdAt: now,
        updatedAt: now,
      });
    } else if (plan.outcome === "conflict") {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        issues: plan.issues,
        now,
      });
    }
    counters = addCounters(counters, countersForPlan(plan));
  }

  return { ...page, counters };
}

async function processInvitations(
  ctx: MutationCtx,
  run: Doc<"migrationRuns"> & { phase: IdentityPhase },
): Promise<{ isDone: boolean; continueCursor: string; counters: MigrationCounters }> {
  const page = await ctx.db.query("invitations").paginate({
    cursor: run.cursor ?? null,
    numItems: run.batchSize,
  });
  let counters = run.counters;
  const now = Date.now();

  for (const invitation of page.page) {
    counters = addCounters(counters, { scanned: 1 });
    const expectedPlan = planInvitationTokenHash({
      token: invitation.token,
      tokenHash: invitation.tokenHash,
      hashedTokenMatchCount: 0,
    });
    const expectedHash =
      expectedPlan.outcome === "create"
        ? expectedPlan.value.tokenHash
        : invitation.tokenHash;
    const [matchingRows, legacyTokenRows] = await Promise.all([
      expectedHash
        ? ctx.db
            .query("invitations")
            .withIndex("by_token_hash", (query) =>
              query.eq("tokenHash", expectedHash),
            )
            .take(2)
        : [],
      ctx.db
        .query("invitations")
        .withIndex("by_token", (query) => query.eq("token", invitation.token))
        .take(2),
    ]);
    const plannedHashClaimants = new Set(matchingRows.map((row) => row._id));
    for (const row of legacyTokenRows) {
      if (row._id !== invitation._id) plannedHashClaimants.add(row._id);
    }
    const plan = planInvitationTokenHash({
      token: invitation.token,
      tokenHash: invitation.tokenHash,
      hashedTokenMatchCount: plannedHashClaimants.size,
    });

    if (plan.outcome === "create" && !run.dryRun) {
      await ctx.db.patch(invitation._id, { tokenHash: plan.value.tokenHash });
    } else if (plan.outcome === "conflict") {
      await recordIssues(ctx, {
        runId: run._id,
        organizationId: invitation.organizationId,
        entityType: "invitation",
        entityId: invitation._id,
        issues: plan.issues,
        now,
      });
    }
    counters = addCounters(counters, countersForPlan(plan));
  }

  return { ...page, counters };
}

async function runIdentityCredentialsBatch(
  ctx: MutationCtx,
  runId: Id<"migrationRuns">,
) {
  const run = await ctx.db.get(runId);
  assertIdentityRun(run);
  if (run.status === "queued") {
    await ctx.db.patch(run._id, { status: "running", updatedAt: Date.now() });
  } else if (run.status !== "running") {
    throw new Error("Identity credentials migration is not active");
  }

  const page =
    run.phase === "identity_users"
      ? await processUsers(ctx, run)
      : run.phase === "identity_credentials"
        ? await processCredentials(ctx, run)
        : await processInvitations(ctx, run);
  const now = Date.now();

  if (!page.isDone) {
    await ctx.db.patch(run._id, {
      cursor: page.continueCursor,
      counters: page.counters,
      updatedAt: now,
    });
    return {
      done: false,
      cursor: page.continueCursor,
      counters: page.counters,
    };
  }

  const nextPhase = nextIdentityPhase(run.phase);
  if (nextPhase) {
    await ctx.db.patch(run._id, {
      phase: nextPhase,
      cursor: undefined,
      counters: page.counters,
      updatedAt: now,
    });
    return { done: false, cursor: null, counters: page.counters };
  }

  await ctx.db.patch(run._id, {
    status: "completed",
    cursor: undefined,
    counters: page.counters,
    updatedAt: now,
    completedAt: now,
  });
  return { done: true, cursor: null, counters: page.counters };
}

export const processIdentityCredentialsBatch = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: (ctx, args) => runIdentityCredentialsBatch(ctx, args.runId),
});

const continueMigrationReference = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> }
>("identityMigrations:continueIdentityCredentialsMigration");
const processBatchReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean }
>("identityMigrations:processIdentityCredentialsBatch");
const failMigrationReference = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; failureCode: string }
>("identityMigrations:failIdentityCredentialsMigration");

export const startIdentityCredentialsMigration = internalMutation({
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
        .withIndex("by_key_status", (query) =>
          query
            .eq("key", IDENTITY_CREDENTIALS_MIGRATION_KEY)
            .eq("status", "queued"),
        )
        .take(1)),
      ...(await ctx.db
        .query("migrationRuns")
        .withIndex("by_key_status", (query) =>
          query
            .eq("key", IDENTITY_CREDENTIALS_MIGRATION_KEY)
            .eq("status", "running"),
        )
        .take(1)),
    ];
    if (activeRuns.length > 0) {
      throw new Error("An identity credentials migration is already active");
    }

    let requiredDryRunId: Id<"migrationRuns"> | undefined;
    if (!args.dryRun) {
      if (!args.dryRunId) throw new Error("Completed dry-run is required");
      const dryRun = await ctx.db.get(args.dryRunId);
      if (
        !dryRun ||
        dryRun.key !== IDENTITY_CREDENTIALS_MIGRATION_KEY ||
        dryRun.version !== IDENTITY_CREDENTIALS_MIGRATION_VERSION ||
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
      key: IDENTITY_CREDENTIALS_MIGRATION_KEY,
      version: IDENTITY_CREDENTIALS_MIGRATION_VERSION,
      dryRun: args.dryRun,
      status: "queued",
      phase: "identity_users",
      batchSize,
      counters: EMPTY_COUNTERS,
      ...(requiredDryRunId ? { requiredDryRunId } : {}),
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueMigrationReference, { runId });

    return {
      runId,
      key: IDENTITY_CREDENTIALS_MIGRATION_KEY,
      version: IDENTITY_CREDENTIALS_MIGRATION_VERSION,
      dryRun: args.dryRun,
    };
  },
});

export const continueIdentityCredentialsMigration = internalAction({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runMutation(processBatchReference, {
        runId: args.runId,
      });
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueMigrationReference, {
          runId: args.runId,
        });
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

export const failIdentityCredentialsMigration = internalMutation({
  args: {
    runId: v.id("migrationRuns"),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.key !== IDENTITY_CREDENTIALS_MIGRATION_KEY ||
      run.version !== IDENTITY_CREDENTIALS_MIGRATION_VERSION ||
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

export const getIdentityCredentialsMigrationRun = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertIdentityRun(run);
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

export const listIdentityCredentialsMigrationIssues = internalQuery({
  args: {
    runId: v.id("migrationRuns"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertIdentityRun(run);
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

export const resumeIdentityCredentialsMigration = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertIdentityRun(run);
    if (run.status !== "queued" && run.status !== "running") {
      throw new Error("Only an active identity credentials migration can resume");
    }
    if (run.updatedAt > Date.now() - STALE_RUN_MILLISECONDS) {
      throw new Error("Identity credentials migration is not stale");
    }
    await ctx.db.patch(run._id, { status: "queued", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, continueMigrationReference, {
      runId: run._id,
    });
    return { resumed: true, runId: run._id };
  },
});

type IdentityAuditPhase =
  | "identity_users"
  | "identity_memberships"
  | "identity_credentials"
  | "identity_credential_targets"
  | "identity_invitations";

type DestinationAudit = Doc<"migrationAudits">["destination"];

const EMPTY_DESTINATION_AUDIT: DestinationAudit = {
  expected: 0,
  matching: 0,
  missing: 0,
  duplicate: 0,
  mismatched: 0,
  unexpected: 0,
  totalRows: 0,
};

const IDENTITY_AUDIT_PHASES: readonly IdentityAuditPhase[] = [
  "identity_users",
  "identity_memberships",
  "identity_credentials",
  "identity_credential_targets",
  "identity_invitations",
];

function isIdentityAuditPhase(
  phase: Doc<"migrationAudits">["phase"],
): phase is IdentityAuditPhase {
  return IDENTITY_AUDIT_PHASES.includes(phase as IdentityAuditPhase);
}

function nextIdentityAuditPhase(
  phase: IdentityAuditPhase,
): IdentityAuditPhase | null {
  const index = IDENTITY_AUDIT_PHASES.indexOf(phase);
  return IDENTITY_AUDIT_PHASES[index + 1] ?? null;
}

function hasCleanIdentityAudit(
  run: Doc<"migrationRuns">,
  audit: Doc<"migrationAudits">,
): boolean {
  return (
    run.key === IDENTITY_CREDENTIALS_MIGRATION_KEY &&
    run.version === IDENTITY_CREDENTIALS_MIGRATION_VERSION &&
    !run.dryRun &&
    run.status === "completed" &&
    run.counters.errors === 0 &&
    run.counters.conflicts === 0 &&
    audit.status === "completed" &&
    !audit.auditTruncated &&
    audit.sourceConflicts === 0 &&
    audit.destination.missing === 0 &&
    audit.destination.duplicate === 0 &&
    audit.destination.mismatched === 0 &&
    audit.destination.unexpected === 0 &&
    audit.destination.matching === audit.destination.expected
  );
}

async function getLatestIdentityAudit(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  runId: Id<"migrationRuns">,
) {
  return ctx.db
    .query("migrationAudits")
    .withIndex("by_run", (query) => query.eq("migrationRunId", runId))
    .order("desc")
    .first();
}

async function recordAuditIssue(
  ctx: MutationCtx,
  args: {
    runId: Id<"migrationRuns">;
    auditId: Id<"migrationAudits">;
    organizationId?: Id<"organizations">;
    entityType: "user" | "membership" | "employee" | "credential" | "invitation";
    entityId: string;
    field: string;
    code: string;
    now: number;
  },
): Promise<void> {
  await ctx.db.insert("migrationIssues", {
    runId: args.runId,
    auditId: args.auditId,
    ...(args.organizationId
      ? { organizationId: args.organizationId }
      : {}),
    entityType: args.entityType,
    entityId: args.entityId,
    field: args.field,
    code: args.code,
    createdAt: args.now,
  });
}

async function auditUsers(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
) {
  const page = await ctx.db.query("users").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();

  for (const user of page.page) {
    const [organization, employee, lastActiveOrganization, memberships] =
      await Promise.all([
        user.organizationId ? ctx.db.get(user.organizationId) : null,
        user.employeeId ? ctx.db.get(user.employeeId) : null,
        user.lastActiveOrganizationId
          ? ctx.db.get(user.lastActiveOrganizationId)
          : null,
        user.organizationId
          ? ctx.db
              .query("userOrganizations")
              .withIndex("by_user_organization", (query) =>
                query
                  .eq("userId", user._id)
                  .eq("organizationId", user.organizationId!),
              )
              .take(2)
          : [],
      ]);
    const organizationExists =
      organization !== null && organization.status !== "archived";
    const employeeMatches =
      !user.employeeId ||
      (employee !== null &&
        employee.organizationId === user.organizationId);
    const sourceExpected =
      Boolean(user.organizationId) &&
      Boolean(user.role) &&
      organizationExists &&
      employeeMatches;
    const plan = planLegacyUserMembership({
      user: {
        ...(user.organizationId
          ? { organizationId: user.organizationId }
          : {}),
        ...(user.role ? { role: user.role } : {}),
        ...(user.employeeId ? { employeeId: user.employeeId } : {}),
        ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
        ...(user.lastActiveOrganizationId
          ? { lastActiveOrganizationId: user.lastActiveOrganizationId }
          : {}),
      },
      memberships,
      organizationExists,
      employee: employee
        ? {
            id: employee._id,
            organizationId: employee.organizationId,
            employmentStatus: employee.employment.status,
          }
        : null,
      lastActiveOrganizationExists:
        !user.lastActiveOrganizationId ||
        (lastActiveOrganization !== null &&
          lastActiveOrganization.status !== "archived"),
    });

    if (plan.outcome === "conflict") {
      sourceConflicts += plan.issues.length;
      await recordIssues(ctx, {
        runId: run._id,
        auditId: audit._id,
        ...(user.organizationId
          ? { organizationId: user.organizationId }
          : {}),
        entityType: "user",
        entityId: user._id,
        issues: plan.issues,
        now,
      });
    }
    if (!sourceExpected) continue;

    destination.expected += 1;
    if (memberships.length === 0) {
      destination.missing += 1;
      continue;
    }
    if (memberships.length > 1) {
      destination.duplicate += 1;
      continue;
    }
    const membership = memberships[0];
    if (
      membership.role !== user.role ||
      membership.employeeId !== user.employeeId
    ) {
      destination.mismatched += 1;
    } else {
      destination.matching += 1;
    }
  }

  return { ...page, destination, sourceConflicts };
}

async function auditMemberships(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
) {
  const page = await ctx.db.query("userOrganizations").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();

  for (const membership of page.page) {
    destination.totalRows += 1;
    const [user, organization, employee, userOrganizationRows, employeeRows] =
      await Promise.all([
        ctx.db.get(membership.userId),
        ctx.db.get(membership.organizationId),
        membership.employeeId ? ctx.db.get(membership.employeeId) : null,
        ctx.db
          .query("userOrganizations")
          .withIndex("by_user_organization", (query) =>
            query
              .eq("userId", membership.userId)
              .eq("organizationId", membership.organizationId),
          )
          .take(2),
        membership.employeeId
          ? ctx.db
              .query("userOrganizations")
              .withIndex("by_organization_employee", (query) =>
                query
                  .eq("organizationId", membership.organizationId)
                  .eq("employeeId", membership.employeeId),
              )
              .take(2)
          : [],
      ]);
    const issues: Array<{ code: string; field: string }> = [];
    if (!user) issues.push({ code: "USER_NOT_FOUND", field: "userId" });
    if (!organization || organization.status === "archived") {
      issues.push({ code: "ORGANIZATION_NOT_FOUND", field: "organizationId" });
    }
    if (membership.employeeId && !employee) {
      issues.push({ code: "EMPLOYEE_NOT_FOUND", field: "employeeId" });
    } else if (
      employee &&
      employee.organizationId !== membership.organizationId
    ) {
      issues.push({
        code: "EMPLOYEE_ORGANIZATION_MISMATCH",
        field: "employeeId",
      });
    }
    if (userOrganizationRows.length > 1) {
      issues.push({
        code: "DUPLICATE_USER_MEMBERSHIP",
        field: "organizationId",
      });
      destination.duplicate += 1;
    }
    if (employeeRows.length > 1) {
      issues.push({
        code: "DUPLICATE_ORGANIZATION_EMPLOYEE_MEMBERSHIP",
        field: "employeeId",
      });
      destination.duplicate += 1;
    }
    sourceConflicts += issues.length;
    for (const issue of issues) {
      await recordAuditIssue(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: membership.organizationId,
        entityType: "membership",
        entityId: membership._id,
        field: issue.field,
        code: issue.code,
        now,
      });
    }
  }

  return { ...page, destination, sourceConflicts };
}

async function auditCredentialSources(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
) {
  const page = await ctx.db.query("employees").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();

  for (const employee of page.page) {
    if (!employee.payslipPinHash?.trim()) continue;
    destination.expected += 1;
    const rows = await ctx.db
      .query("payslipCredentials")
      .withIndex("by_employee", (query) =>
        query.eq("employeeId", employee._id),
      )
      .take(2);
    if (rows.length === 0) {
      destination.missing += 1;
      continue;
    }
    if (rows.length > 1) {
      destination.duplicate += 1;
      sourceConflicts += 1;
      await recordAuditIssue(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        field: "employeeId",
        code: "DUPLICATE_PAYSLIP_CREDENTIAL",
        now,
      });
      continue;
    }
    const credential = rows[0];
    if (
      credential.organizationId !== employee.organizationId ||
      credential.credentialHash !== employee.payslipPinHash
    ) {
      destination.mismatched += 1;
      sourceConflicts += 1;
      await recordAuditIssue(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: employee.organizationId,
        entityType: "employee",
        entityId: employee._id,
        field: "credentialHash",
        code: "PAYSLIP_CREDENTIAL_MISMATCH",
        now,
      });
    } else {
      destination.matching += 1;
    }
  }

  return { ...page, destination, sourceConflicts };
}

async function auditCredentialTargets(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
) {
  const page = await ctx.db.query("payslipCredentials").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();

  for (const credential of page.page) {
    destination.totalRows += 1;
    const employee = await ctx.db.get(credential.employeeId);
    if (
      !employee ||
      employee.organizationId !== credential.organizationId ||
      !employee.payslipPinHash?.trim()
    ) {
      destination.unexpected += 1;
      sourceConflicts += 1;
      await recordAuditIssue(ctx, {
        runId: run._id,
        auditId: audit._id,
        organizationId: credential.organizationId,
        entityType: "credential",
        entityId: credential._id,
        field: "employeeId",
        code: "UNEXPECTED_PAYSLIP_CREDENTIAL",
        now,
      });
    }
  }

  return { ...page, destination, sourceConflicts };
}

async function auditInvitations(
  ctx: MutationCtx,
  audit: Doc<"migrationAudits">,
  run: Doc<"migrationRuns">,
) {
  const page = await ctx.db.query("invitations").paginate({
    cursor: audit.cursor ?? null,
    numItems: audit.batchSize,
  });
  const destination = { ...audit.destination };
  let sourceConflicts = audit.sourceConflicts;
  const now = Date.now();

  for (const invitation of page.page) {
    destination.totalRows += 1;
    const initialPlan = planInvitationTokenHash({
      token: invitation.token,
      tokenHash: invitation.tokenHash,
      hashedTokenMatchCount: 0,
    });
    const expectedHash =
      initialPlan.outcome === "create"
        ? initialPlan.value.tokenHash
        : invitation.tokenHash;
    const [hashRows, tokenRows] = await Promise.all([
      expectedHash
        ? ctx.db
            .query("invitations")
            .withIndex("by_token_hash", (query) =>
              query.eq("tokenHash", expectedHash),
            )
            .take(2)
        : [],
      ctx.db
        .query("invitations")
        .withIndex("by_token", (query) => query.eq("token", invitation.token))
        .take(2),
    ]);
    const claimants = new Set(hashRows.map((row) => row._id));
    for (const row of tokenRows) {
      if (row._id !== invitation._id) claimants.add(row._id);
    }
    const plan = planInvitationTokenHash({
      token: invitation.token,
      tokenHash: invitation.tokenHash,
      hashedTokenMatchCount: claimants.size,
    });

    if (!invitation.token.trim()) {
      if (invitation.tokenHash) destination.unexpected += 1;
    } else {
      destination.expected += 1;
    }
    switch (plan.outcome) {
      case "create":
        destination.missing += 1;
        break;
      case "unchanged":
        destination.matching += 1;
        break;
      case "skipped":
        break;
      case "conflict":
        sourceConflicts += plan.issues.length;
        for (const issue of plan.issues) {
          if (issue.code === "DUPLICATE_INVITATION_TOKEN_HASH") {
            destination.duplicate += 1;
          } else if (issue.code === "INVITATION_TOKEN_HASH_MISMATCH") {
            destination.mismatched += 1;
          }
        }
        await recordIssues(ctx, {
          runId: run._id,
          auditId: audit._id,
          organizationId: invitation.organizationId,
          entityType: "invitation",
          entityId: invitation._id,
          issues: plan.issues,
          now,
        });
        break;
    }
  }

  return { ...page, destination, sourceConflicts };
}

async function runIdentityAuditBatch(
  ctx: MutationCtx,
  auditId: Id<"migrationAudits">,
) {
  const audit = await ctx.db.get(auditId);
  if (!audit || !isIdentityAuditPhase(audit.phase)) {
    throw new Error("Identity credentials audit was not found");
  }
  if (audit.status === "queued") {
    await ctx.db.patch(audit._id, {
      status: "running",
      updatedAt: Date.now(),
    });
  } else if (audit.status !== "running") {
    throw new Error("Identity credentials audit is not active");
  }
  const run = await ctx.db.get(audit.migrationRunId);
  assertIdentityRun(run);
  if (
    run.dryRun ||
    run.status !== "completed" ||
    run.counters.errors > 0 ||
    run.counters.conflicts > 0
  ) {
    throw new Error("Conflict-free completed write run is required");
  }

  const page =
    audit.phase === "identity_users"
      ? await auditUsers(ctx, audit, run)
      : audit.phase === "identity_memberships"
        ? await auditMemberships(ctx, audit, run)
        : audit.phase === "identity_credentials"
          ? await auditCredentialSources(ctx, audit, run)
          : audit.phase === "identity_credential_targets"
            ? await auditCredentialTargets(ctx, audit, run)
            : await auditInvitations(ctx, audit, run);
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

  const nextPhase = nextIdentityAuditPhase(audit.phase);
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
    destination: page.destination,
    sourceConflicts: page.sourceConflicts,
    updatedAt: now,
    completedAt: now,
  });
  return { done: true };
}

export const processIdentityCredentialsAuditBatch = internalMutation({
  args: { auditId: v.id("migrationAudits") },
  handler: (ctx, args) => runIdentityAuditBatch(ctx, args.auditId),
});

const continueIdentityAuditReference = makeFunctionReference<
  "action",
  { auditId: Id<"migrationAudits"> }
>("identityMigrations:continueIdentityCredentialsAudit");
const processIdentityAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits"> },
  { done: boolean }
>("identityMigrations:processIdentityCredentialsAuditBatch");
const failIdentityAuditReference = makeFunctionReference<
  "mutation",
  { auditId: Id<"migrationAudits">; failureCode: string }
>("identityMigrations:failIdentityCredentialsAudit");

export const startIdentityCredentialsAudit = internalMutation({
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
      run.key !== IDENTITY_CREDENTIALS_MIGRATION_KEY ||
      run.version !== IDENTITY_CREDENTIALS_MIGRATION_VERSION ||
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const existing = await getLatestIdentityAudit(ctx, run._id);
    if (existing?.status === "queued" || existing?.status === "running") {
      throw new Error("Identity credentials audit is already active");
    }

    const now = Date.now();
    const auditId = await ctx.db.insert("migrationAudits", {
      migrationRunId: run._id,
      status: "queued",
      phase: "identity_users",
      batchSize,
      organizations: 0,
      destination: EMPTY_DESTINATION_AUDIT,
      duplicateLegacySettings: 0,
      sourceConflicts: 0,
      auditTruncated: false,
      startedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueIdentityAuditReference, {
      auditId,
    });
    return { auditId, runId: run._id };
  },
});

export const continueIdentityCredentialsAudit = internalAction({
  args: { auditId: v.id("migrationAudits") },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runMutation(processIdentityAuditReference, args);
      if (!result.done) {
        await ctx.scheduler.runAfter(0, continueIdentityAuditReference, args);
      }
      return { done: result.done };
    } catch {
      await ctx.runMutation(failIdentityAuditReference, {
        auditId: args.auditId,
        failureCode: "AUDIT_BATCH_FAILED",
      });
      return { done: true, failed: true };
    }
  },
});

export const failIdentityCredentialsAudit = internalMutation({
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

export const resumeIdentityCredentialsAudit = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertIdentityRun(run);
    if (
      run.dryRun ||
      run.status !== "completed" ||
      run.counters.errors > 0 ||
      run.counters.conflicts > 0
    ) {
      throw new Error("Conflict-free completed write run is required");
    }
    const audit = await getLatestIdentityAudit(ctx, run._id);
    if (!audit) throw new Error("Identity credentials audit was not found");
    if (audit.status === "completed") {
      throw new Error("Completed identity credentials audit cannot resume");
    }
    const now = Date.now();
    if (
      audit.status !== "failed" &&
      audit.updatedAt > now - STALE_RUN_MILLISECONDS
    ) {
      throw new Error("Identity credentials audit is not stale");
    }
    await ctx.db.patch(audit._id, {
      status: "queued",
      failureCode: undefined,
      completedAt: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, continueIdentityAuditReference, {
      auditId: audit._id,
    });
    return { resumed: true, auditId: audit._id };
  },
});

export const getIdentityCredentialsAudit = internalQuery({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertIdentityRun(run);
    const audit = await getLatestIdentityAudit(ctx, run._id);
    if (!audit) return { status: "not_started" as const, ready: false };
    return { ...audit, ready: hasCleanIdentityAudit(run, audit) };
  },
});

export const getIdentityCredentialsCompatibilityStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const recentRuns = await ctx.db
      .query("migrationRuns")
      .withIndex("by_key_started", (query) =>
        query.eq("key", IDENTITY_CREDENTIALS_MIGRATION_KEY),
      )
      .order("desc")
      .take(100);
    const run = recentRuns.find(
      (candidate) =>
        candidate.version === IDENTITY_CREDENTIALS_MIGRATION_VERSION &&
        !candidate.dryRun,
    );
    const base = {
      normalizedReadsEnabled: true,
      dualWritesEnabled: true,
      legacyFallbacksEnabled: true,
    };
    if (!run) {
      return {
        ...base,
        equalityEvidenceReady: false,
        blockers: ["COMPLETED_WRITE_RUN_NOT_FOUND"],
      };
    }
    if (run.status !== "completed") {
      return {
        ...base,
        equalityEvidenceReady: false,
        blockers: ["MIGRATION_WRITE_NOT_COMPLETED"],
        runId: run._id,
      };
    }
    if (run.counters.errors > 0 || run.counters.conflicts > 0) {
      return {
        ...base,
        equalityEvidenceReady: false,
        blockers: ["MIGRATION_WRITE_NOT_CLEAN"],
        runId: run._id,
      };
    }
    const audit = await getLatestIdentityAudit(ctx, run._id);
    if (!audit || !hasCleanIdentityAudit(run, audit)) {
      return {
        ...base,
        equalityEvidenceReady: false,
        blockers: ["CLEAN_AUDIT_NOT_FOUND"],
        runId: run._id,
        ...(audit ? { auditId: audit._id } : {}),
      };
    }
    return {
      ...base,
      equalityEvidenceReady: true,
      blockers: [],
      runId: run._id,
      auditId: audit._id,
    };
  },
});

export const listIdentityCredentialsAuditIssues = internalQuery({
  args: {
    auditId: v.id("migrationAudits"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit || !isIdentityAuditPhase(audit.phase)) {
      throw new Error("Identity credentials audit was not found");
    }
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
