import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import { hashInvitationToken } from "../convex/invitationTokenHash";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

type RunCounters = {
  scanned: number;
  changed: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  errors: number;
};

const startMigration = makeFunctionReference<
  "mutation",
  {
    dryRun: boolean;
    dryRunId?: Id<"migrationRuns">;
    batchSize?: number;
  },
  {
    runId: Id<"migrationRuns">;
    key: string;
    version: number;
    dryRun: boolean;
  }
>("identityMigrations:startIdentityCredentialsMigration");

const processBatch = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { done: boolean; cursor: string | null; counters: RunCounters }
>("identityMigrations:processIdentityCredentialsBatch");

const continueMigration = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> },
  { done: boolean; failed?: boolean }
>("identityMigrations:continueIdentityCredentialsMigration");

const getRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: {
      status: "queued" | "running" | "completed" | "failed";
      phase: "identity_users" | "identity_credentials" | "identity_invitations";
      cursor?: string;
      counters: RunCounters;
    };
    issues: Array<{
      code: string;
      field: string;
      entityType: string;
      entityId?: string;
      organizationId?: Id<"organizations">;
    }>;
    issuesTruncated: boolean;
    canStartWrite: boolean;
  }
>("identityMigrations:getIdentityCredentialsMigrationRun");

const listIssues = makeFunctionReference<
  "query",
  {
    runId: Id<"migrationRuns">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{ code: string; field: string; entityId?: string }>;
    isDone: boolean;
    continueCursor: string;
  }
>("identityMigrations:listIdentityCredentialsMigrationIssues");

const resumeMigration = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { resumed: boolean; runId: Id<"migrationRuns"> }
>("identityMigrations:resumeIdentityCredentialsMigration");

const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits">; runId: Id<"migrationRuns"> }
>("identityMigrations:startIdentityCredentialsAudit");

const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    _id?: Id<"migrationAudits">;
    status: "not_started" | "queued" | "running" | "completed" | "failed";
    ready: boolean;
    sourceConflicts?: number;
    destination?: {
      expected: number;
      matching: number;
      missing: number;
      duplicate: number;
      mismatched: number;
      unexpected: number;
      totalRows: number;
    };
  }
>("identityMigrations:getIdentityCredentialsAudit");

const getCompatibilityStatus = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    normalizedReadsEnabled: boolean;
    dualWritesEnabled: boolean;
    legacyFallbacksEnabled: boolean;
    equalityEvidenceReady: boolean;
    blockers: string[];
    runId?: Id<"migrationRuns">;
    auditId?: Id<"migrationAudits">;
  }
>("identityMigrations:getIdentityCredentialsCompatibilityStatus");

const resumeAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { resumed: boolean; auditId: Id<"migrationAudits"> }
>("identityMigrations:resumeIdentityCredentialsAudit");

const listAuditIssues = makeFunctionReference<
  "query",
  {
    auditId: Id<"migrationAudits">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      code: string;
      field: string;
      entityType: string;
      entityId?: string;
    }>;
    isDone: boolean;
    continueCursor: string;
  }
>("identityMigrations:listIdentityCredentialsAuditIssues");

const insertEmployee = async (
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  payslipPinHash?: string,
) => {
  const workday = { in: "09:00", out: "18:00", isWorkday: true };
  return ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Identity",
      lastName: "Employee",
      email: "identity@example.com",
    },
    employment: {
      employeeId: "IDENTITY-001",
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule: {
      defaultSchedule: {
        monday: workday,
        tuesday: workday,
        wednesday: workday,
        thursday: workday,
        friday: workday,
        saturday: { ...workday, isWorkday: false },
        sunday: { ...workday, isWorkday: false },
      },
    },
    ...(payslipPinHash ? { payslipPinHash } : {}),
    createdAt: 1,
    updatedAt: 1,
  });
};

const insertMigrationSources = async (ctx: MutationCtx) => {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Identity Migration Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await insertEmployee(
    ctx,
    organizationId,
    "legacy-credential-hash",
  );
  const userId = await ctx.db.insert("users", {
    email: "identity@example.com",
    organizationId,
    role: "employee",
    employeeId,
    createdAt: 1,
    updatedAt: 1,
  });
  const invitationId = await ctx.db.insert("invitations", {
    organizationId,
    email: "invitee@example.com",
    role: "employee",
    invitedBy: userId,
    token: "legacy-invitation-token",
    status: "pending",
    expiresAt: Date.now() + 60_000,
    createdAt: 1,
  });
  return { organizationId, employeeId, userId, invitationId };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("identity credentials migration", () => {
  it("reports compatibility behavior separately from equality evidence", async () => {
    const t = convexTest(schema, modules);
    const initial = await t.query(getCompatibilityStatus, {});
    expect(initial).toEqual({
      normalizedReadsEnabled: true,
      dualWritesEnabled: true,
      legacyFallbacksEnabled: true,
      equalityEvidenceReady: false,
      blockers: ["COMPLETED_WRITE_RUN_NOT_FOUND"],
    });

    const fixture = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      const auditId = await ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 5,
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
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
      return { runId, auditId };
    });

    await expect(t.query(getCompatibilityStatus, {})).resolves.toEqual({
      normalizedReadsEnabled: true,
      dualWritesEnabled: true,
      legacyFallbacksEnabled: true,
      equalityEvidenceReady: true,
      blockers: [],
      ...fixture,
    });
  });

  it("dry-runs every phase without changing business rows", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fixture = await t.run(insertMigrationSources);

    const started = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getRun, { runId: started.runId })).resolves.toMatchObject({
      run: {
        status: "completed",
        counters: {
          scanned: 3,
          changed: 3,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
      },
      issues: [],
      canStartWrite: true,
    });
    const state = await t.run(async (ctx) => ({
      memberships: await ctx.db.query("userOrganizations").collect(),
      credentials: await ctx.db.query("payslipCredentials").collect(),
      invitation: await ctx.db.get(fixture.invitationId),
    }));
    expect(state.memberships).toEqual([]);
    expect(state.credentials).toEqual([]);
    expect(state.invitation?.tokenHash).toBeUndefined();
  });

  it("guards batch size, dry-run authorization, and active runs", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(startMigration, { dryRun: true, batchSize: 0 }),
    ).rejects.toThrow("Batch size must be between 1 and 50");
    await expect(
      t.mutation(startMigration, { dryRun: true, batchSize: 51 }),
    ).rejects.toThrow("Batch size must be between 1 and 50");
    await expect(
      t.mutation(startMigration, { dryRun: false }),
    ).rejects.toThrow("Completed dry-run is required");

    await t.mutation(startMigration, { dryRun: true });
    await expect(
      t.mutation(startMigration, { dryRun: true }),
    ).rejects.toThrow("An identity credentials migration is already active");
  });

  it("advances phases with a saved cursor and resets it at the boundary", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("users", {
          email: `user-${index}@example.com`,
          createdAt: index + 1,
          updatedAt: index + 1,
        });
      }
    });
    const runId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "identity_users",
        batchSize: 1,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(t.mutation(processBatch, { runId })).resolves.toMatchObject({
      done: false,
      cursor: expect.any(String),
    });
    await expect(t.mutation(processBatch, { runId })).resolves.toMatchObject({
      done: false,
      cursor: null,
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
      phase: "identity_credentials",
      counters: { scanned: 2, skipped: 2 },
    });
    expect(run?.cursor).toBeUndefined();
  });

  it("writes once and a following dry-run reports only unchanged targets", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fixture = await t.run(insertMigrationSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const state = await t.run(async (ctx) => ({
      memberships: await ctx.db.query("userOrganizations").collect(),
      credentials: await ctx.db.query("payslipCredentials").collect(),
      invitation: await ctx.db.get(fixture.invitationId),
    }));
    expect(state.memberships).toHaveLength(1);
    expect(state.credentials).toEqual([
      expect.objectContaining({
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
        credentialHash: "legacy-credential-hash",
      }),
    ]);
    expect(state.invitation?.tokenHash).toBe(
      hashInvitationToken("legacy-invitation-token"),
    );
    await expect(t.query(getRun, { runId: write.runId })).resolves.toMatchObject({
      run: { status: "completed", counters: { changed: 3, conflicts: 0 } },
    });

    const verification = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: verification.runId }),
    ).resolves.toMatchObject({
      run: { counters: { changed: 0, unchanged: 3, conflicts: 0 } },
      canStartWrite: true,
    });
  });

  it("backfills resigned employees as alumni without granting active access", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { organizationId, userId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Former Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await insertEmployee(ctx, organizationId);
      const employee = await ctx.db.get(employeeId);
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee!.employment,
          status: "resigned",
          separationDate: 2,
        },
      });
      const userId = await ctx.db.insert("users", {
        email: "former-employee@example.com",
        organizationId,
        role: "employee",
        employeeId,
        isActive: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, userId };
    });
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.run((ctx) =>
        ctx.db
          .query("userOrganizations")
          .withIndex("by_user_organization", (query) =>
            query.eq("userId", userId).eq("organizationId", organizationId),
          )
          .unique(),
      ),
    ).resolves.toMatchObject({ accessStatus: "alumni" });
    await expect(t.query(getRun, { runId: write.runId })).resolves.toMatchObject({
      run: { status: "completed", counters: { conflicts: 0 } },
    });
  });

  it("redacts and paginates conflicts while blocking write mode", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { organizationId, userId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Conflict Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "secret-email@example.com",
        organizationId,
        role: "hr",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, userId };
    });

    const started = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: started.runId });
    expect(status).toMatchObject({
      run: { counters: { conflicts: 1 } },
      canStartWrite: false,
      issues: [
        {
          code: "MEMBERSHIP_ROLE_MISMATCH",
          field: "role",
          entityType: "user",
          entityId: userId,
          organizationId,
        },
      ],
    });
    expect(JSON.stringify(status)).not.toContain("secret-email@example.com");
    const page = await t.query(listIssues, {
      runId: started.runId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page.page).toEqual([
      expect.objectContaining({ code: "MEMBERSHIP_ROLE_MISMATCH" }),
    ]);
    await expect(
      t.mutation(startMigration, {
        dryRun: false,
        dryRunId: started.runId,
      }),
    ).rejects.toThrow("Conflict-free completed dry-run is required");
  });

  it("does not create memberships for archived legacy organizations", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Archived Org",
        status: "archived",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", {
        email: "archived-member@example.com",
        organizationId,
        role: "employee",
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    const started = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getRun, { runId: started.runId })).resolves.toMatchObject({
      canStartWrite: false,
      issues: [
        {
          code: "ORGANIZATION_NOT_FOUND",
          field: "organizationId",
          organizationId,
        },
      ],
    });
  });

  it("detects duplicate legacy invitation tokens before write mode", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Duplicate Token Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const invitedBy = await ctx.db.insert("users", {
        email: "inviter@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      for (const email of ["first@example.com", "second@example.com"]) {
        await ctx.db.insert("invitations", {
          organizationId,
          email,
          role: "employee",
          invitedBy,
          token: "duplicated-legacy-token",
          status: "pending",
          expiresAt: Date.now() + 60_000,
          createdAt: 1,
        });
      }
    });

    const started = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getRun, { runId: started.runId })).resolves.toMatchObject({
      canStartWrite: false,
      run: { counters: { conflicts: 2 } },
      issues: [
        { code: "DUPLICATE_INVITATION_TOKEN_HASH", field: "tokenHash" },
        { code: "DUPLICATE_INVITATION_TOKEN_HASH", field: "tokenHash" },
      ],
    });
  });

  it("marks a run failed when a scheduled batch throws", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: true,
        status: "queued",
        phase: "identity_users",
        cursor: "invalid-pagination-cursor",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(t.action(continueMigration, { runId })).resolves.toEqual({
      done: true,
      failed: true,
    });
    await expect(t.run((ctx) => ctx.db.get(runId))).resolves.toMatchObject({
      status: "failed",
      failureCode: "BATCH_FAILED",
      counters: { errors: 1 },
    });
  });

  it("resumes only stale active runs with the correct migration identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:10:00.000Z"));
    const t = convexTest(schema, modules);
    const insertRun = (
      status: "queued" | "running" | "completed",
      updatedAt: number,
      key = "full-schema-identity-credentials",
      version = 1,
    ) =>
      t.run((ctx) =>
        ctx.db.insert("migrationRuns", {
          key,
          version,
          dryRun: true,
          status,
          phase: "identity_users",
          batchSize: 20,
          counters: {
            scanned: 0,
            changed: 0,
            unchanged: 0,
            skipped: 0,
            conflicts: 0,
            errors: 0,
          },
          startedAt: updatedAt,
          updatedAt,
          ...(status === "completed" ? { completedAt: updatedAt } : {}),
        }),
      );
    const staleRunId = await insertRun(
      "running",
      Date.now() - 10 * 60 * 1_000,
    );
    const freshRunId = await insertRun("running", Date.now());
    const terminalRunId = await insertRun("completed", 1);
    const wrongVersionRunId = await insertRun("running", 1, undefined, 2);

    await expect(t.mutation(resumeMigration, { runId: staleRunId })).resolves.toEqual({
      resumed: true,
      runId: staleRunId,
    });
    await expect(
      t.mutation(resumeMigration, { runId: freshRunId }),
    ).rejects.toThrow("Identity credentials migration is not stale");
    await expect(
      t.mutation(resumeMigration, { runId: terminalRunId }),
    ).rejects.toThrow("Only an active identity credentials migration can resume");
    await expect(
      t.query(getRun, { runId: wrongVersionRunId }),
    ).rejects.toThrow("Identity credentials migration run was not found");
  });

  it("audits a completed write with bounded persisted phases", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertMigrationSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.mutation(startAudit, { runId: write.runId, batchSize: 0 }),
    ).rejects.toThrow("Audit batch size must be between 1 and 10");
    const started = await t.mutation(startAudit, {
      runId: write.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getAudit, { runId: write.runId })).resolves.toMatchObject({
      _id: started.auditId,
      status: "completed",
      ready: true,
      sourceConflicts: 0,
      destination: {
        expected: 3,
        matching: 3,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 3,
      },
    });
  });

  it("rejects audit without a conflict-free completed write", async () => {
    const t = convexTest(schema, modules);
    const dryRun = await t.mutation(startMigration, { dryRun: true });

    await expect(
      t.mutation(startAudit, { runId: dryRun.runId }),
    ).rejects.toThrow("Conflict-free completed write run is required");
  });

  it("reports missing and unexpected identity destinations without secrets", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const fixture = await t.run(insertMigrationSources);
    const writeRunId = await t.run(async (ctx) => {
      const sourceLessEmployeeId = await insertEmployee(ctx, fixture.organizationId);
      await ctx.db.insert("payslipCredentials", {
        organizationId: fixture.organizationId,
        employeeId: sourceLessEmployeeId,
        credentialHash: "must-not-appear-in-audit",
        credentialVersion: 1,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 3,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
    });

    await t.mutation(startAudit, { runId: writeRunId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const audit = await t.query(getAudit, { runId: writeRunId });
    expect(audit).toMatchObject({
      status: "completed",
      ready: false,
      destination: { missing: 3, unexpected: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain("must-not-appear-in-audit");
    expect(JSON.stringify(audit)).not.toContain("legacy-credential-hash");
    expect(JSON.stringify(audit)).not.toContain("legacy-invitation-token");
  });

  it("audits duplicate memberships and isolates issues by audit", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Duplicate Membership Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await insertEmployee(ctx, organizationId);
      const userId = await ctx.db.insert("users", {
        email: "duplicate-secret@example.com",
        organizationId,
        role: "employee",
        employeeId,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("userOrganizations", {
          userId,
          organizationId,
          employeeId,
          role: "employee",
          accessStatus: "active",
          joinedAt: index + 1,
          updatedAt: index + 1,
        });
      }
      return ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
    });

    const first = await t.mutation(startAudit, { runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const firstIssues = await t.query(listAuditIssues, {
      auditId: first.auditId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(firstIssues.page).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_USER_MEMBERSHIP" }),
        expect.objectContaining({
          code: "DUPLICATE_ORGANIZATION_EMPLOYEE_MEMBERSHIP",
        }),
      ]),
    );
    expect(JSON.stringify(firstIssues)).not.toContain("duplicate-secret@example.com");

    const second = await t.mutation(startAudit, { runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const secondIssues = await t.query(listAuditIssues, {
      auditId: second.auditId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(secondIssues.page).toHaveLength(firstIssues.page.length);
    expect(second.auditId).not.toBe(first.auditId);
  });

  it("resumes a failed identity audit but not a completed audit", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "full-schema-identity-credentials",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "identity_invitations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      }),
    );
    const failedAuditId = await t.run((ctx) =>
      ctx.db.insert("migrationAudits", {
        migrationRunId: runId,
        status: "failed",
        phase: "identity_users",
        batchSize: 5,
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
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
        failureCode: "AUDIT_BATCH_FAILED",
      }),
    );

    await expect(t.mutation(resumeAudit, { runId })).resolves.toEqual({
      resumed: true,
      auditId: failedAuditId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.mutation(resumeAudit, { runId })).rejects.toThrow(
      "Completed identity credentials audit cannot resume",
    );
  });
});
