import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

const processSchemaCleanupBatch = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  {
    done: boolean;
    cursor: string | null;
    counters: {
      scanned: number;
      changed: number;
      unchanged: number;
      skipped: number;
      conflicts: number;
      errors: number;
    };
  }
>("databaseMigrations:processSchemaCleanupBatch");

const startSchemaCleanup = makeFunctionReference<
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
>("databaseMigrations:startSchemaCleanup");

const getSchemaCleanupRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: {
      status: "queued" | "running" | "completed" | "failed";
      counters: {
        scanned: number;
        changed: number;
        unchanged: number;
        skipped: number;
        conflicts: number;
        errors: number;
      };
    };
    issues: Array<{ code: string; field: string }>;
    canStartWrite: boolean;
  }
>("databaseMigrations:getSchemaCleanupRun");

const getSchemaCleanupAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    ready: boolean;
    organizations: number;
    destination: {
      expected: number;
      matching: number;
      missing: number;
      duplicate: number;
      mismatched: number;
      unexpected: number;
    };
    duplicateLegacySettings: number;
    fieldManifest: ReadonlyArray<{
      table: string;
      field: string;
      classification: string;
    }>;
  }
>("databaseMigrations:getSchemaCleanupAudit");

const startSchemaCleanupAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits">; runId: Id<"migrationRuns"> }
>("databaseMigrations:startSchemaCleanupAudit");

const continueSchemaCleanup = makeFunctionReference<
  "action",
  { runId: Id<"migrationRuns"> },
  { done: boolean; failed?: boolean }
>("databaseMigrations:continueSchemaCleanup");

const listSchemaCleanupIssues = makeFunctionReference<
  "query",
  {
    runId: Id<"migrationRuns">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      code: string;
      field: string;
      organizationId?: Id<"organizations">;
    }>;
    isDone: boolean;
    continueCursor: string;
  }
>("databaseMigrations:listSchemaCleanupIssues");

const resumeSchemaCleanup = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { resumed: boolean; runId: Id<"migrationRuns"> }
>("databaseMigrations:resumeSchemaCleanup");

const resumeSchemaCleanupAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns"> },
  { resumed: boolean; auditId: Id<"migrationAudits"> }
>("databaseMigrations:resumeSchemaCleanupAudit");

afterEach(() => {
  vi.useRealTimers();
});

describe("database migration schema", () => {
  it("stores normalized organization configuration and migration state", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Normalized organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        createdAt: 1,
        updatedAt: 1,
      });
      const payrollId = await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const attendanceId = await ctx.db.insert(
        "organizationAttendanceSettings",
        {
          organizationId,
          attendanceSettings: { graceMinutes: 5, roundingRule: "none" },
          sourceSettingsId: settingsId,
          migrationVersion: 1,
          createdAt: 2,
          updatedAt: 2,
        },
      );
      const departmentId = await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Operations",
        normalizedName: "operations",
        color: "#9CA3AF",
        sourceSettingsId: settingsId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const requirementId = await ctx.db.insert(
        "organizationRequirementDefinitions",
        {
          organizationId,
          type: "NBI Clearance",
          normalizedType: "nbi clearance",
          isRequired: true,
          source: "organization",
          migrationVersion: 1,
          createdAt: 2,
          updatedAt: 2,
        },
      );
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      });
      const issueId = await ctx.db.insert("migrationIssues", {
        runId,
        organizationId,
        entityType: "organization",
        entityId: organizationId,
        field: "salaryPaymentFrequency",
        code: "PAYROLL_FREQUENCY_CONFLICT",
        createdAt: 2,
      });

      const [payroll, attendance, department, requirement, run, issues] =
        await Promise.all([
          ctx.db
            .query("organizationPayrollSettings")
            .withIndex("by_organization", (q) =>
              q.eq("organizationId", organizationId),
            )
            .unique(),
          ctx.db
            .query("organizationAttendanceSettings")
            .withIndex("by_organization", (q) =>
              q.eq("organizationId", organizationId),
            )
            .unique(),
          ctx.db
            .query("organizationDepartments")
            .withIndex("by_organization_normalized_name", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("normalizedName", "operations"),
            )
            .unique(),
          ctx.db
            .query("organizationRequirementDefinitions")
            .withIndex("by_organization_normalized_type", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("normalizedType", "nbi clearance"),
            )
            .unique(),
          ctx.db
            .query("migrationRuns")
            .withIndex("by_key_status", (q) =>
              q
                .eq("key", "schema-normalization-release-1")
                .eq("status", "running"),
            )
            .unique(),
          ctx.db
            .query("migrationIssues")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect(),
        ]);

      return {
        payrollId,
        attendanceId,
        departmentId,
        requirementId,
        runId,
        issueId,
        payroll,
        attendance,
        department,
        requirement,
        run,
        issues,
      };
    });

    expect(result.payroll?._id).toBe(result.payrollId);
    expect(result.attendance?._id).toBe(result.attendanceId);
    expect(result.department?._id).toBe(result.departmentId);
    expect(result.requirement?._id).toBe(result.requirementId);
    expect(result.run?._id).toBe(result.runId);
    expect(result.issues.map((issue) => issue._id)).toEqual([result.issueId]);
  });

  it("dry-runs one bounded organization batch without destination writes", async () => {
    const t = convexTest(schema, modules);
    const { runId, firstOrganizationId } = await t.run(async (ctx) => {
      const firstOrganizationId = await ctx.db.insert("organizations", {
        name: "First organization",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 25,
        secondPayDate: 30,
        defaultRequirements: [{ type: "NBI", isRequired: true }],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId: firstOrganizationId,
        payrollFrequency: "semi-monthly",
        attendanceSettings: { graceMinutes: 5 },
        departments: ["Operations"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        name: "Second organization",
        createdAt: 2,
        updatedAt: 2,
      });
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 1,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 3,
        updatedAt: 3,
      });
      return { runId, firstOrganizationId };
    });

    await expect(
      t.mutation(processSchemaCleanupBatch, { runId }),
    ).resolves.toMatchObject({
      done: false,
      counters: { scanned: 1, changed: 0, conflicts: 1 },
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(runId),
      payroll: await ctx.db.query("organizationPayrollSettings").collect(),
      attendance: await ctx.db
        .query("organizationAttendanceSettings")
        .collect(),
      departments: await ctx.db.query("organizationDepartments").collect(),
      requirements: await ctx.db
        .query("organizationRequirementDefinitions")
        .collect(),
      issues: await ctx.db
        .query("migrationIssues")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
    }));

    expect(state.run?.status).toBe("running");
    expect(state.run?.cursor).toEqual(expect.any(String));
    expect(state.payroll).toEqual([]);
    expect(state.attendance).toEqual([]);
    expect(state.departments).toEqual([]);
    expect(state.requirements).toEqual([]);
    expect(state.issues).toEqual([
      expect.objectContaining({
        organizationId: firstOrganizationId,
        entityType: "organization",
        field: "salaryPaymentFrequency",
        code: "PAYROLL_FREQUENCY_CONFLICT",
      }),
    ]);
    expect(JSON.stringify(state.issues)).not.toContain("semi-monthly");
  });

  it("reports an existing destination mismatch during dry-run", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Destination conflict organization",
        salaryPaymentFrequency: "monthly",
        firstPayDate: 25,
        secondPayDate: 30,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      });
    });

    await expect(
      t.mutation(processSchemaCleanupBatch, { runId }),
    ).resolves.toMatchObject({
      done: true,
      counters: { scanned: 1, changed: 0, conflicts: 1 },
    });
    const state = await t.run(async (ctx) => ({
      payroll: await ctx.db.query("organizationPayrollSettings").collect(),
      issues: await ctx.db
        .query("migrationIssues")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
    }));
    expect(state.payroll).toHaveLength(1);
    expect(state.payroll[0].firstPayDate).toBe(15);
    expect(state.issues).toEqual([
      expect.objectContaining({
        entityType: "organizationPayrollSettings",
        code: "DESTINATION_VALUE_CONFLICT",
      }),
    ]);
  });

  it("reports unexpected destination rows during dry-run", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Unexpected destination organization",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Stale",
        normalizedName: "stale",
        color: "#9CA3AF",
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      });
    });

    await expect(
      t.mutation(processSchemaCleanupBatch, { runId }),
    ).resolves.toMatchObject({ counters: { conflicts: 1 } });
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("migrationIssues")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      ),
    ).resolves.toMatchObject({
      code: "UNEXPECTED_DESTINATION_ROWS",
      field: "departments",
    });
  });

  it("rejects a department head who is not an active organization member", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Department organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "head@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId: otherOrganizationId,
        role: "manager",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("settings", {
        organizationId,
        departments: [
          {
            name: "Operations",
            color: "#9CA3AF",
            departmentHeadUserId: userId,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      });
    });

    await expect(
      t.mutation(processSchemaCleanupBatch, { runId }),
    ).resolves.toMatchObject({ counters: { conflicts: 1 } });
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("migrationIssues")
          .withIndex("by_run", (q) => q.eq("runId", runId))
          .unique(),
      ),
    ).resolves.toMatchObject({
      code: "INVALID_DEPARTMENT_HEAD_MEMBERSHIP",
      field: "departments",
    });
  });

  it("backfills normalized rows once and is idempotent on a second run", async () => {
    const t = convexTest(schema, modules);
    const { firstWriteRunId, dryRunId, organizationId } = await t.run(
      async (ctx) => {
        const organizationId = await ctx.db.insert("organizations", {
          name: "Backfill organization",
          salaryPaymentFrequency: "monthly",
          firstPayDate: 25,
          secondPayDate: 30,
          defaultRequirements: [{ type: "NBI", isRequired: true }],
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert("settings", {
          organizationId,
          payrollFrequency: "monthly",
          cutoffDates: { firstCutoff: 10, secondCutoff: 25 },
          payrollSettings: { nightDiffPercent: 1.1 },
          attendanceSettings: { graceMinutes: 5 },
          departments: ["Operations", "People"],
          createdAt: 1,
          updatedAt: 1,
        });
        const counters = {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        };
        const dryRunId = await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: true,
          status: "completed",
          phase: "organizations",
          batchSize: 20,
          counters,
          startedAt: 2,
          updatedAt: 2,
          completedAt: 2,
        });
        const firstWriteRunId = await ctx.db.insert("migrationRuns", {
          key: "schema-normalization-release-1",
          version: 1,
          dryRun: false,
          status: "running",
          phase: "organizations",
          batchSize: 20,
          counters,
          requiredDryRunId: dryRunId,
          startedAt: 3,
          updatedAt: 3,
        });
        return { firstWriteRunId, dryRunId, organizationId };
      },
    );

    await expect(
      t.mutation(processSchemaCleanupBatch, { runId: firstWriteRunId }),
    ).resolves.toMatchObject({
      done: true,
      counters: { scanned: 1, changed: 5, unchanged: 0, conflicts: 0 },
    });

    const firstState = await t.run(async (ctx) => ({
      payroll: await ctx.db.query("organizationPayrollSettings").collect(),
      attendance: await ctx.db
        .query("organizationAttendanceSettings")
        .collect(),
      departments: await ctx.db.query("organizationDepartments").collect(),
      requirements: await ctx.db
        .query("organizationRequirementDefinitions")
        .collect(),
    }));
    expect(firstState.payroll).toHaveLength(1);
    expect(firstState.attendance).toHaveLength(1);
    expect(firstState.departments).toHaveLength(2);
    expect(firstState.requirements).toHaveLength(1);
    expect(firstState.payroll[0]).toMatchObject({
      organizationId,
      salaryPaymentFrequency: "monthly",
      firstPayDate: 25,
      secondPayDate: 30,
      cutoffDates: { firstCutoff: 10, secondCutoff: 25 },
    });

    const secondWriteRunId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        requiredDryRunId: dryRunId,
        startedAt: 4,
        updatedAt: 4,
      }),
    );
    await expect(
      t.mutation(processSchemaCleanupBatch, { runId: secondWriteRunId }),
    ).resolves.toMatchObject({
      done: true,
      counters: { scanned: 1, changed: 0, unchanged: 5, conflicts: 0 },
    });

    const secondCounts = await t.run(async (ctx) => ({
      payroll: (await ctx.db.query("organizationPayrollSettings").collect())
        .length,
      attendance: (
        await ctx.db.query("organizationAttendanceSettings").collect()
      ).length,
      departments: (await ctx.db.query("organizationDepartments").collect())
        .length,
      requirements: (
        await ctx.db.query("organizationRequirementDefinitions").collect()
      ).length,
    }));
    expect(secondCounts).toEqual({
      payroll: 1,
      attendance: 1,
      departments: 2,
      requirements: 1,
    });
  });

  it("guards schema cleanup start arguments and active runs", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(startSchemaCleanup, { dryRun: true, batchSize: 0 }),
    ).rejects.toThrow("Batch size must be between 1 and 50");
    await expect(
      t.mutation(startSchemaCleanup, { dryRun: true, batchSize: 51 }),
    ).rejects.toThrow("Batch size must be between 1 and 50");
    await expect(
      t.mutation(startSchemaCleanup, { dryRun: false }),
    ).rejects.toThrow("Completed dry-run is required");

    const incompleteDryRunId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "failed",
        phase: "organizations",
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
    await expect(
      t.mutation(startSchemaCleanup, {
        dryRun: false,
        dryRunId: incompleteDryRunId,
      }),
    ).rejects.toThrow("Conflict-free completed dry-run is required");
    await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 2,
        updatedAt: 2,
      }),
    );
    await expect(
      t.mutation(startSchemaCleanup, { dryRun: true }),
    ).rejects.toThrow("A schema cleanup run is already active");
  });

  it("does not authorize write mode from a dry-run with conflicts", async () => {
    const t = convexTest(schema, modules);
    const dryRunId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 1,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      }),
    );

    await expect(
      t.query(getSchemaCleanupRun, { runId: dryRunId }),
    ).resolves.toMatchObject({ canStartWrite: false });
    await expect(
      t.mutation(startSchemaCleanup, { dryRun: false, dryRunId }),
    ).rejects.toThrow("Conflict-free completed dry-run is required");
  });

  it("marks a scheduled run failed when a batch cannot continue", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "queued",
        phase: "organizations",
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

    await expect(t.action(continueSchemaCleanup, { runId })).resolves.toEqual({
      done: true,
      failed: true,
    });
    await expect(t.run((ctx) => ctx.db.get(runId))).resolves.toMatchObject({
      status: "failed",
      failureCode: "BATCH_FAILED",
      counters: { errors: 1 },
    });
  });

  it("pages redacted issues while retaining organization identifiers", async () => {
    const t = convexTest(schema, modules);
    const { runId, organizationId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Issue organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 3,
          errors: 0,
        },
        startedAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("migrationIssues", {
          runId,
          organizationId,
          entityType: "organizationDepartment",
          field: "departments",
          code: "UNEXPECTED_DESTINATION_ROWS",
          createdAt: index + 1,
        });
      }
      return { runId, organizationId };
    });

    const firstPage = await t.query(listSchemaCleanupIssues, {
      runId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.page[0]).toMatchObject({ organizationId });
    expect(firstPage.isDone).toBe(false);
    expect(JSON.stringify(firstPage)).not.toContain("normalizedName");

    const secondPage = await t.query(listSchemaCleanupIssues, {
      runId,
      paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });

  it("resumes a stale active run from its saved cursor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:10:00.000Z"));
    const t = convexTest(schema, modules);
    const runId = await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        name: "Resume organization",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: Date.now() - 10 * 60 * 1_000,
        updatedAt: Date.now() - 10 * 60 * 1_000,
      });
    });

    await expect(t.mutation(resumeSchemaCleanup, { runId })).resolves.toEqual({
      resumed: true,
      runId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.run((ctx) => ctx.db.get(runId))).resolves.toMatchObject({
      status: "completed",
      counters: { scanned: 1 },
    });
  });

  it("resumes a stale audit from its saved phase and cursor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:10:00.000Z"));
    const t = convexTest(schema, modules);
    const { runId, auditId } = await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        name: "Audit resume organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const runId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 1,
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
        status: "running",
        phase: "organizations",
        batchSize: 1,
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
        startedAt: Date.now() - 10 * 60 * 1_000,
        updatedAt: Date.now() - 10 * 60 * 1_000,
      });
      return { runId, auditId };
    });

    await expect(
      t.mutation(resumeSchemaCleanupAudit, { runId }),
    ).resolves.toEqual({ resumed: true, auditId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.run((ctx) => ctx.db.get(auditId))).resolves.toMatchObject({
      status: "completed",
      organizations: 1,
    });
  });

  it("runs all organizations in scheduled batches and reports status", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 1; index <= 3; index += 1) {
        await ctx.db.insert("organizations", {
          name: `Organization ${index}`,
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    const started = await t.mutation(startSchemaCleanup, {
      dryRun: true,
      batchSize: 1,
    });
    expect(started).toMatchObject({
      key: "schema-normalization-release-1",
      version: 1,
      dryRun: true,
    });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getSchemaCleanupRun, { runId: started.runId }),
    ).resolves.toMatchObject({
      run: {
        status: "completed",
        counters: { scanned: 3, changed: 0, conflicts: 0, errors: 0 },
      },
      issues: [],
      canStartWrite: true,
    });
    const destinationCounts = await t.run(async (ctx) => ({
      payroll: (await ctx.db.query("organizationPayrollSettings").collect())
        .length,
      attendance: (
        await ctx.db.query("organizationAttendanceSettings").collect()
      ).length,
    }));
    expect(destinationCounts).toEqual({ payroll: 0, attendance: 0 });
  });

  it("reports readiness only when every normalized destination matches", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { dryRunId, incompleteWriteRunId } = await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        name: "Audit organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const counters = {
        scanned: 1,
        changed: 0,
        unchanged: 0,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      };
      const dryRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters,
        startedAt: 2,
        updatedAt: 2,
        completedAt: 2,
      });
      const incompleteWriteRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters,
        requiredDryRunId: dryRunId,
        startedAt: 3,
        updatedAt: 3,
        completedAt: 3,
      });
      return { dryRunId, incompleteWriteRunId };
    });

    await t.mutation(startSchemaCleanupAudit, {
      runId: incompleteWriteRunId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getSchemaCleanupAudit, { runId: incompleteWriteRunId }),
    ).resolves.toMatchObject({
      ready: false,
      organizations: 1,
      destination: {
        expected: 1,
        matching: 0,
        missing: 1,
        duplicate: 0,
        mismatched: 0,
      },
      duplicateLegacySettings: 0,
    });

    const writeRunId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "running",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        requiredDryRunId: dryRunId,
        startedAt: 4,
        updatedAt: 4,
      }),
    );
    await t.mutation(processSchemaCleanupBatch, { runId: writeRunId });
    await t.mutation(startSchemaCleanupAudit, {
      runId: writeRunId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getSchemaCleanupAudit, { runId: writeRunId }),
    ).resolves.toMatchObject({
      ready: true,
      organizations: 1,
      destination: {
        expected: 1,
        matching: 1,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
      },
      duplicateLegacySettings: 0,
    });
  });

  it("rejects an audit for a run outside the Release 1 migration", async () => {
    const t = convexTest(schema, modules);
    const runId = await t.run((ctx) =>
      ctx.db.insert("migrationRuns", {
        key: "another-migration",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
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

    await expect(
      t.mutation(startSchemaCleanupAudit, { runId }),
    ).rejects.toThrow("Conflict-free completed write run is required");
  });

  it("audits every organization across persisted cursor pages", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 1; index <= 3; index += 1) {
        await ctx.db.insert("organizations", {
          name: `Audit page organization ${index}`,
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    const dryRun = await t.mutation(startSchemaCleanup, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const writeRun = await t.mutation(startSchemaCleanup, {
      dryRun: false,
      dryRunId: dryRun.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.mutation(startSchemaCleanupAudit, {
      runId: writeRun.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(
      t.query(getSchemaCleanupAudit, { runId: writeRun.runId }),
    ).resolves.toMatchObject({
      status: "completed",
      ready: true,
      organizations: 3,
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

  it("blocks readiness when normalized tables contain unexpected stale rows", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { writeRunId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Stale destination organization",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.insert("organizationDepartments", {
        organizationId,
        name: "Stale",
        normalizedName: "stale",
        color: "#9CA3AF",
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const dryRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: true,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        startedAt: 3,
        updatedAt: 3,
        completedAt: 3,
      });
      const writeRunId = await ctx.db.insert("migrationRuns", {
        key: "schema-normalization-release-1",
        version: 1,
        dryRun: false,
        status: "completed",
        phase: "organizations",
        batchSize: 20,
        counters: {
          scanned: 1,
          changed: 1,
          unchanged: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        requiredDryRunId: dryRunId,
        startedAt: 4,
        updatedAt: 4,
        completedAt: 4,
      });
      return { writeRunId };
    });

    await t.mutation(startSchemaCleanupAudit, {
      runId: writeRunId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getSchemaCleanupAudit, { runId: writeRunId }),
    ).resolves.toMatchObject({
      ready: false,
      destination: {
        expected: 1,
        matching: 1,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 1,
      },
    });
  });
});
