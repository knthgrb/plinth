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
});
