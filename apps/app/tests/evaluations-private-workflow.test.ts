import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

type Role = "owner" | "admin" | "hr" | "manager" | "accounting" | "employee";

const scheduleEvaluation = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    title: string;
    scheduledFor: number;
    cadence:
      | { kind: "none" }
      | { kind: "quarterly" }
      | { kind: "semiannual" }
      | { kind: "annual" }
      | { kind: "custom"; intervalMonths: number };
    reviewerIds?: Id<"users">[];
  },
  { evaluationId: Id<"evaluations">; scheduleId?: Id<"evaluationSchedules"> }
>("evaluations:scheduleEvaluation");

const completeEvaluation = makeFunctionReference<
  "mutation",
  {
    evaluationId: Id<"evaluations">;
    completedAt: number;
    rating?: number;
    notes?: string;
    outcome?:
      | "exceeds_expectations"
      | "meets_expectations"
      | "partially_meets_expectations"
      | "does_not_meet_expectations";
    followUpDate?: number;
    attachmentIds?: Id<"_storage">[];
  },
  { success: true; nextEvaluationId?: Id<"evaluations"> }
>("evaluations:completeEvaluation");

const getEvaluationWorkspace = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  { employees: unknown[]; summary: unknown }
>("evaluations:getEvaluationWorkspace");

const createUploadIntent = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    purpose: "evaluation_attachment";
  },
  { intentId: Id<"storageUploadIntents">; uploadUrl: string }
>("files:createUploadIntent");

const registerUploadedFile = makeFunctionReference<
  "mutation",
  {
    intentId: Id<"storageUploadIntents">;
    storageId: Id<"_storage">;
    fileName?: string;
  },
  Id<"storageObjects">
>("files:registerUploadedFile");

const getEvaluationAttachmentUrl = makeFunctionReference<
  "query",
  { evaluationId: Id<"evaluations">; storageId: Id<"_storage"> },
  string | null
>("evaluations:getEvaluationAttachmentUrl");

const updateScheduledEvaluation = makeFunctionReference<
  "mutation",
  {
    evaluationId: Id<"evaluations">;
    title?: string;
    scheduledFor?: number;
    reviewerIds?: Id<"users">[];
  },
  { success: true }
>("evaluations:updateScheduledEvaluation");

const cancelEvaluation = makeFunctionReference<
  "mutation",
  { evaluationId: Id<"evaluations">; reason: string },
  { success: true }
>("evaluations:cancelEvaluation");

const setEvaluationScheduleActive = makeFunctionReference<
  "mutation",
  { scheduleId: Id<"evaluationSchedules">; isActive: boolean },
  { success: true }
>("evaluations:setEvaluationScheduleActive");

const defaultSchedule = {
  monday: { in: "09:00", out: "18:00", isWorkday: true },
  tuesday: { in: "09:00", out: "18:00", isWorkday: true },
  wednesday: { in: "09:00", out: "18:00", isWorkday: true },
  thursday: { in: "09:00", out: "18:00", isWorkday: true },
  friday: { in: "09:00", out: "18:00", isWorkday: true },
  saturday: { in: "09:00", out: "18:00", isWorkday: false },
  sunday: { in: "09:00", out: "18:00", isWorkday: false },
};

async function setup() {
  const t = convexTest(schema, modules);
  const roles: Role[] = ["owner", "admin", "hr", "manager", "accounting", "employee"];
  const emails = Object.fromEntries(
    roles.map((role) => [role, `evaluations-${role}@example.com`]),
  ) as Record<Role, string>;

  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Private Evaluations",
      createdAt: 1,
      updatedAt: 1,
    });
    const otherOrganizationId = await ctx.db.insert("organizations", {
      name: "Other Organization",
      createdAt: 1,
      updatedAt: 1,
    });
    const userIds = {} as Record<Role, Id<"users">>;

    for (const role of roles) {
      const userId = await ctx.db.insert("users", {
        email: emails[role],
        name: role,
        createdAt: 1,
        updatedAt: 1,
      });
      userIds[role] = userId;
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role,
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
    }

    const createEmployee = (targetOrganizationId: Id<"organizations">, employeeCode: string) =>
      ctx.db.insert("employees", {
        organizationId: targetOrganizationId,
        personalInfo: {
          firstName: employeeCode,
          lastName: "Employee",
          email: `${employeeCode.toLowerCase()}@example.com`,
        },
        employment: {
          employeeId: employeeCode,
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });

    return {
      organizationId,
      employeeId: await createEmployee(organizationId, "EVAL-001"),
      otherEmployeeId: await createEmployee(otherOrganizationId, "OTHER-001"),
      userIds,
    };
  });

  return { t, emails, ...fixture };
}

describe("private evaluation workflow", () => {
  it("allows only owner, admin, and HR to access evaluation records", async () => {
    const { t, emails, organizationId, employeeId } = await setup();
    const input = {
      organizationId,
      employeeId,
      title: "Annual review",
      scheduledFor: Date.UTC(2026, 7, 31),
      cadence: { kind: "none" as const },
    };

    for (const role of ["manager", "accounting", "employee"] as const) {
      const actor = t.withIdentity({ email: emails[role] });
      await expect(actor.query(getEvaluationWorkspace, { organizationId })).rejects.toThrow(
        "Not authorized",
      );
      await expect(actor.mutation(scheduleEvaluation, input)).rejects.toThrow(
        "Not authorized",
      );
    }

    for (const role of ["owner", "admin", "hr"] as const) {
      const actor = t.withIdentity({ email: emails[role] });
      await expect(actor.query(getEvaluationWorkspace, { organizationId })).resolves.toBeDefined();
    }
  });

  it("rejects an employee belonging to another organization", async () => {
    const { t, emails, organizationId, otherEmployeeId } = await setup();

    await expect(
      t.withIdentity({ email: emails.hr }).mutation(scheduleEvaluation, {
        organizationId,
        employeeId: otherEmployeeId,
        title: "Invalid review",
        scheduledFor: Date.UTC(2026, 7, 31),
        cadence: { kind: "none" },
      }),
    ).rejects.toThrow("Employee does not belong to this organization");
  });

  it("preserves scheduled and actual completion dates as separate facts", async () => {
    const { t, emails, organizationId, employeeId } = await setup();
    const hr = t.withIdentity({ email: emails.hr });
    const scheduledFor = Date.UTC(2026, 7, 31);
    const completedAt = Date.UTC(2026, 8, 2);
    const { evaluationId } = await hr.mutation(scheduleEvaluation, {
      organizationId,
      employeeId,
      title: "Annual review",
      scheduledFor,
      cadence: { kind: "none" },
    });

    await hr.mutation(completeEvaluation, {
      evaluationId,
      completedAt,
      rating: 4.5,
      notes: "Consistent delivery",
      outcome: "meets_expectations",
      followUpDate: Date.UTC(2026, 11, 1),
    });

    const evaluation = await t.run((ctx) => ctx.db.get(evaluationId));
    expect(evaluation).toMatchObject({
      status: "completed",
      scheduledFor,
      completedAt,
      evaluationDate: scheduledFor,
      rating: 4.5,
      notes: "Consistent delivery",
      outcome: "meets_expectations",
      followUpDate: Date.UTC(2026, 11, 1),
    });
  });

  it("creates exactly one next occurrence when a recurring review is completed", async () => {
    const { t, emails, organizationId, employeeId } = await setup();
    const hr = t.withIdentity({ email: emails.hr });
    const scheduledFor = Date.UTC(2026, 0, 31);
    const created = await hr.mutation(scheduleEvaluation, {
      organizationId,
      employeeId,
      title: "Monthly probation review",
      scheduledFor,
      cadence: { kind: "custom", intervalMonths: 1 },
    });

    const firstCompletion = await hr.mutation(completeEvaluation, {
      evaluationId: created.evaluationId,
      completedAt: Date.UTC(2026, 1, 2),
      outcome: "meets_expectations",
    });
    const secondCompletion = await hr.mutation(completeEvaluation, {
      evaluationId: created.evaluationId,
      completedAt: Date.UTC(2026, 1, 2),
      outcome: "meets_expectations",
    });

    const state = await t.run(async (ctx) => ({
      evaluations: await ctx.db
        .query("evaluations")
        .withIndex("by_employee", (query) => query.eq("employeeId", employeeId))
        .collect(),
      schedule: created.scheduleId ? await ctx.db.get(created.scheduleId) : null,
    }));
    expect(firstCompletion.nextEvaluationId).toBeDefined();
    expect(secondCompletion.nextEvaluationId).toBe(firstCompletion.nextEvaluationId);
    expect(state.evaluations).toHaveLength(2);
    expect(state.evaluations.find((evaluation) => evaluation.status === "scheduled")).toMatchObject({
      scheduledFor: Date.UTC(2026, 1, 28),
      evaluationDate: Date.UTC(2026, 1, 28),
    });
    expect(state.schedule).toMatchObject({
      nextDueAt: Date.UTC(2026, 1, 28),
      isActive: true,
    });
  });

  it("keeps attached evaluation forms private and evaluation-scoped", async () => {
    const { t, emails, organizationId, employeeId } = await setup();
    const hr = t.withIdentity({ email: emails.hr });
    const employee = t.withIdentity({ email: emails.employee });
    const manager = t.withIdentity({ email: emails.manager });

    await expect(
      employee.mutation(createUploadIntent, {
        organizationId,
        purpose: "evaluation_attachment",
      }),
    ).rejects.toThrow("Not authorized");

    const intent = await hr.mutation(createUploadIntent, {
      organizationId,
      purpose: "evaluation_attachment",
    });
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["evaluation form"])),
    );
    await hr.mutation(registerUploadedFile, {
      intentId: intent.intentId,
      storageId,
      fileName: "annual-review.pdf",
    });
    const { evaluationId } = await hr.mutation(scheduleEvaluation, {
      organizationId,
      employeeId,
      title: "Annual review",
      scheduledFor: Date.UTC(2026, 7, 31),
      cadence: { kind: "none" },
    });
    await hr.mutation(completeEvaluation, {
      evaluationId,
      completedAt: Date.UTC(2026, 8, 2),
      attachmentIds: [storageId],
    });

    await expect(
      hr.query(getEvaluationAttachmentUrl, { evaluationId, storageId }),
    ).resolves.toMatch(/^https:\/\//);
    await expect(
      manager.query(getEvaluationAttachmentUrl, { evaluationId, storageId }),
    ).rejects.toThrow("Not authorized");

    const unrelatedIntent = await hr.mutation(createUploadIntent, {
      organizationId,
      purpose: "evaluation_attachment",
    });
    const unrelatedStorageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["unrelated form"])),
    );
    await hr.mutation(registerUploadedFile, {
      intentId: unrelatedIntent.intentId,
      storageId: unrelatedStorageId,
    });
    await expect(
      hr.query(getEvaluationAttachmentUrl, {
        evaluationId,
        storageId: unrelatedStorageId,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("allows HR to reschedule, pause, and cancel an unfinished evaluation", async () => {
    const { t, emails, organizationId, employeeId, userIds } = await setup();
    const hr = t.withIdentity({ email: emails.hr });
    const created = await hr.mutation(scheduleEvaluation, {
      organizationId,
      employeeId,
      title: "Quarterly review",
      scheduledFor: Date.UTC(2026, 6, 31),
      cadence: { kind: "quarterly" },
    });
    if (!created.scheduleId) throw new Error("Recurring schedule was not created");

    await hr.mutation(updateScheduledEvaluation, {
      evaluationId: created.evaluationId,
      title: "Quarterly development review",
      scheduledFor: Date.UTC(2026, 7, 15),
      reviewerIds: [userIds.manager],
    });
    await hr.mutation(setEvaluationScheduleActive, {
      scheduleId: created.scheduleId,
      isActive: false,
    });

    const updated = await t.run(async (ctx) => ({
      evaluation: await ctx.db.get(created.evaluationId),
      schedule: await ctx.db.get(created.scheduleId!),
      reviewers: await ctx.db
        .query("evaluationReviewers")
        .withIndex("by_evaluation_reviewer", (query) =>
          query.eq("evaluationId", created.evaluationId),
        )
        .collect(),
    }));
    expect(updated.evaluation).toMatchObject({
      label: "Quarterly development review",
      scheduledFor: Date.UTC(2026, 7, 15),
      evaluationDate: Date.UTC(2026, 7, 15),
    });
    expect(updated.schedule).toMatchObject({
      title: "Quarterly development review",
      nextDueAt: Date.UTC(2026, 7, 15),
      reviewerIds: [userIds.manager],
      isActive: false,
    });
    expect(updated.reviewers.map((reviewer) => reviewer.reviewerId)).toEqual([
      userIds.manager,
    ]);

    await hr.mutation(cancelEvaluation, {
      evaluationId: created.evaluationId,
      reason: "Review moved to the next cycle",
    });
    const cancelled = await t.run((ctx) => ctx.db.get(created.evaluationId));
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancellationReason: "Review moved to the next cycle",
      cancelledBy: userIds.hr,
    });
    expect(cancelled?.cancelledAt).toBeTypeOf("number");
  });
});
