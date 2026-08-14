import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type {
  LeaveMigrationBatchResult,
  LeaveMigrationComparison,
} from "../convex/leaveMigration";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const runOrganizationLeaveMigrationBatch = makeFunctionReference<
  "mutation",
  { organizationId: Id<"organizations">; batchSize: number },
  LeaveMigrationBatchResult
>("leaveMigration:runOrganizationLeaveMigrationBatch");
const compareOrganizationLeaveMigration = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  LeaveMigrationComparison
>("leaveMigration:compareOrganizationLeaveMigration");
const activateOrganizationLeaveEngine = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employmentSector: "private" | "government";
  },
  { activated: true }
>("leaveMigration:activateOrganizationLeaveEngine");

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const schedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: { ...workday, isWorkday: false },
  sunday: { ...workday, isWorkday: false },
};

describe("leave v2 migration", () => {
  it("persists one general-pool balance, immutable snapshots, and idempotent opening entries", async () => {
    const t = convexTest(schema, modules);
    const email = "leave-migration-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Leave migration org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: { firstName: "Leave", lastName: "Employee", email },
        employment: {
          employeeId: "LEAVE-MIGRATION-001",
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule: schedule },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationLeaveSettings", {
        organizationId,
        leaveTrackerMode: "general",
        proratedLeave: true,
        leaveAccrualFrequency: "monthly",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      for (const [leaveTypeKey, total, used, balance] of [
        ["vacation", 8, 3, 5],
        ["sick", 4, 1, 3],
      ] as const) {
        await ctx.db.insert("employeeLeaveBalances", {
          organizationId,
          employeeId,
          year: 2026,
          leaveTypeKey,
          total,
          used,
          balance,
          source: "employee_credits",
          approvedDays: used,
          reconciliationStatus: "matching",
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("leaveRequests", {
        organizationId,
        employeeId,
        leaveType: "vacation",
        startDate: 1,
        endDate: 1,
        numberOfDays: 1,
        reason: "Legacy request",
        status: "approved",
        filedDate: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, employeeId };
    });
    const owner = t.withIdentity({ email });

    let createdRows = 0;
    let nextCursor: string | undefined;
    do {
      const batch = await owner.mutation(
        runOrganizationLeaveMigrationBatch,
        { organizationId: fixture.organizationId, batchSize: 10 },
      );
      createdRows += batch.createdRows;
      nextCursor = batch.nextCursor;
    } while (nextCursor !== undefined);
    const replay = await owner.mutation(
      runOrganizationLeaveMigrationBatch,
      { organizationId: fixture.organizationId, batchSize: 10 },
    );
    const comparison = await owner.query(
      compareOrganizationLeaveMigration,
      { organizationId: fixture.organizationId },
    );
    const persisted = await t.run(async (ctx) => ({
      policies: await ctx.db
        .query("leavePolicies")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", fixture.organizationId),
        )
        .collect(),
      balances: await ctx.db
        .query("employeeLeaveBalances")
        .withIndex("by_organization_year", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("year", 2026),
        )
        .collect(),
      entries: await ctx.db
        .query("leaveLedgerEntries")
        .withIndex("by_organization_idempotency_key", (q) =>
          q.eq("organizationId", fixture.organizationId),
        )
        .collect(),
      snapshot: await ctx.db
        .query("leaveMigrationRuns")
        .withIndex("by_organization_key", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("key", "leave-engine-v2"),
        )
        .unique(),
    }));

    expect(createdRows).toBeGreaterThan(0);
    expect(replay.createdRows).toBe(0);
    expect(persisted.snapshot?.employmentSector).toBeUndefined();
    expect(persisted.policies).toHaveLength(1);
    expect(persisted.balances.filter((row) => row.poolKey === "__plinth_general_leave__")).toMatchObject([
      expect.objectContaining({ total: 12, used: 4, balance: 8 }),
    ]);
    expect(persisted.entries.filter((row) => row.referenceType === "migration")).toHaveLength(2);
    expect(comparison).toMatchObject({
      policyMismatches: [],
      versionMismatches: [],
      balanceMismatches: [],
      requestMismatches: [],
      ledgerMismatches: [],
      settingsMismatches: [],
      cutoverMismatches: [],
    });

    const canonicalBalance = persisted.balances.find(
      (row) => row.poolKey === "__plinth_general_leave__",
    );
    expect(canonicalBalance).toBeDefined();
    if (!canonicalBalance) throw new Error("Canonical balance was not created");
    await t.run((ctx) =>
      ctx.db.patch(canonicalBalance._id, { balance: canonicalBalance.balance + 1 }),
    );
    await expect(
      owner.mutation(activateOrganizationLeaveEngine, {
        organizationId: fixture.organizationId,
        employmentSector: "private",
      }),
    ).rejects.toThrow("unresolved mismatches");
    await t.run((ctx) =>
      ctx.db.patch(canonicalBalance._id, { balance: canonicalBalance.balance }),
    );

    await expect(
      owner.mutation(activateOrganizationLeaveEngine, {
        organizationId: fixture.organizationId,
        employmentSector: "private",
      }),
    ).resolves.toEqual({ activated: true });
    const activation = await t.run(async (ctx) => ({
      settings: await ctx.db
        .query("organizationLeaveSettings")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", fixture.organizationId),
        )
        .unique(),
      run: await ctx.db
        .query("leaveMigrationRuns")
        .withIndex("by_organization_key", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("key", "leave-engine-v2"),
        )
        .unique(),
    }));
    expect(activation.settings).toMatchObject({
      employmentSector: "private",
      migrationState: "active",
      activePolicyEngineVersion: 2,
      policyEngineCutoverAt: persisted.snapshot?.cutoverCandidateAt,
    });
    expect(activation.run).toMatchObject({
      employmentSector: "private",
      status: "active",
    });
  });

  it("preserves by-type rules and blocks activation on reconciliation or source drift", async () => {
    const t = convexTest(schema, modules);
    const email = "leave-migration-drift-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "By-type migration org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: { firstName: "By", lastName: "Type", email },
        employment: {
          employeeId: "LEAVE-MIGRATION-002",
          position: "Analyst",
          department: "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule: schedule },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationLeaveSettings", {
        organizationId,
        leaveTrackerMode: "by_type",
        proratedLeave: false,
        leaveAccrualFrequency: "monthly",
        maxConvertibleLeaveDays: 5,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("leaveTypes", {
        organizationId,
        sourceKey: "vacation",
        name: "Vacation Leave",
        defaultCredits: 12,
        requiresApproval: true,
        isPaid: true,
        accrualRate: 1,
        maxConsecutiveDays: 5,
        carryOver: true,
        maxCarryOver: 5,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const balanceId = await ctx.db.insert("employeeLeaveBalances", {
        organizationId,
        employeeId,
        year: 2026,
        leaveTypeKey: "vacation",
        total: 12,
        used: 3,
        balance: 8,
        source: "employee_credits",
        approvedDays: 3,
        reconciliationStatus: "mismatched",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, balanceId };
    });
    const owner = t.withIdentity({ email });
    const first = await owner.mutation(runOrganizationLeaveMigrationBatch, {
      organizationId: fixture.organizationId,
      batchSize: 10,
    });
    expect(first.nextCursor).toBeDefined();
    await t.run((ctx) => ctx.db.patch(fixture.balanceId, { updatedAt: 2 }));
    let nextCursor = first.nextCursor;
    while (nextCursor !== undefined) {
      const batch = await owner.mutation(runOrganizationLeaveMigrationBatch, {
        organizationId: fixture.organizationId,
        batchSize: 10,
      });
      nextCursor = batch.nextCursor;
    }
    const persisted = await t.run(async (ctx) => {
      const policy = await ctx.db
        .query("leavePolicies")
        .withIndex("by_organization_source_key", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("sourceKey", "vacation"),
        )
        .unique();
      const version = policy
        ? await ctx.db
            .query("leavePolicyVersions")
            .withIndex("by_policy_version", (q) =>
              q.eq("leavePolicyId", policy._id).eq("version", 1),
            )
            .unique()
        : null;
      const run = await ctx.db
        .query("leaveMigrationRuns")
        .withIndex("by_organization_key", (q) =>
          q.eq("organizationId", fixture.organizationId).eq("key", "leave-engine-v2"),
        )
        .unique();
      return { version, run };
    });
    expect(persisted.version).toMatchObject({
      accountBehavior: "individual_account",
      payTreatment: "company_paid",
      entitlementMethod: "monthly",
      annualUnits: 12,
      accrualRate: 1,
      carryoverMode: "capped",
      carryoverCap: 5,
      conversionAllowed: true,
      maxConvertibleUnits: 5,
      maximumConsecutiveUnits: 5,
    });
    expect(persisted.run).toMatchObject({
      status: "reconciliation_required",
      reconciliationRequired: true,
      sourceDriftMismatches: 1,
    });
    await expect(
      owner.mutation(activateOrganizationLeaveEngine, {
        organizationId: fixture.organizationId,
        employmentSector: "private",
      }),
    ).rejects.toThrow("not ready");
  });
});
