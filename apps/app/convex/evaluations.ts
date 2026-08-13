import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { runOrgQuery } from "./queryAuthGrace";
import {
  loadEffectiveEvaluation,
  replaceEvaluationProjection,
} from "./workflowCompatibility";

const templateSectionValidator = v.object({
  label: v.string(),
  weight: v.optional(v.number()),
});

const selfReviewValidator = v.object({
  rating: v.optional(v.number()),
  notes: v.optional(v.string()),
  submittedAt: v.optional(v.number()),
});

const managerReviewValidator = v.object({
  rating: v.optional(v.number()),
  notes: v.optional(v.string()),
  submittedAt: v.optional(v.number()),
  reviewerId: v.optional(v.id("users")),
});

// Helper to enforce org + elevated people role
async function checkOrgHrAdmin(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const role = membership.role;
  if (
    role !== "owner" &&
    role !== "admin" &&
    role !== "hr" &&
    role !== "manager" &&
    role !== "accounting"
  ) {
    throw new Error("Not authorized");
  }

  return { userRecord: user, role };
}

function appendEvaluationHistory(
  evaluation: Doc<"evaluations">,
  action: string,
  userId: Id<"users">,
  summary?: string,
) {
  return [
    ...(evaluation.history ?? []),
    {
      action,
      at: Date.now(),
      by: userId,
      ...(summary ? { summary } : {}),
    },
  ];
}

async function validateTemplateForOrganization(
  ctx: QueryCtx | MutationCtx,
  templateId: Id<"evaluationTemplates"> | undefined,
  organizationId: Id<"organizations">,
) {
  if (!templateId) return;
  const template = await ctx.db.get(templateId);
  if (!template || template.organizationId !== organizationId) {
    throw new Error("Evaluation template not found");
  }
}

export const getEvaluationTemplates = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkOrgHrAdmin(ctx, args.organizationId);

      const templates = await (ctx.db.query("evaluationTemplates") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      return templates.sort((a: any, b: any) =>
        a.name.localeCompare(b.name),
      );
    }, []);
  },
});

export const createEvaluationTemplate = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    reviewCycle: v.optional(v.string()),
    sections: v.array(templateSectionValidator),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userRecord } = await checkOrgHrAdmin(ctx, args.organizationId);
    const now = Date.now();

    return await ctx.db.insert("evaluationTemplates", {
      organizationId: args.organizationId,
      name: args.name.trim(),
      reviewCycle: args.reviewCycle?.trim() || undefined,
      sections: args.sections,
      isActive: args.isActive ?? true,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getEvaluations = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkOrgHrAdmin(ctx, args.organizationId);

      let evaluations = await (ctx.db.query("evaluations") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      if (args.employeeId) {
        evaluations = evaluations.filter(
          (e: any) => e.employeeId === args.employeeId,
        );
      }

      evaluations.sort((a: any, b: any) => b.evaluationDate - a.evaluationDate);
      return Promise.all(
        evaluations.map((evaluation: Doc<"evaluations">) =>
          loadEffectiveEvaluation(ctx, evaluation),
        ),
      );
    }, []);
  },
});

export const createEvaluation = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    templateId: v.optional(v.id("evaluationTemplates")),
    evaluationDate: v.number(),
    label: v.string(), // e.g. "1st month", "6th month", "Annual", etc.
    reviewCycle: v.optional(v.string()),
    rating: v.optional(v.number()), // 1-5 rating or similar
    frequencyMonths: v.optional(v.number()), // legacy/unused but kept for compatibility
    attachmentUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    selfReview: v.optional(selfReviewValidator),
    managerReview: v.optional(managerReviewValidator),
    assignedReviewerIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const { userRecord } = await checkOrgHrAdmin(ctx, args.organizationId);
    await validateTemplateForOrganization(
      ctx,
      args.templateId,
      args.organizationId,
    );
    const now = Date.now();

    const id = await ctx.db.insert("evaluations", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      templateId: args.templateId,
      evaluationDate: args.evaluationDate,
      label: args.label,
      reviewCycle: args.reviewCycle,
      rating: args.rating,
      frequencyMonths: args.frequencyMonths,
      attachmentUrl: args.attachmentUrl,
      notes: args.notes,
      selfReview: args.selfReview,
      managerReview: args.managerReview,
      assignedReviewerIds: args.assignedReviewerIds,
      history: [
        {
          action: "created",
          at: now,
          by: userRecord._id,
          summary: args.label,
        },
      ],
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

    const evaluation = await ctx.db.get(id);
    if (!evaluation) throw new Error("Evaluation creation did not persist");
    await replaceEvaluationProjection(
      ctx,
      evaluation,
      args.assignedReviewerIds ?? [],
      evaluation.history ?? [],
      now,
    );

    return id;
  },
});

export const updateEvaluation = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    templateId: v.optional(v.id("evaluationTemplates")),
    label: v.optional(v.string()),
    evaluationDate: v.optional(v.number()),
    reviewCycle: v.optional(v.string()),
    rating: v.optional(v.number()),
    frequencyMonths: v.optional(v.number()),
    attachmentUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
    selfReview: v.optional(selfReviewValidator),
    managerReview: v.optional(managerReviewValidator),
    assignedReviewerIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.lockedAt) {
      throw new Error("Locked evaluations cannot be edited");
    }

    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);
    await validateTemplateForOrganization(
      ctx,
      args.templateId,
      existing.organizationId,
    );

    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    const history = appendEvaluationHistory(
      effective,
      "updated",
      userRecord._id,
    );
    const updates: Partial<Doc<"evaluations">> = {
      updatedAt: now,
      history,
    };
    if (args.templateId !== undefined) updates.templateId = args.templateId;
    if (args.label !== undefined) updates.label = args.label;
    if (args.evaluationDate !== undefined)
      updates.evaluationDate = args.evaluationDate;
    if (args.reviewCycle !== undefined) updates.reviewCycle = args.reviewCycle;
    if (args.rating !== undefined) updates.rating = args.rating;
    if (args.frequencyMonths !== undefined)
      updates.frequencyMonths = args.frequencyMonths;
    if (args.attachmentUrl !== undefined)
      updates.attachmentUrl = args.attachmentUrl;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.selfReview !== undefined) updates.selfReview = args.selfReview;
    if (args.managerReview !== undefined)
      updates.managerReview = args.managerReview;
    if (args.assignedReviewerIds !== undefined)
      updates.assignedReviewerIds = args.assignedReviewerIds;

    await ctx.db.patch(args.evaluationId, updates);
    await replaceEvaluationProjection(
      ctx,
      existing,
      args.assignedReviewerIds ??
        effective.assignedReviewerIds ?? [],
      history,
      now,
    );
    return { success: true };
  },
});

export const assignEvaluationReviewers = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    reviewerIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.lockedAt) {
      throw new Error("Locked evaluations cannot be changed");
    }

    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);

    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    const history = appendEvaluationHistory(
      effective,
      "reviewers_assigned",
      userRecord._id,
      `${args.reviewerIds.length} reviewer(s)`,
    );
    await replaceEvaluationProjection(
      ctx,
      existing,
      args.reviewerIds,
      history,
      now,
    );
    await ctx.db.patch(args.evaluationId, { updatedAt: now });

    return { success: true };
  },
});

export const lockEvaluation = mutation({
  args: { evaluationId: v.id("evaluations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.lockedAt) return { success: true };

    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);
    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    const history = appendEvaluationHistory(
      effective,
      "locked",
      userRecord._id,
    );

    await replaceEvaluationProjection(
      ctx,
      existing,
      effective.assignedReviewerIds ?? [],
      history,
      now,
    );

    await ctx.db.patch(args.evaluationId, {
      lockedAt: now,
      lockedBy: userRecord._id,
      updatedAt: now,
      history,
    });

    return { success: true };
  },
});

export const deleteEvaluation = mutation({
  args: { evaluationId: v.id("evaluations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.lockedAt) {
      throw new Error("Locked evaluations cannot be deleted");
    }

    await checkOrgHrAdmin(ctx, existing.organizationId);
    await replaceEvaluationProjection(ctx, existing, [], [], Date.now());
    await ctx.db.delete(args.evaluationId);
    return { success: true };
  },
});
