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
  {
    dryRun: boolean;
    dryRunId?: Id<"migrationRuns">;
    batchSize?: number;
  },
  { runId: Id<"migrationRuns">; dryRun: boolean; key: string; version: number }
>("workflowMigrations:startWorkflowMigration");

const getRun = makeFunctionReference<
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
>("workflowMigrations:getWorkflowMigrationRun");

const startAudit = makeFunctionReference<
  "mutation",
  { runId: Id<"migrationRuns">; batchSize?: number },
  { auditId: Id<"migrationAudits">; runId: Id<"migrationRuns"> }
>("workflowMigrations:startWorkflowAudit");

const getAudit = makeFunctionReference<
  "query",
  { runId: Id<"migrationRuns"> },
  {
    status: string;
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
>("workflowMigrations:getWorkflowAudit");

type MigrationTestCtx = Omit<MutationCtx, "storage"> & {
  storage: { store(blob: Blob): Promise<Id<"_storage">> };
};

const insertSources = async (ctx: MigrationTestCtx) => {
  const organizationId = await ctx.db.insert("organizations", {
    name: "Workflow Migration Org",
    createdAt: 1,
    updatedAt: 1,
  });
  const reviewerId = await ctx.db.insert("users", {
    email: "reviewer@example.com",
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("userOrganizations", {
    userId: reviewerId,
    organizationId,
    role: "hr",
    accessStatus: "active",
    joinedAt: 1,
    updatedAt: 1,
  });
  const employeeId = await ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Workflow",
      lastName: "Employee",
      email: "employee@example.com",
    },
    employment: {
      employeeId: "WF-001",
      position: "Analyst",
      department: "People",
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
  await ctx.db.insert("settings", {
    organizationId,
    evaluationColumns: [{ id: "rating", label: "Rating", type: "rating" }],
    settingsVersion: 1,
    settingsChangeLog: [
      {
        area: "evaluations",
        version: 1,
        changedBy: reviewerId,
        changedAt: 1,
        reason: "Initial setup",
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  });
  await ctx.db.insert("evaluations", {
    organizationId,
    employeeId,
    evaluationDate: 1,
    label: "Annual",
    assignedReviewerIds: [reviewerId],
    history: [{ action: "created", at: 1, by: reviewerId, summary: "Annual" }],
    createdBy: reviewerId,
    createdAt: 1,
    updatedAt: 1,
  });
  const jobId = await ctx.db.insert("jobs", {
    organizationId,
    title: "Engineer",
    department: "Engineering",
    position: "Engineer",
    employmentType: "regular",
    numberOfOpenings: 1,
    description: "Role",
    requirements: [],
    qualifications: [],
    status: "open",
    postedDate: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const resume = await ctx.storage.store(new Blob(["private resume"]));
  await ctx.db.insert("applicants", {
    organizationId,
    jobId,
    firstName: "Applicant",
    lastName: "Example",
    email: "applicant@example.com",
    phone: "09170000000",
    resume,
    status: "offer",
    appliedDate: 1,
    pipelineStageHistory: [{ to: "new", changedAt: 1 }],
    notes: [{ date: 2, author: reviewerId, content: "private note" }],
    interviewSchedules: [
      { date: 3, type: "panel", interviewer: reviewerId, remarks: "private" },
    ],
    scorecards: [
      {
        reviewer: reviewerId,
        criteria: [{ label: "Communication", score: 5, notes: "private" }],
        overallScore: 5,
        submittedAt: 4,
      },
    ],
    offerApproval: {
      status: "pending",
      requestedBy: reviewerId,
      requestedAt: 5,
      notes: "private offer note",
    },
    customFields: { "Portfolio Score": 95 },
    createdAt: 1,
    updatedAt: 5,
  });
  return { organizationId };
};

afterEach(() => vi.useRealTimers());

describe("workflow migration", () => {
  it("blocks duplicate reviewer keys before write mode", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertSources);
    await t.run(async (ctx) => {
      const evaluation = await ctx.db.query("evaluations").first();
      if (!evaluation?.assignedReviewerIds?.[0]) {
        throw new Error("Evaluation fixture was not found");
      }
      await ctx.db.patch(evaluation._id, {
        assignedReviewerIds: [
          evaluation.assignedReviewerIds[0],
          evaluation.assignedReviewerIds[0],
        ],
      });
    });

    const dryRun = await t.mutation(startMigration, { dryRun: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const status = await t.query(getRun, { runId: dryRun.runId });

    expect(status.canStartWrite).toBe(false);
    expect(status.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_EVALUATION_REVIEWER",
          field: "reviewerId",
        }),
      ]),
    );
    expect(JSON.stringify(status)).not.toContain("private note");
  });

  it("dry-runs, writes, and becomes idempotent without changing legacy parents", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run(insertSources);
    const dryRun = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: dryRun.runId }),
    ).resolves.toMatchObject({
      canStartWrite: true,
      run: {
        status: "completed",
        counters: { scanned: 3, changed: 11, conflicts: 0, errors: 0 },
      },
    });
    const beforeWrite = await t.run(async (ctx) => ({
      normalized: await ctx.db.query("evaluationEvents").take(1),
      applicant: await ctx.db.query("applicants").first(),
    }));
    expect(beforeWrite.normalized).toEqual([]);
    expect(beforeWrite.applicant?.notes?.[0].content).toBe("private note");

    const write = await t.mutation(startMigration, {
      dryRun: false,
      dryRunId: dryRun.runId,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: write.runId }),
    ).resolves.toMatchObject({
      run: { status: "completed", counters: { changed: 11, conflicts: 0 } },
    });
    const verify = await t.mutation(startMigration, {
      dryRun: true,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(getRun, { runId: verify.runId }),
    ).resolves.toMatchObject({
      canStartWrite: true,
      run: { counters: { changed: 0, unchanged: 11, conflicts: 0 } },
    });
  });

  it("persists a clean post-write audit over every target table", async () => {
    vi.useFakeTimers();
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
        expected: 11,
        matching: 11,
        missing: 0,
        duplicate: 0,
        mismatched: 0,
        unexpected: 0,
        totalRows: 11,
      },
    });
  });
});
