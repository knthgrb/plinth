import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { runOrgQuery } from "./queryAuthGrace";
import {
  loadEffectiveEvaluation,
  replaceEvaluationProjection,
  type EffectiveEvaluation,
} from "./workflowCompatibility";
import {
  getEvaluationTiming,
  getNextEvaluationDate,
  type EvaluationCadence,
} from "@/lib/evaluations/workflow";

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

const cadenceValidator = v.union(
  v.object({ kind: v.literal("none") }),
  v.object({ kind: v.literal("quarterly") }),
  v.object({ kind: v.literal("semiannual") }),
  v.object({ kind: v.literal("annual") }),
  v.object({
    kind: v.literal("custom"),
    intervalMonths: v.number(),
  }),
);

const outcomeValidator = v.union(
  v.literal("exceeds_expectations"),
  v.literal("meets_expectations"),
  v.literal("partially_meets_expectations"),
  v.literal("does_not_meet_expectations"),
);

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
    role !== "hr"
  ) {
    throw new Error("Not authorized");
  }

  return { userRecord: user, role };
}

async function validateEmployeeForOrganization(
  ctx: QueryCtx | MutationCtx,
  employeeId: Id<"employees">,
  organizationId: Id<"organizations">,
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee || employee.organizationId !== organizationId) {
    throw new Error("Employee does not belong to this organization");
  }
  return employee;
}

async function validateReviewersForOrganization(
  ctx: QueryCtx | MutationCtx,
  reviewerIds: Id<"users">[],
  organizationId: Id<"organizations">,
) {
  const uniqueReviewerIds = Array.from(new Set(reviewerIds));
  if (uniqueReviewerIds.length !== reviewerIds.length) {
    throw new Error("Evaluation reviewer is not unique");
  }

  for (const reviewerId of uniqueReviewerIds) {
    const membership = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (query) =>
        query.eq("userId", reviewerId).eq("organizationId", organizationId),
      )
      .unique();
    if (
      !membership ||
      membership.accessStatus !== "active" ||
      !["owner", "admin", "hr", "manager"].includes(membership.role)
    ) {
      throw new Error("Evaluation reviewer is not eligible");
    }
  }
}

async function replaceEvaluationAttachments(
  ctx: MutationCtx,
  evaluation: Doc<"evaluations">,
  attachmentIds: Id<"_storage">[],
  now: number,
) {
  const uniqueAttachmentIds = Array.from(new Set(attachmentIds));
  if (uniqueAttachmentIds.length !== attachmentIds.length) {
    throw new Error("Evaluation attachment is not unique");
  }
  for (const storageId of uniqueAttachmentIds) {
    const storageObject = await ctx.db
      .query("storageObjects")
      .withIndex("by_storage", (query) => query.eq("storageId", storageId))
      .unique();
    if (
      !storageObject ||
      storageObject.organizationId !== evaluation.organizationId ||
      storageObject.purpose !== "evaluation_attachment" ||
      storageObject.state !== "active"
    ) {
      throw new Error("Evaluation attachment is not available");
    }
  }

  const existingLinks = await ctx.db
    .query("storageObjectLinks")
    .withIndex("by_parent", (query) =>
      query.eq("parentType", "evaluation").eq("parentId", evaluation._id),
    )
    .collect();
  for (const link of existingLinks) await ctx.db.delete(link._id);
  for (const [sourceIndex, storageId] of uniqueAttachmentIds.entries()) {
    await ctx.db.insert("storageObjectLinks", {
      organizationId: evaluation.organizationId,
      storageId,
      parentType: "evaluation",
      parentId: evaluation._id,
      purpose: "evaluation_attachment",
      sourceIndex,
      migrationVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function normalizedEvaluation(evaluation: EffectiveEvaluation) {
  return {
    ...evaluation,
    status: evaluation.status ?? ("completed" as const),
    scheduledFor: evaluation.scheduledFor ?? evaluation.evaluationDate,
    completedAt:
      evaluation.completedAt ??
      (evaluation.status === "scheduled" ? undefined : evaluation.evaluationDate),
  };
}

function scheduleCadence(
  schedule: Doc<"evaluationSchedules">,
): EvaluationCadence {
  if (schedule.cadenceKind === "custom") {
    return {
      kind: "custom",
      intervalMonths: schedule.intervalMonths ?? 1,
    };
  }
  return { kind: schedule.cadenceKind };
}

function appendEvaluationHistory(
  evaluation: EffectiveEvaluation,
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

      const templates = await ctx.db
        .query("evaluationTemplates")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      return templates.sort((a, b) => a.name.localeCompare(b.name));
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

      let evaluations = await ctx.db
        .query("evaluations")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      if (args.employeeId) {
        evaluations = evaluations.filter(
          (evaluation) => evaluation.employeeId === args.employeeId,
        );
      }

      evaluations.sort((a, b) => b.evaluationDate - a.evaluationDate);
      const effectiveEvaluations = await Promise.all(
        evaluations.map((evaluation: Doc<"evaluations">) =>
          loadEffectiveEvaluation(ctx, evaluation),
        ),
      );
      return effectiveEvaluations.map(normalizedEvaluation);
    }, []);
  },
});

export const getEvaluationWorkspace = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkOrgHrAdmin(ctx, args.organizationId);
    const [employees, evaluations, schedules, templates, memberships] =
      await Promise.all([
        ctx.db
          .query("employees")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
        ctx.db
          .query("evaluations")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
        ctx.db
          .query("evaluationSchedules")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
        ctx.db
          .query("evaluationTemplates")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
        ctx.db
          .query("userOrganizations")
          .withIndex("by_organization", (query) =>
            query.eq("organizationId", args.organizationId),
          )
          .collect(),
      ]);

    const effectiveEvaluations = (
      await Promise.all(
        evaluations.map((evaluation) => loadEffectiveEvaluation(ctx, evaluation)),
      )
    ).map(normalizedEvaluation);
    const now = Date.now();
    const summary = effectiveEvaluations.reduce(
      (counts, evaluation) => {
        const timing = getEvaluationTiming(
          evaluation.status,
          evaluation.scheduledFor,
          now,
        );
        if (timing === "completed") counts.completed += 1;
        if (timing === "scheduled") counts.scheduled += 1;
        if (timing === "due_soon") counts.dueSoon += 1;
        if (timing === "overdue") counts.overdue += 1;
        return counts;
      },
      { completed: 0, scheduled: 0, dueSoon: 0, overdue: 0 },
    );

    const employeeRows = employees
      .map((employee) => {
        const employeeEvaluations = effectiveEvaluations
          .filter((evaluation) => evaluation.employeeId === employee._id)
          .sort((left, right) => right.scheduledFor - left.scheduledFor);
        const lastCompleted = employeeEvaluations
          .filter((evaluation) => evaluation.status === "completed")
          .sort(
            (left, right) =>
              (right.completedAt ?? right.scheduledFor) -
              (left.completedAt ?? left.scheduledFor),
          )[0];
        const nextEvaluation = employeeEvaluations
          .filter((evaluation) => evaluation.status === "scheduled")
          .sort((left, right) => left.scheduledFor - right.scheduledFor)[0];
        const employeeSchedules = schedules.filter(
          (schedule) => schedule.employeeId === employee._id,
        );

        return {
          employee: {
            _id: employee._id,
            firstName: employee.personalInfo.firstName,
            lastName: employee.personalInfo.lastName,
            employeeCode: employee.employment.employeeId,
            position: employee.employment.position,
            department: employee.employment.department,
            employmentStatus: employee.employment.status,
          },
          schedules: employeeSchedules,
          lastCompleted,
          nextEvaluation,
          evaluationCount: employeeEvaluations.length,
        };
      })
      .sort((left, right) => {
        const lastName = left.employee.lastName.localeCompare(
          right.employee.lastName,
        );
        return lastName !== 0
          ? lastName
          : left.employee.firstName.localeCompare(right.employee.firstName);
      });

    const reviewerUserIds = Array.from(
      new Set(
        memberships
          .filter(
            (membership) =>
              membership.accessStatus === "active" &&
              ["owner", "admin", "hr", "manager"].includes(membership.role),
          )
          .map((membership) => membership.userId),
      ),
    );
    const reviewers = (
      await Promise.all(reviewerUserIds.map((userId) => ctx.db.get(userId)))
    )
      .filter((user): user is Doc<"users"> => user !== null)
      .map((user) => ({ _id: user._id, name: user.name, email: user.email }));

    return {
      employees: employeeRows,
      evaluations: effectiveEvaluations,
      schedules,
      templates: templates
        .filter((template) => template.isActive)
        .sort((left, right) => left.name.localeCompare(right.name)),
      reviewers,
      summary,
    };
  },
});

export const getEvaluationAttachmentUrl = query({
  args: {
    evaluationId: v.id("evaluations"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const evaluation = await ctx.db.get(args.evaluationId);
    if (!evaluation) throw new Error("Not authorized");
    await checkOrgHrAdmin(ctx, evaluation.organizationId);
    const link = await ctx.db
      .query("storageObjectLinks")
      .withIndex("by_storage_parent", (query) =>
        query
          .eq("storageId", args.storageId)
          .eq("parentType", "evaluation")
          .eq("parentId", args.evaluationId),
      )
      .unique();
    if (
      !link ||
      link.organizationId !== evaluation.organizationId ||
      link.purpose !== "evaluation_attachment"
    ) {
      throw new Error("Not authorized");
    }
    return ctx.storage.getUrl(args.storageId);
  },
});

export const scheduleEvaluation = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    templateId: v.optional(v.id("evaluationTemplates")),
    title: v.string(),
    scheduledFor: v.number(),
    cadence: cadenceValidator,
    reviewerIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const { userRecord } = await checkOrgHrAdmin(ctx, args.organizationId);
    await Promise.all([
      validateEmployeeForOrganization(
        ctx,
        args.employeeId,
        args.organizationId,
      ),
      validateTemplateForOrganization(
        ctx,
        args.templateId,
        args.organizationId,
      ),
      validateReviewersForOrganization(
        ctx,
        args.reviewerIds ?? [],
        args.organizationId,
      ),
    ]);
    const title = args.title.trim();
    if (!title) throw new Error("Evaluation title is required");
    if (
      args.cadence.kind === "custom" &&
      (!Number.isInteger(args.cadence.intervalMonths) ||
        args.cadence.intervalMonths < 1)
    ) {
      throw new Error("Custom evaluation cadence must be at least one month");
    }

    const now = Date.now();
    const reviewerIds = args.reviewerIds ?? [];
    const scheduleId =
      args.cadence.kind === "none"
        ? undefined
        : await ctx.db.insert("evaluationSchedules", {
            organizationId: args.organizationId,
            employeeId: args.employeeId,
            templateId: args.templateId,
            title,
            cadenceKind: args.cadence.kind,
            intervalMonths:
              args.cadence.kind === "custom"
                ? args.cadence.intervalMonths
                : undefined,
            nextDueAt: args.scheduledFor,
            reviewerIds,
            isActive: true,
            createdBy: userRecord._id,
            updatedBy: userRecord._id,
            createdAt: now,
            updatedAt: now,
          });
    const evaluationId = await ctx.db.insert("evaluations", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      templateId: args.templateId,
      scheduleId,
      status: "scheduled",
      scheduledFor: args.scheduledFor,
      evaluationDate: args.scheduledFor,
      label: title,
      reviewCycle:
        args.cadence.kind === "none" ? "Ad hoc" : args.cadence.kind,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });
    const evaluation = await ctx.db.get(evaluationId);
    if (!evaluation) throw new Error("Evaluation creation did not persist");
    await replaceEvaluationProjection(
      ctx,
      evaluation,
      reviewerIds,
      [
        {
          action: "scheduled",
          at: now,
          by: userRecord._id,
          summary: title,
        },
      ],
      now,
    );
    return { evaluationId, ...(scheduleId ? { scheduleId } : {}) };
  },
});

export const completeEvaluation = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    completedAt: v.number(),
    rating: v.optional(v.number()),
    notes: v.optional(v.string()),
    outcome: v.optional(outcomeValidator),
    followUpDate: v.optional(v.number()),
    attachmentIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);
    if ((existing.status ?? "completed") === "completed") {
      return {
        success: true as const,
        ...(existing.nextEvaluationId
          ? { nextEvaluationId: existing.nextEvaluationId }
          : {}),
      };
    }
    if (existing.status === "cancelled") {
      throw new Error("Cancelled evaluations cannot be completed");
    }
    if (
      args.rating !== undefined &&
      (args.rating < 1 || args.rating > 5)
    ) {
      throw new Error("Evaluation rating must be between 1 and 5");
    }

    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    const history = appendEvaluationHistory(
      effective,
      "completed",
      userRecord._id,
      args.outcome,
    );
    await ctx.db.patch(existing._id, {
      status: "completed",
      completedAt: args.completedAt,
      rating: args.rating,
      notes: args.notes?.trim() || undefined,
      outcome: args.outcome,
      followUpDate: args.followUpDate,
      lockedAt: now,
      lockedBy: userRecord._id,
      updatedAt: now,
    });
    await replaceEvaluationProjection(
      ctx,
      existing,
      effective.assignedReviewerIds,
      history,
      now,
    );
    await replaceEvaluationAttachments(
      ctx,
      existing,
      args.attachmentIds ?? effective.attachmentIds,
      now,
    );

    if (!existing.scheduleId) return { success: true as const };
    const schedule = await ctx.db.get(existing.scheduleId);
    if (
      !schedule ||
      schedule.organizationId !== existing.organizationId ||
      !schedule.isActive
    ) {
      return { success: true as const };
    }

    const nextDueAt = getNextEvaluationDate(
      existing.scheduledFor ?? existing.evaluationDate,
      scheduleCadence(schedule),
    );
    if (nextDueAt === null) return { success: true as const };

    const scheduleEvaluations = await ctx.db
      .query("evaluations")
      .withIndex("by_schedule", (query) =>
        query.eq("scheduleId", schedule._id),
      )
      .collect();
    const existingNext = scheduleEvaluations.find(
      (evaluation) =>
        evaluation.status === "scheduled" &&
        evaluation.scheduledFor === nextDueAt,
    );
    const nextEvaluationId =
      existingNext?._id ??
      (await ctx.db.insert("evaluations", {
        organizationId: existing.organizationId,
        employeeId: existing.employeeId,
        templateId: schedule.templateId,
        scheduleId: schedule._id,
        status: "scheduled",
        scheduledFor: nextDueAt,
        evaluationDate: nextDueAt,
        label: schedule.title,
        reviewCycle: schedule.cadenceKind,
        createdBy: userRecord._id,
        createdAt: now,
        updatedAt: now,
      }));
    if (!existingNext) {
      const nextEvaluation = await ctx.db.get(nextEvaluationId);
      if (!nextEvaluation) {
        throw new Error("Next evaluation creation did not persist");
      }
      await replaceEvaluationProjection(
        ctx,
        nextEvaluation,
        schedule.reviewerIds,
        [
          {
            action: "scheduled",
            at: now,
            by: userRecord._id,
            summary: schedule.title,
          },
        ],
        now,
      );
    }
    await Promise.all([
      ctx.db.patch(schedule._id, {
        nextDueAt,
        updatedBy: userRecord._id,
        updatedAt: now,
      }),
      ctx.db.patch(existing._id, { nextEvaluationId }),
    ]);
    return { success: true as const, nextEvaluationId };
  },
});

export const updateScheduledEvaluation = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    title: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    templateId: v.optional(v.id("evaluationTemplates")),
    reviewerIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.status !== "scheduled") {
      throw new Error("Only scheduled evaluations can be changed");
    }
    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);
    await Promise.all([
      validateTemplateForOrganization(
        ctx,
        args.templateId,
        existing.organizationId,
      ),
      validateReviewersForOrganization(
        ctx,
        args.reviewerIds ?? [],
        existing.organizationId,
      ),
    ]);
    const title = args.title?.trim();
    if (args.title !== undefined && !title) {
      throw new Error("Evaluation title is required");
    }

    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    const reviewers = args.reviewerIds ?? effective.assignedReviewerIds;
    await ctx.db.patch(existing._id, {
      ...(title ? { label: title } : {}),
      ...(args.scheduledFor !== undefined
        ? {
            scheduledFor: args.scheduledFor,
            evaluationDate: args.scheduledFor,
          }
        : {}),
      ...(args.templateId !== undefined
        ? { templateId: args.templateId }
        : {}),
      updatedAt: now,
    });
    await replaceEvaluationProjection(
      ctx,
      existing,
      reviewers,
      appendEvaluationHistory(effective, "rescheduled", userRecord._id),
      now,
    );

    if (existing.scheduleId) {
      const schedule = await ctx.db.get(existing.scheduleId);
      if (!schedule || schedule.organizationId !== existing.organizationId) {
        throw new Error("Evaluation schedule not found");
      }
      await ctx.db.patch(schedule._id, {
        ...(title ? { title } : {}),
        ...(args.scheduledFor !== undefined
          ? { nextDueAt: args.scheduledFor }
          : {}),
        ...(args.templateId !== undefined
          ? { templateId: args.templateId }
          : {}),
        reviewerIds: reviewers,
        updatedBy: userRecord._id,
        updatedAt: now,
      });
    }
    return { success: true as const };
  },
});

export const setEvaluationScheduleActive = mutation({
  args: {
    scheduleId: v.id("evaluationSchedules"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new Error("Evaluation schedule not found");
    const { userRecord } = await checkOrgHrAdmin(ctx, schedule.organizationId);
    await ctx.db.patch(schedule._id, {
      isActive: args.isActive,
      updatedBy: userRecord._id,
      updatedAt: Date.now(),
    });
    return { success: true as const };
  },
});

export const cancelEvaluation = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");
    if (existing.status !== "scheduled") {
      throw new Error("Only scheduled evaluations can be cancelled");
    }
    const { userRecord } = await checkOrgHrAdmin(ctx, existing.organizationId);
    const reason = args.reason.trim();
    if (!reason) throw new Error("Cancellation reason is required");
    const now = Date.now();
    const effective = await loadEffectiveEvaluation(ctx, existing);
    await ctx.db.patch(existing._id, {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: userRecord._id,
      cancellationReason: reason,
      lockedAt: now,
      lockedBy: userRecord._id,
      updatedAt: now,
    });
    await replaceEvaluationProjection(
      ctx,
      existing,
      effective.assignedReviewerIds,
      appendEvaluationHistory(effective, "cancelled", userRecord._id, reason),
      now,
    );
    return { success: true as const };
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
    await Promise.all([
      validateEmployeeForOrganization(
        ctx,
        args.employeeId,
        args.organizationId,
      ),
      validateTemplateForOrganization(
        ctx,
        args.templateId,
        args.organizationId,
      ),
      validateReviewersForOrganization(
        ctx,
        args.assignedReviewerIds ?? [],
        args.organizationId,
      ),
    ]);
    const now = Date.now();
    const history = [
      {
        action: "created",
        at: now,
        by: userRecord._id,
        summary: args.label,
      },
    ];

    const id = await ctx.db.insert("evaluations", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      templateId: args.templateId,
      status: "completed",
      scheduledFor: args.evaluationDate,
      completedAt: args.evaluationDate,
      evaluationDate: args.evaluationDate,
      label: args.label,
      reviewCycle: args.reviewCycle,
      rating: args.rating,
      attachmentUrl: args.attachmentUrl,
      notes: args.notes,
      selfReview: args.selfReview,
      managerReview: args.managerReview,
      lockedAt: now,
      lockedBy: userRecord._id,
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
      history,
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
    };
    if (args.templateId !== undefined) updates.templateId = args.templateId;
    if (args.label !== undefined) updates.label = args.label;
    if (args.evaluationDate !== undefined)
      updates.evaluationDate = args.evaluationDate;
    if (args.reviewCycle !== undefined) updates.reviewCycle = args.reviewCycle;
    if (args.rating !== undefined) updates.rating = args.rating;
    if (args.attachmentUrl !== undefined)
      updates.attachmentUrl = args.attachmentUrl;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.selfReview !== undefined) updates.selfReview = args.selfReview;
    if (args.managerReview !== undefined)
      updates.managerReview = args.managerReview;

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
