import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
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

async function setup() {
  const t = convexTest(schema, modules);
  const email = "workflow-hr@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Workflow Compatibility",
      createdAt: 1,
      updatedAt: 1,
    });
    const actorId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    const legacyReviewerId = await ctx.db.insert("users", {
      email: "legacy-reviewer@example.com",
      createdAt: 1,
      updatedAt: 1,
    });
    const normalizedReviewerId = await ctx.db.insert("users", {
      email: "normalized-reviewer@example.com",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId: actorId,
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
        email: "workflow-employee@example.com",
      },
      employment: {
        employeeId: "WF-001",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        status: "active",
      },
      compensation: { basicSalary: 30_000, salaryType: "monthly" },
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
    const evaluationId = await ctx.db.insert("evaluations", {
      organizationId,
      employeeId,
      evaluationDate: 1,
      label: "Annual",
      assignedReviewerIds: [legacyReviewerId],
      createdBy: actorId,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("evaluationReviewers", {
      organizationId,
      evaluationId,
      reviewerId: normalizedReviewerId,
      sourceIndex: 0,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      organizationId,
      actorId,
      evaluationId,
      legacyReviewerId,
      normalizedReviewerId,
    };
  });
  return { t, actor: t.withIdentity({ email }), ...fixture };
}

describe("workflow compatibility", () => {
  it("uses normalized reviewers before conflicting embedded reviewers", async () => {
    const { actor, organizationId, normalizedReviewerId } = await setup();
    const evaluations = await actor.query(api.evaluations.getEvaluations, {
      organizationId,
    });
    expect(evaluations[0]?.assignedReviewerIds).toEqual([
      normalizedReviewerId,
    ]);
  });

  it("writes reviewer assignments only to normalized rows", async () => {
    const { t, actor, actorId, evaluationId, legacyReviewerId } = await setup();
    await actor.mutation(api.evaluations.assignEvaluationReviewers, {
      evaluationId,
      reviewerIds: [actorId],
    });
    const state = await t.run(async (ctx) => ({
      evaluation: await ctx.db.get(evaluationId),
      reviewers: await ctx.db
        .query("evaluationReviewers")
        .withIndex("by_evaluation_reviewer", (q) =>
          q.eq("evaluationId", evaluationId),
        )
        .collect(),
    }));
    expect(state.evaluation?.assignedReviewerIds).toEqual([legacyReviewerId]);
    expect(state.reviewers.map((row) => row.reviewerId)).toEqual([actorId]);
  });

  it("appends to normalized evaluation history and removes child rows on delete", async () => {
    const { t, actor, actorId, evaluationId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(evaluationId, {
        history: [{ action: "legacy", at: 1, by: actorId }],
      });
      await ctx.db.insert("evaluationEvents", {
        organizationId: (await ctx.db.get(evaluationId))!.organizationId,
        evaluationId,
        sourceIndex: 0,
        action: "normalized",
        at: 2,
        by: actorId,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
    });

    await actor.mutation(api.evaluations.updateEvaluation, {
      evaluationId,
      label: "Updated",
    });
    const state = await t.run(async (ctx) => ({
      evaluation: await ctx.db.get(evaluationId),
      events: await ctx.db
        .query("evaluationEvents")
        .withIndex("by_evaluation_source_index", (q) =>
          q.eq("evaluationId", evaluationId),
        )
        .collect(),
    }));
    expect(state.evaluation?.history?.map((event) => event.action)).toEqual([
      "legacy",
    ]);
    expect(state.events.map((event) => event.action)).toEqual([
      "normalized",
      "updated",
    ]);
    const updated = state.evaluation;

    await actor.mutation(api.evaluations.deleteEvaluation, { evaluationId });
    const children = await t.run(async (ctx) => ({
      reviewers: await ctx.db
        .query("evaluationReviewers")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", updated!.organizationId),
        )
        .filter((q) => q.eq(q.field("evaluationId"), evaluationId))
        .collect(),
      events: await ctx.db
        .query("evaluationEvents")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", updated!.organizationId),
        )
        .filter((q) => q.eq(q.field("evaluationId"), evaluationId))
        .collect(),
    }));
    expect(children).toEqual({ reviewers: [], events: [] });
  });

  it("appends settings audit history from the normalized event stream", async () => {
    const { t, actor, actorId, organizationId } = await setup();
    const settingsId = await t.run(async (ctx) => {
      const settingsId = await ctx.db.insert("settings", {
        organizationId,
        settingsVersion: 7,
        settingsChangeLog: [
          {
            area: "leave",
            version: 1,
            changedBy: actorId,
            changedAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationSettingsEvents", {
        organizationId,
        sourceSettingsId: settingsId,
        sourceIndex: 0,
        area: "payroll",
        version: 7,
        changedBy: actorId,
        changedAt: 2,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return settingsId;
    });

    await actor.mutation(api.settings.updateDepartments, {
      organizationId,
      departments: [{ name: "Engineering", color: "#123456" }],
    });

    const state = await t.run(async (ctx) => ({
      settings: await ctx.db.get(settingsId),
      events: await ctx.db
        .query("organizationSettingsEvents")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
    }));
    expect(state.settings?.settingsChangeLog?.map((event) => event.area)).toEqual([
      "leave",
    ]);
    expect(
      state.events
        .sort((left, right) => left.sourceIndex - right.sourceIndex)
        .map((event) => event.area),
    ).toEqual(["payroll", "organization"]);
  });
});
