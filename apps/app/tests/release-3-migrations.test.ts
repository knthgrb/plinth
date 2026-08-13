import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
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

const startCleanup = makeFunctionReference<
  "mutation",
  { dryRun: boolean; dryRunId?: Id<"migrationRuns">; batchSize?: number },
  { runId: Id<"migrationRuns"> }
>("release3Migrations:startRelease3ContractCleanup");
const acknowledgeExport = makeFunctionReference<
  "mutation",
  { dryRunId: Id<"migrationRuns">; exportReference: string }
>("release3Migrations:acknowledgeRelease3ContractExport");
const getRun = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    run: { status: string; counters: { changed: number; conflicts: number; errors: number } };
    canStartWrite: boolean;
  }
>("release3Migrations:getRelease3ContractCleanupRun");
const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits"> }
>("release3Migrations:startRelease3ContractAudit");
const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  { ready: boolean; status: string; destination: { missing: number }; sourceConflicts: number }
>("release3Migrations:getRelease3ContractAudit");
const listAuditIssues = makeFunctionReference<
  "query",
  {
    auditId: Id<"migrationAudits">;
    paginationOpts: { numItems: number; cursor: string | null };
  },
  {
    page: Array<{
      entityType: string;
      entityId?: string;
      field: string;
      code: string;
    }>;
  }
>("release3Migrations:listRelease3ContractAuditIssues");

afterEach(() => vi.useRealTimers());

describe("Release 3 contract cleanup", () => {
  it("requires an export, clears all tenants, audits, and becomes idempotent", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Legacy Org",
        firstPayDate: 15,
        secondPayDate: 30,
        salaryPaymentFrequency: "bimonthly",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "legacy@example.com",
        organizationId,
        role: "owner",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        payrollFrequency: "monthly",
        settingsVersion: 2,
        settingsChangeLog: [
          { area: "payroll", version: 2, changedBy: userId, changedAt: 1 },
        ],
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, userId, settingsId };
    });

    const dryRun = await t.mutation(startCleanup, { dryRun: true, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const dryState = await t.query(getRun, { runId: dryRun.runId });
    expect(dryState).toMatchObject({
      canStartWrite: false,
      run: { status: "completed", counters: { conflicts: 0, errors: 0 } },
    });
    expect(dryState.run.counters.changed).toBeGreaterThan(0);
    await expect(
      t.mutation(startCleanup, {
        dryRun: false,
        dryRunId: dryRun.runId,
        batchSize: 1,
      }),
    ).rejects.toThrow("Clean exported dry-run is required");

    await t.mutation(acknowledgeExport, {
      dryRunId: dryRun.runId,
      exportReference: "prod-backup-2026-08-13",
    });
    await expect(t.query(getRun, { runId: dryRun.runId })).resolves.toMatchObject({
      canStartWrite: true,
    });

    const writeRun = await t.mutation(startCleanup, {
      dryRun: false,
      dryRunId: dryRun.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: writeRun.runId })).resolves.toMatchObject({
      run: { status: "completed", counters: { conflicts: 0, errors: 0 } },
    });

    const cleaned = await t.run(async (ctx) => ({
      organization: await ctx.db.get(ids.organizationId),
      user: await ctx.db.get(ids.userId),
      settings: await ctx.db.get(ids.settingsId),
    }));
    expect(cleaned.organization).not.toHaveProperty("firstPayDate");
    expect(cleaned.user).not.toHaveProperty("organizationId");
    expect(cleaned.settings).not.toHaveProperty("settingsChangeLog");

    await t.mutation(startAudit, { runId: writeRun.runId, batchSize: 1 });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getAudit, { runId: writeRun.runId })).resolves.toMatchObject({
      ready: true,
      status: "completed",
      sourceConflicts: 0,
      destination: { missing: 0 },
    });

    const finalDryRun = await t.mutation(startCleanup, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(t.query(getRun, { runId: finalDryRun.runId })).resolves.toMatchObject({
      run: { status: "completed", counters: { changed: 0, conflicts: 0, errors: 0 } },
    });
  });

  it("reports every residual legacy field found by the audit", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const organizationId = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Residual Legacy Org",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    const dryRun = await t.mutation(startCleanup, {
      dryRun: true,
      batchSize: 10,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.mutation(acknowledgeExport, {
      dryRunId: dryRun.runId,
      exportReference: "prod-backup-residual-test",
    });
    const writeRun = await t.mutation(startCleanup, {
      dryRun: false,
      dryRunId: dryRun.runId,
      batchSize: 10,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run((ctx) => ctx.db.patch(organizationId, { firstPayDate: 15 }));
    const { auditId } = await t.mutation(startAudit, {
      runId: writeRun.runId,
      batchSize: 10,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(t.query(getAudit, { runId: writeRun.runId })).resolves.toMatchObject({
      ready: false,
      destination: { missing: 1 },
    });
    await expect(
      t.query(listAuditIssues, {
        auditId,
        paginationOpts: { numItems: 100, cursor: null },
      }),
    ).resolves.toMatchObject({
      page: [
        {
          entityType: "organizations",
          entityId: organizationId,
          field: "firstPayDate",
          code: "LEGACY_FIELD_REMAINS",
        },
      ],
    });
  });
});
