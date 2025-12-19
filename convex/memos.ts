import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "admin" | "hr"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  // Check user's role in the specific organization
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
    )
    .first();

  // Fallback to legacy organizationId/role fields for backward compatibility
  let userRole: string | undefined = userOrg?.role;
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);

  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }

  // Use legacy role if userOrg doesn't exist
  if (!userRole && userRecord.organizationId === organizationId) {
    userRole = userRecord.role;
  }

  if (requiredRole && userRole !== requiredRole && userRole !== "admin") {
    throw new Error("Not authorized");
  }

  return { ...userRecord, role: userRole, organizationId };
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
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Memos is hr/admin only - restrict access
    if (userRecord.role !== "admin" && userRecord.role !== "hr") {
      throw new Error(
        "Not authorized - memos is only accessible to admin and hr"
      );
    }

    let memos = await (ctx.db.query("memos") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by published status
    if (args.isPublished !== undefined) {
      memos = memos.filter((m: any) => m.isPublished === args.isPublished);
    }

    // Filter by type
    if (args.type) {
      memos = memos.filter((m: any) => m.type === args.type);
    }

    // Filter by target audience for employees
    if (userRecord.role === "employee" && args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (employee) {
        memos = memos.filter((m: any) => {
          if (m.targetAudience === "all") return true;
          if (m.targetAudience === "department") {
            return m.departments?.includes(employee.employment.department);
          }
          if (m.targetAudience === "specific-employees") {
            return m.specificEmployees?.includes(args.employeeId!);
          }
          return false;
        });
      }
    }

    memos.sort((a: any, b: any) => b.publishedDate - a.publishedDate);
    return memos;
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

    const userRecord = await checkAuth(ctx, memo.organizationId);

    return memo;
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
      departments: args.departments,
      specificEmployees: args.specificEmployees,
      publishedDate: args.isPublished ? now : 0,
      expiryDate: args.expiryDate,
      attachments: args.attachments,
      isPublished: args.isPublished,
      acknowledgementRequired: args.acknowledgementRequired,
      createdAt: now,
      updatedAt: now,
    });

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

    const userRecord = await checkAuth(ctx, memo.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.category !== undefined) updates.category = args.category;
    if (args.type !== undefined) updates.type = args.type;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.targetAudience !== undefined)
      updates.targetAudience = args.targetAudience;
    if (args.departments !== undefined) updates.departments = args.departments;
    if (args.specificEmployees !== undefined)
      updates.specificEmployees = args.specificEmployees;
    if (args.expiryDate !== undefined) updates.expiryDate = args.expiryDate;
    if (args.attachments !== undefined) updates.attachments = args.attachments;
    if (args.acknowledgementRequired !== undefined)
      updates.acknowledgementRequired = args.acknowledgementRequired;
    if (args.isPublished !== undefined) {
      updates.isPublished = args.isPublished;
      if (args.isPublished && !memo.isPublished) {
        updates.publishedDate = Date.now();
      }
    }

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

    const userRecord = await checkAuth(ctx, memo.organizationId, "hr");

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

    const userRecord = await checkAuth(ctx, memo.organizationId);

    // Employees can only acknowledge for themselves
    if (
      userRecord.role === "employee" &&
      userRecord.employeeId !== args.employeeId
    ) {
      throw new Error("Not authorized");
    }

    const acknowledgedBy = memo.acknowledgedBy || [];

    // Check if already acknowledged
    if (acknowledgedBy.some((a: any) => a.employeeId === args.employeeId)) {
      return { success: true, alreadyAcknowledged: true };
    }

    acknowledgedBy.push({
      employeeId: args.employeeId,
      date: Date.now(),
    });

    await ctx.db.patch(args.memoId, {
      acknowledgedBy,
      updatedAt: Date.now(),
    });

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

    const userRecord = await checkAuth(ctx, memo.organizationId, "hr");

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
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    let templates = await (ctx.db.query("memoTemplates") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (args.category) {
      templates = templates.filter((t: any) => t.category === args.category);
    }

    templates.sort((a: any, b: any) => b.createdAt - a.createdAt);
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

    const userRecord = await checkAuth(ctx, template.organizationId, "hr");

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

    const userRecord = await checkAuth(ctx, template.organizationId, "hr");

    const updates: any = { updatedAt: Date.now() };
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

    const userRecord = await checkAuth(ctx, template.organizationId, "hr");

    await ctx.db.delete(args.templateId);
    return { success: true };
  },
});
