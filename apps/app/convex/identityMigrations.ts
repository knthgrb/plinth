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
        ? { id: employee._id, organizationId: employee.organizationId }
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
