import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to enforce org + role (admin or hr)
async function checkOrgHrAdmin(ctx: any, organizationId: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
    )
    .first();

  const role = userOrg?.role || userRecord.role;
  if (
    userOrg?.organizationId !== organizationId &&
    userRecord.organizationId !== organizationId
  ) {
    throw new Error("User is not a member of this organization");
  }
  if (
    role !== "owner" &&
    role !== "admin" &&
    role !== "hr" &&
    role !== "accounting"
  ) {
    throw new Error("Not authorized");
  }

  return { userRecord, role };
}

export const getEvaluations = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    await checkOrgHrAdmin(ctx, args.organizationId);

    let evaluations = await (ctx.db.query("evaluations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (args.employeeId) {
      evaluations = evaluations.filter(
        (e: any) => e.employeeId === args.employeeId
      );
    }

    evaluations.sort((a: any, b: any) => b.evaluationDate - a.evaluationDate);
    return evaluations;
  },
});

export const createEvaluation = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
    evaluationDate: v.number(),
    label: v.string(), // e.g. "1st month", "6th month", "Annual", etc.
    rating: v.optional(v.number()), // 1-5 rating or similar
    frequencyMonths: v.optional(v.number()), // legacy/unused but kept for compatibility
    attachmentUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userRecord } = await checkOrgHrAdmin(ctx, args.organizationId);
    const now = Date.now();

    const id = await ctx.db.insert("evaluations", {
      organizationId: args.organizationId,
      employeeId: args.employeeId,
      evaluationDate: args.evaluationDate,
      label: args.label,
      rating: args.rating,
      frequencyMonths: args.frequencyMonths,
      attachmentUrl: args.attachmentUrl,
      notes: args.notes,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

export const updateEvaluation = mutation({
  args: {
    evaluationId: v.id("evaluations"),
    label: v.optional(v.string()),
    evaluationDate: v.optional(v.number()),
    rating: v.optional(v.number()),
    frequencyMonths: v.optional(v.number()),
    attachmentUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");

    await checkOrgHrAdmin(ctx, existing.organizationId);

    const updates: any = { updatedAt: Date.now() };
    if (args.label !== undefined) updates.label = args.label;
    if (args.evaluationDate !== undefined)
      updates.evaluationDate = args.evaluationDate;
    if (args.rating !== undefined) updates.rating = args.rating;
    if (args.frequencyMonths !== undefined)
      updates.frequencyMonths = args.frequencyMonths;
    if (args.attachmentUrl !== undefined)
      updates.attachmentUrl = args.attachmentUrl;
    if (args.notes !== undefined) updates.notes = args.notes;

    await ctx.db.patch(args.evaluationId, updates);
    return { success: true };
  },
});

export const deleteEvaluation = mutation({
  args: { evaluationId: v.id("evaluations") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.evaluationId);
    if (!existing) throw new Error("Evaluation not found");

    await checkOrgHrAdmin(ctx, existing.organizationId);
    await ctx.db.delete(args.evaluationId);
    return { success: true };
  },
});
