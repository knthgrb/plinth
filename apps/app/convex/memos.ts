import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { isOrgQueryAuthGraceError } from "./queryAuthGrace";
import {
  loadEffectiveMemo,
  synchronizeEffectiveMemo,
} from "./communicationsCompatibility";

function rejectAnnouncementWrite(memo: Doc<"memos">): void {
  if (memo.type === "announcement") {
    throw new Error("Use the announcements module for announcement writes");
  }
}

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr"
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  if (
    requiredRole &&
    userRole !== requiredRole &&
    userRole !== "admin" &&
    userRole !== "owner"
  ) {
    throw new Error("Not authorized");
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

async function checkAuthForQuery(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  try {
    return await checkAuth(ctx, organizationId, requiredRole);
  } catch (e) {
    if (isOrgQueryAuthGraceError(e)) return null;
    throw e;
  }
}

// Get memos
export const getMemos = query({
  args: {
    organizationId: v.id("organizations"),
    isPublished: v.optional(v.boolean()),
    type: v.optional(
      v.union(
        v.literal("announcement"),
        v.literal("policy"),
        v.literal("directive"),
        v.literal("notice"),
        v.literal("other")
      )
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    // Memos is hr/admin only - restrict access
    if (userRecord.role !== "admin" && userRecord.role !== "hr") {
      throw new Error(
        "Not authorized - memos is only accessible to admin and hr"
      );
    }

    let memos = await ctx.db
      .query("memos")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by published status
    if (args.isPublished !== undefined) {
      memos = memos.filter((m) => m.isPublished === args.isPublished);
    }

    // Filter by type
    if (args.type) {
      memos = memos.filter((m) => m.type === args.type);
    }

    memos.sort((a, b) => b.publishedDate - a.publishedDate);
    return Promise.all(
      memos.map((memo: Doc<"memos">) => loadEffectiveMemo(ctx, memo)),
    );
  },
});

// Get single memo
export const getMemo = query({
  args: {
    memoId: v.id("memos"),
  },
  handler: async (ctx, args) => {
    const memo = await ctx.db.get(args.memoId);
    if (!memo) throw new Error("Memo not found");

    const userRecord = await checkAuthForQuery(ctx, memo.organizationId);
    if (!userRecord) return null;

    return loadEffectiveMemo(ctx, memo);
  },
});

// Create memo
export const createMemo = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    content: v.string(), // Rich text JSON
    category: v.optional(
      v.union(
        v.literal("disciplinary"),
        v.literal("holidays"),
        v.literal("company-policies")
      )
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other")
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent")
    ),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees")
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    expiryDate: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    acknowledgementRequired: v.boolean(),
    isPublished: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");
    if (args.type === "announcement") {
      throw new Error("Use the announcements module for announcement writes");
    }

    const now = Date.now();
    const memoId = await ctx.db.insert("memos", {
      organizationId: args.organizationId,
      title: args.title,
      content: args.content,
      category: args.category,
      type: args.type,
      priority: args.priority,
      author: userRecord._id,
      targetAudience: args.targetAudience,
      publishedDate: args.isPublished ? now : 0,
      expiryDate: args.expiryDate,
      isPublished: args.isPublished,
      acknowledgementRequired: args.acknowledgementRequired,
      createdAt: now,
      updatedAt: now,
    });
    const memo = await ctx.db.get(memoId);
    if (!memo) throw new Error("Memo creation did not persist");
    await synchronizeEffectiveMemo(
      ctx,
      memo,
      {
        specificEmployees: args.specificEmployees,
        departments: args.departments,
        attachments: args.attachments,
      },
      now,
    );

    return memoId;
  },
});

// Update memo
export const updateMemo = mutation({
  args: {
    memoId: v.id("memos"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("disciplinary"),
        v.literal("holidays"),
        v.literal("company-policies")
      )
    ),
    type: v.optional(
      v.union(
        v.literal("announcement"),
        v.literal("policy"),
        v.literal("directive"),
        v.literal("notice"),
        v.literal("other")
      )
    ),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("important"), v.literal("urgent"))
    ),
    targetAudience: v.optional(
      v.union(
        v.literal("all"),
        v.literal("department"),
        v.literal("specific-employees")
      )
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    expiryDate: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    acknowledgementRequired: v.optional(v.boolean()),
    isPublished: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const memo = await ctx.db.get(args.memoId);
    if (!memo) throw new Error("Memo not found");
    rejectAnnouncementWrite(memo);
    if (args.type === "announcement") {
      throw new Error("Use the announcements module for announcement writes");
    }

    await checkAuth(ctx, memo.organizationId, "hr");

    const updates: Partial<Doc<"memos">> = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.category !== undefined) updates.category = args.category;
    if (args.type !== undefined) updates.type = args.type;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.targetAudience !== undefined)
      updates.targetAudience = args.targetAudience;
    if (args.expiryDate !== undefined) updates.expiryDate = args.expiryDate;
    if (args.acknowledgementRequired !== undefined)
      updates.acknowledgementRequired = args.acknowledgementRequired;
    if (args.isPublished !== undefined) {
      updates.isPublished = args.isPublished;
      if (args.isPublished && !memo.isPublished) {
        updates.publishedDate = Date.now();
      }
    }

    await synchronizeEffectiveMemo(
      ctx,
      memo,
      {
        departments: args.departments,
        specificEmployees: args.specificEmployees,
        attachments: args.attachments,
      },
      Date.now(),
    );
    await ctx.db.patch(args.memoId, updates);
    return { success: true };
  },
});

// Publish memo
export const publishMemo = mutation({
  args: {
    memoId: v.id("memos"),
  },
  handler: async (ctx, args) => {
    const memo = await ctx.db.get(args.memoId);
    if (!memo) throw new Error("Memo not found");
    rejectAnnouncementWrite(memo);

    await checkAuth(ctx, memo.organizationId, "hr");

    await ctx.db.patch(args.memoId, {
      isPublished: true,
      publishedDate: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Acknowledge memo
export const acknowledgeMemo = mutation({
  args: {
    memoId: v.id("memos"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    const memo = await ctx.db.get(args.memoId);
    if (!memo) throw new Error("Memo not found");
    rejectAnnouncementWrite(memo);

    const userRecord = await checkAuth(ctx, memo.organizationId);

    // Employees can only acknowledge for themselves
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const effective = await loadEffectiveMemo(ctx, memo);
    const acknowledgedBy = effective.acknowledgedBy || [];

    // Check if already acknowledged
    if (acknowledgedBy.some((entry) => entry.employeeId === args.employeeId)) {
      return { success: true, alreadyAcknowledged: true };
    }

    const now = Date.now();
    acknowledgedBy.push({
      employeeId: args.employeeId,
      date: now,
    });

    await synchronizeEffectiveMemo(ctx, memo, { acknowledgedBy }, now);
    await ctx.db.patch(args.memoId, { updatedAt: now });

    return { success: true };
  },
});

// Delete memo
export const deleteMemo = mutation({
  args: {
    memoId: v.id("memos"),
  },
  handler: async (ctx, args) => {
    const memo = await ctx.db.get(args.memoId);
    if (!memo) throw new Error("Memo not found");
    rejectAnnouncementWrite(memo);

    await checkAuth(ctx, memo.organizationId, "hr");

    await synchronizeEffectiveMemo(
      ctx,
      memo,
      {
        reactions: [],
        acknowledgedBy: [],
        specificEmployees: [],
        departments: [],
        attachments: [],
        attachmentContentTypes: [],
      },
      Date.now(),
    );
    await ctx.db.delete(args.memoId);
    return { success: true };
  },
});

// ========== MEMO TEMPLATES ==========

// Get memo templates
export const getMemoTemplates = query({
  args: {
    organizationId: v.id("organizations"),
    category: v.optional(
      v.union(
        v.literal("disciplinary"),
        v.literal("holidays"),
        v.literal("company-policies")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId, "hr");
    if (!userRecord) return [];

    let templates = await ctx.db
      .query("memoTemplates")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (args.category) {
      templates = templates.filter((template) => template.category === args.category);
    }

    templates.sort((a, b) => b.createdAt - a.createdAt);
    return templates;
  },
});

// Get single memo template
export const getMemoTemplate = query({
  args: {
    templateId: v.id("memoTemplates"),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    const userRecord = await checkAuthForQuery(ctx, template.organizationId, "hr");
    if (!userRecord) return null;

    return template;
  },
});

// Create memo template
export const createMemoTemplate = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    title: v.string(),
    content: v.string(), // Rich text JSON (Tiptap)
    category: v.union(
      v.literal("disciplinary"),
      v.literal("holidays"),
      v.literal("company-policies")
    ),
    type: v.union(
      v.literal("announcement"),
      v.literal("policy"),
      v.literal("directive"),
      v.literal("notice"),
      v.literal("other")
    ),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent")
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();
    const templateId = await ctx.db.insert("memoTemplates", {
      organizationId: args.organizationId,
      name: args.name,
      title: args.title,
      content: args.content,
      category: args.category,
      type: args.type,
      priority: args.priority,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

    return templateId;
  },
});

// Update memo template
export const updateMemoTemplate = mutation({
  args: {
    templateId: v.id("memoTemplates"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("disciplinary"),
        v.literal("holidays"),
        v.literal("company-policies")
      )
    ),
    type: v.optional(
      v.union(
        v.literal("announcement"),
        v.literal("policy"),
        v.literal("directive"),
        v.literal("notice"),
        v.literal("other")
      )
    ),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("important"), v.literal("urgent"))
    ),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    await checkAuth(ctx, template.organizationId, "hr");

    const updates: Partial<Doc<"memoTemplates">> = {
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) updates.name = args.name;
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.category !== undefined) updates.category = args.category;
    if (args.type !== undefined) updates.type = args.type;
    if (args.priority !== undefined) updates.priority = args.priority;

    await ctx.db.patch(args.templateId, updates);
    return { success: true };
  },
});

// Delete memo template
export const deleteMemoTemplate = mutation({
  args: {
    templateId: v.id("memoTemplates"),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    await checkAuth(ctx, template.organizationId, "hr");

    await ctx.db.delete(args.templateId);
    return { success: true };
  },
});
