import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
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
>("leaveEmployeeMigrations:startLeaveEmployeeMigration");

const getRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: {
      status: "queued" | "running" | "completed" | "failed";
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
>("leaveEmployeeMigrations:getLeaveEmployeeMigrationRun");

const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits">; runId: Id<"migrationRuns"> }
>("leaveEmployeeMigrations:startLeaveEmployeeAudit");

const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
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
>("leaveEmployeeMigrations:getLeaveEmployeeAudit");

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
>("leaveEmployeeMigrations:listLeaveEmployeeAuditIssues");

const workday = { in: "09:00", out: "18:00", isWorkday: true };

const insertMinimalEmployee = async (
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  employeeNumber: string,
  customFields?: Record<string, unknown>,
) =>
  ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Additional",
      lastName: "Employee",
      email: `${employeeNumber.toLowerCase()}@example.com`,
    },
    employment: {
      employeeId: employeeNumber,
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 1, salaryType: "monthly" },
    schedule: {
      defaultSchedule: {
        monday: workday,
        tuesday: workday,
        wednesday: workday,
        thursday: workday,
        friday: workday,
        saturday: workday,
        sunday: workday,
      },
    },
    ...(customFields ? { customFields } : {}),
    createdAt: 1,
    updatedAt: 1,
  });

const insertSources = async (ctx: MutationCtx) => {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Release 1C Migration Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const userId = await ctx.db.insert("users", {
    email: "hr@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Migration",
      lastName: "Employee",
      email: "employee@example.com",
    },
    employment: {
      employeeId: "MIGRATION-001",
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      hireDate: Date.UTC(2025, 0, 1),
      status: "active",
    },
    compensation: {
      basicSalary: 30_000,
      salaryType: "monthly",
      bankDetails: {
        bankName: "Example Bank",
        accountNumber: "legacy-account-value",
        accountName: "Migration Employee",
      },
    },
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
      scheduleOverrides: [
        {
          date: Date.UTC(2026, 7, 15),
          in: "10:00",
          out: "19:00",
          reason: "Client coverage",
        },
      ],
    },
    leaveCredits: {
      vacation: { total: 8, used: 2, balance: 6 },
      sick: { total: 5, used: 0, balance: 5 },
    },
    requirements: [{ type: "BIR 2316", status: "submitted" }],
    deductions: [
      {
        id: "loan-1",
        type: "loan",
        name: "Company loan",
        amount: 1_000,
        frequency: "monthly",
        startDate: Date.UTC(2026, 0, 1),
        isActive: true,
      },
    ],
    incentives: [
      {
        id: "bonus-1",
        name: "Performance bonus",
        amount: 2_000,
        frequency: "one-time",
        isActive: true,
      },
    ],
    customFields: { "shirt-size": "M" },
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("settings", {
    organizationId,
    proratedLeave: true,
    leaveAccrualFrequency: "monthly",
    leaveTrackerMode: "general",
    enableAnniversaryLeave: true,
    anniversaryLeaveMaxDays: 15,
    annualSil: 8,
    grantLeaveUponRegularization: true,
    paidLeaveRequiresRegularization: true,
    maxConvertibleLeaveDays: 5,
    leaveTypes: [
      {
        type: "vacation",
        name: "Vacation leave",
        defaultCredits: 8,
        isPaid: true,
        requiresApproval: true,
      },
    ],
    leaveTrackerByYear: [
      {
        year: 2026,
        rows: [{ employeeId, annualSilOverride: 8, availed: 2 }],
        overrideReason: "Opening balance",
        updatedBy: userId,
        updatedAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("leaveRequests", {
    organizationId,
    employeeId,
    leaveType: "vacation",
    startDate: Date.UTC(2026, 5, 1),
    endDate: Date.UTC(2026, 5, 2),
    numberOfDays: 2,
    reason: "Vacation",
    isPaid: true,
    status: "approved",
    filedDate: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("leaveRequests", {
    organizationId,
    employeeId,
    leaveType: "vacation",
    startDate: Date.UTC(2026, 6, 1),
    endDate: Date.UTC(2026, 6, 1),
    numberOfDays: 1,
    reason: "Unpaid leave",
    isPaid: false,
    status: "approved",
    filedDate: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  return { organizationId, employeeId };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("leave and employee children migration", () => {
  it("blocks duplicate organization settings even when no employees exist", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const organizationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("organizations", {
        name: "Duplicate Settings Org",
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("settings", {
          organizationId: id,
          annualSil: 5,
          createdAt: index + 1,
          updatedAt: index + 1,
        });
      }
      return id;
    });

    const started = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getRun, { runId: started.runId }),
    ).resolves.toMatchObject({
      canStartWrite: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_SETTINGS",
          field: "organizationId",
          organizationId,
        }),
      ]),
    });
  });

  it("dry-runs every phase without changing business rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    await t.run(insertSources);

    const started = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getRun, { runId: started.runId }),
    ).resolves.toMatchObject({
      run: {
        status: "completed",
        counters: {
          scanned: 4,
          changed: 12,
          conflicts: 0,
          errors: 0,
        },
      },
      issues: [],
      canStartWrite: true,
    });
    const targets = await t.run(async (ctx) => ({
      leaveSettings: await ctx.db.query("organizationLeaveSettings").take(1),
      leaveBalances: await ctx.db.query("employeeLeaveBalances").take(1),
      requirements: await ctx.db.query("employeeRequirements").take(1),
      deductions: await ctx.db.query("employeeDeductions").take(1),
      incentives: await ctx.db.query("employeeIncentives").take(1),
      overrides: await ctx.db.query("employeeScheduleOverrides").take(1),
      accounts: await ctx.db.query("employeePaymentAccounts").take(1),
      definitions: await ctx.db
        .query("organizationCustomFieldDefinitions")
        .take(1),
      customValues: await ctx.db.query("employeeCustomFieldValues").take(1),
    }));
    expect(Object.values(targets).every((rows) => rows.length === 0)).toBe(
      true,
    );
  });

  it("requires a clean exact dry-run and becomes idempotent after write", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    await t.run(insertSources);

    await expect(t.mutation(startMigration, { dryRun: false })).rejects.toThrow(
      "Completed dry-run is required",
    );
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getRun, { runId: write.runId }),
    ).resolves.toMatchObject({
      run: { status: "completed", counters: { changed: 12, conflicts: 0 } },
    });
    const verification = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: verification.runId }),
    ).resolves.toMatchObject({
      run: { counters: { changed: 0, unchanged: 12, conflicts: 0 } },
      canStartWrite: true,
    });
  });

  it("blocks write mode on duplicate normalized rows without exposing values", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { organizationId, employeeId } = await t.run(insertSources);
    await t.run(async (ctx) => {
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("employeePaymentAccounts", {
          organizationId,
          employeeId,
          bankName: "secret-bank-value",
          accountNumber: "secret-account-value",
          accountName: "secret-account-name",
          migrationVersion: 1,
          createdAt: index + 1,
          updatedAt: index + 1,
        });
      }
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status).toMatchObject({
      canStartWrite: false,
      issues: [
        expect.objectContaining({
          code: "DUPLICATE_PAYMENT_ACCOUNT",
          field: "employeeId",
          entityType: "employee",
          entityId: employeeId,
          organizationId,
        }),
      ],
    });
    expect(JSON.stringify(status)).not.toContain("secret-account-value");
    await expect(
      t.mutation(startMigration, {
        dryRun: false,
        dryRunId: dryRun.runId,
      }),
    ).rejects.toThrow("Conflict-free completed dry-run is required");
  });

  it("persists a clean post-write audit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    await t.run(insertSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(startAudit, { runId: write.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getAudit, { runId: write.runId }),
    ).resolves.toMatchObject({
      status: "completed",
      ready: true,
      sourceConflicts: 0,
      destination: {
        expected: 12,
        matching: 12,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 12,
      },
    });
  });

  it("counts a shared organization custom-field definition once during audit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { organizationId } = await t.run(insertSources);
    await t.run((ctx) =>
      insertMinimalEmployee(ctx, organizationId, "MIGRATION-002", {
        "shirt-size": 42,
      }),
    );
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(startAudit, { runId: write.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getAudit, { runId: write.runId }),
    ).resolves.toMatchObject({
      status: "completed",
      ready: true,
      destination: {
        expected: 13,
        matching: 13,
        totalRows: 13,
      },
    });
  });

  it("blocks a pre-existing custom value when its normalized definition is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { organizationId, employeeId } = await t.run(insertSources);
    await t.run(async (ctx) => {
      const definitionId = await ctx.db.insert(
        "organizationCustomFieldDefinitions",
        {
          organizationId,
          entityType: "employee",
          sourceKey: "different-key",
          label: "Different key",
          valueType: "string",
          isActive: true,
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      );
      await ctx.db.insert("employeeCustomFieldValues", {
        organizationId,
        employeeId,
        definitionId,
        sourceKey: "shirt-size",
        valueType: "string",
        valueJson: '"secret-size"',
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CUSTOM_FIELD_VALUE_MISMATCH" }),
      ]),
    );
    expect(JSON.stringify(status)).not.toContain("secret-size");
  });

  it("blocks duplicate embedded natural keys before write mode", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { employeeId } = await t.run(insertSources);
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.patch(employeeId, {
        deductions: [employee.deductions![0], employee.deductions![0]],
        incentives: [employee.incentives![0], employee.incentives![0]],
        schedule: {
          ...employee.schedule,
          scheduleOverrides: [
            employee.schedule.scheduleOverrides![0],
            employee.schedule.scheduleOverrides![0],
          ],
        },
        customFields: { "shirt size": "M", "shirt-size": "L" },
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_DEDUCTION",
        "DUPLICATE_INCENTIVE",
        "DUPLICATE_SCHEDULE_OVERRIDE",
        "DUPLICATE_CUSTOM_FIELD_VALUE",
      ]),
    );
  });

  it("blocks audit readiness on an unexpected private payment row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const t = convexTest(schema, modules);
    const { organizationId } = await t.run(insertSources);
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.run(async (ctx) => {
      const employeeId = await insertMinimalEmployee(
        ctx,
        organizationId,
        "UNEXPECTED-001",
      );
      await ctx.db.insert("employeePaymentAccounts", {
        organizationId,
        employeeId,
        bankName: "Unexpected Bank",
        accountNumber: "unexpected-secret",
        accountName: "Unexpected Employee",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const startedAudit = await t.mutation(startAudit, { runId: write.runId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getAudit, { runId: write.runId }),
    ).resolves.toMatchObject({
      ready: false,
      destination: { unexpected: 1 },
    });
    const issues = await t.query(listAuditIssues, {
      auditId: startedAudit.auditId,
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(issues).toMatchObject({
      isDone: true,
      page: [
        expect.objectContaining({
          code: "UNEXPECTED_DESTINATION_ROW",
          field: "employeeId",
          entityType: "employeePaymentAccount",
        }),
      ],
    });
    expect(JSON.stringify(issues)).not.toContain("unexpected-secret");
  });
});
