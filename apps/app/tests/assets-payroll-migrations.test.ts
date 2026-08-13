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

const startMigration = makeFunctionReference<
  "mutation",
  { dryRun: boolean; dryRunId?: Id<"migrationRuns">; batchSize?: number },
  { runId: Id<"migrationRuns"> }
>("assetsPayrollMigrations:startAssetsPayrollMigration");
const getRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: {
      status: string;
      counters: {
        scanned: number;
        changed: number;
        unchanged: number;
        conflicts: number;
        errors: number;
      };
    };
    issues: Array<{ code: string; field: string }>;
    canStartWrite: boolean;
  }
>("assetsPayrollMigrations:getAssetsPayrollMigrationRun");
const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits"> }
>("assetsPayrollMigrations:startAssetsPayrollAudit");
const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    ready: boolean;
    status: string;
    sourceConflicts: number;
    destination: {
      expected: number;
      matching: number;
      missing: number;
      duplicate: number;
      mismatched: number;
      unexpected: number;
      totalRows: number;
    };
  }
>("assetsPayrollMigrations:getAssetsPayrollAudit");

type TestCtx = Omit<MutationCtx, "storage"> & {
  storage: { store(blob: Blob): Promise<Id<"_storage">> };
};

async function insertSources(ctx: TestCtx) {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Assets Payroll Migration Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const userId = await ctx.db.insert("users", {
    email: "owner@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("userOrganizations", {
    userId,
    organizationId,
    role: "owner",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Payroll",
      lastName: "Employee",
      email: "employee@example.com",
    },
    employment: {
      employeeId: "AP-001",
      position: "Analyst",
      department: "Finance",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 1, salaryType: "monthly" },
    schedule: {
      defaultSchedule: {
        monday: { in: "09:00", out: "18:00", isWorkday: true },
        tuesday: { in: "09:00", out: "18:00", isWorkday: true },
        wednesday: { in: "09:00", out: "18:00", isWorkday: true },
        thursday: { in: "09:00", out: "18:00", isWorkday: true },
        friday: { in: "09:00", out: "18:00", isWorkday: true },
        saturday: { in: "09:00", out: "18:00", isWorkday: false },
        sunday: { in: "09:00", out: "18:00", isWorkday: false },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
  const payrollRunId = await ctx.db.insert("payrollRuns", {
    organizationId,
    cutoffStart: 1,
    cutoffEnd: 15,
    period: "Test period",
    status: "draft",
    processedBy: userId,
    notes: [{ employeeId, date: 2, note: "Review", addedBy: userId, addedAt: 3 }],
    createdAt: 1,
    updatedAt: 3,
  });
  const storageId = await ctx.storage.store(new Blob(["receipt"]));
  await ctx.db.insert("storageObjects", {
    storageId,
    organizationId,
    ownerUserId: userId,
    purpose: "accounting_receipt",
    state: "active",
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("accountingCostItems", {
    organizationId,
    sourceType: "manual",
    sourceKey: "manual:1",
    categoryName: "Operational Cost",
    name: "Equipment",
    amount: 100,
    amountPaid: 100,
    frequency: "one-time",
    status: "paid",
    receipts: [storageId],
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("assets", {
    organizationId,
    name: "Laptop",
    quantity: 1,
    assignedEmployeeId: employeeId,
    assignedAt: 10,
    assignedBy: userId,
    custodyAcknowledgedAt: 11,
    returnDueDate: 20,
    returnedAt: 21,
    maintenanceHistory: [{ date: 12, description: "Cleaned", cost: 50 }],
    status: "active",
    createdAt: 1,
    updatedAt: 21,
  });
  return { organizationId, payrollRunId };
}

afterEach(() => vi.useRealTimers());

describe("assets and payroll migration", () => {
  it("dry-runs, writes, audits, and becomes idempotent", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertSources);

    const dryRun = await t.mutation(startMigration, { dryRun: true, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: dryRun.runId })).resolves.toMatchObject({
      canStartWrite: true,
      run: { status: "completed", counters: { scanned: 3, changed: 6, conflicts: 0, errors: 0 } },
    });

    const write = await t.mutation(startMigration, { dryRun: false, dryRunId: dryRun.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run(async (ctx) => ({
      notes: (await ctx.db.query("payrollRunNotes").collect()).length,
      links: (await ctx.db.query("storageObjectLinks").collect()).length,
      custody: (await ctx.db.query("assetCustodyEvents").collect()).length,
      maintenance: (await ctx.db.query("assetMaintenanceEvents").collect()).length,
    }))).toEqual({ notes: 1, links: 1, custody: 3, maintenance: 1 });

    await t.mutation(startAudit, { runId: write.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getAudit, { runId: write.runId })).resolves.toMatchObject({
      status: "completed",
      ready: true,
      sourceConflicts: 0,
      destination: { expected: 6, matching: 6, missing: 0, duplicate: 0, mismatched: 0, unexpected: 0, totalRows: 6 },
    });

    const verification = await t.mutation(startMigration, { dryRun: true, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: verification.runId })).resolves.toMatchObject({
      canStartWrite: true,
      run: { counters: { changed: 0, unchanged: 6, conflicts: 0 } },
    });
  });

  it("blocks an incomplete asset custody source", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const source = await t.run(insertSources);
    await t.run(async (ctx) => {
      const asset = await ctx.db.query("assets").first();
      if (!asset) throw new Error("Asset fixture was not found");
      await ctx.db.patch(asset._id, { assignedAt: undefined });
    });
    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });
    expect(source.organizationId).toBeDefined();
    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toContainEqual(expect.objectContaining({ code: "INVALID_ASSET_CUSTODY_STATE", field: "custody" }));
  });

  it("does not block note projection on an unrelated historical processor", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const source = await t.run(insertSources);
    await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Historical Processor Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const historicalProcessorId = await ctx.db.insert("users", {
        email: "historical@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: historicalProcessorId,
        organizationId: otherOrganizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(source.payrollRunId, {
        processedBy: historicalProcessorId,
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(true);
    expect(status.issues).toEqual([]);
    expect(status.run.counters).toMatchObject({
      changed: 6,
      conflicts: 0,
      errors: 0,
    });
  });
});
