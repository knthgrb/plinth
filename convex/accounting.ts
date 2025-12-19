import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization - only accounting role or admin
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "accounting"
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

  // Only allow accounting role or admin
  const allowedRoles = ["admin", "accounting"];
  if (requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }

  // For read operations, also allow accounting role
  if (!requiredRole && !allowedRoles.includes(userRole || "")) {
    throw new Error("Not authorized - accounting role required");
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Get all cost categories for an organization
export const getCostCategories = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);
    return await ctx.db
      .query("accountingCategories")
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
  },
});

// Get cost items for a category
export const getCostItems = query({
  args: {
    organizationId: v.id("organizations"),
    categoryId: v.optional(v.id("accountingCategories")),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);
    if (args.categoryId) {
      return await ctx.db
        .query("accountingCostItems")
        .withIndex("by_category", (q: any) =>
          q.eq("categoryId", args.categoryId)
        )
        .collect();
    }
    return await ctx.db
      .query("accountingCostItems")
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
  },
});

// Create cost category
export const createCostCategory = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "accounting");
    const now = Date.now();
    return await ctx.db.insert("accountingCategories", {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update cost category
export const updateCostCategory = mutation({
  args: {
    categoryId: v.id("accountingCategories"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    await checkAuth(ctx, category.organizationId, "accounting");

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.categoryId, updates);
  },
});

// Delete cost category
export const deleteCostCategory = mutation({
  args: {
    categoryId: v.id("accountingCategories"),
  },
  handler: async (ctx, args) => {
    const category = await ctx.db.get(args.categoryId);
    if (!category) throw new Error("Category not found");
    await checkAuth(ctx, category.organizationId, "accounting");

    // Check if there are any cost items in this category
    const items = await ctx.db
      .query("accountingCostItems")
      .withIndex("by_category", (q: any) => q.eq("categoryId", args.categoryId))
      .collect();

    if (items.length > 0) {
      throw new Error("Cannot delete category with existing cost items");
    }

    await ctx.db.delete(args.categoryId);
  },
});

// Create cost item
export const createCostItem = mutation({
  args: {
    organizationId: v.id("organizations"),
    categoryId: v.id("accountingCategories"),
    name: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    amountPaid: v.optional(v.number()),
    frequency: v.union(
      v.literal("one-time"),
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("yearly")
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue")
      )
    ),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    receipts: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "accounting");
    const now = Date.now();

    // Determine status if not provided
    let status = args.status;
    if (!status) {
      const amountPaid = args.amountPaid || 0;
      if (amountPaid === 0) {
        status = "pending";
      } else if (amountPaid >= args.amount) {
        status = "paid";
      } else {
        status = "partial";
      }
    }

    // Check if overdue
    if (args.dueDate && args.dueDate < now && status !== "paid") {
      status = "overdue";
    }

    return await ctx.db.insert("accountingCostItems", {
      organizationId: args.organizationId,
      categoryId: args.categoryId,
      name: args.name,
      description: args.description,
      amount: args.amount,
      amountPaid: args.amountPaid || 0,
      frequency: args.frequency,
      status,
      dueDate: args.dueDate,
      notes: args.notes,
      receipts: args.receipts,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update cost item
export const updateCostItem = mutation({
  args: {
    itemId: v.id("accountingCostItems"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    amount: v.optional(v.number()),
    amountPaid: v.optional(v.number()),
    frequency: v.optional(
      v.union(
        v.literal("one-time"),
        v.literal("daily"),
        v.literal("weekly"),
        v.literal("monthly"),
        v.literal("yearly")
      )
    ),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("partial"),
        v.literal("paid"),
        v.literal("overdue")
      )
    ),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    receipts: v.optional(v.array(v.id("_storage"))),
    categoryId: v.optional(v.id("accountingCategories")),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Cost item not found");
    await checkAuth(ctx, item.organizationId, "accounting");

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.amount !== undefined) updates.amount = args.amount;
    if (args.amountPaid !== undefined) updates.amountPaid = args.amountPaid;
    if (args.frequency !== undefined) updates.frequency = args.frequency;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.receipts !== undefined) updates.receipts = args.receipts;
    if (args.categoryId !== undefined) updates.categoryId = args.categoryId;

    // Auto-update status based on amountPaid if status not explicitly set
    if (args.status !== undefined) {
      updates.status = args.status;
    } else if (args.amountPaid !== undefined || args.amount !== undefined) {
      const amountPaid =
        args.amountPaid !== undefined ? args.amountPaid : item.amountPaid;
      const amount = args.amount !== undefined ? args.amount : item.amount;

      if (amountPaid === 0) {
        updates.status = "pending";
      } else if (amountPaid >= amount) {
        updates.status = "paid";
      } else {
        updates.status = "partial";
      }

      // Check if overdue
      const dueDate = args.dueDate !== undefined ? args.dueDate : item.dueDate;
      if (dueDate && dueDate < Date.now() && updates.status !== "paid") {
        updates.status = "overdue";
      }
    } else if (args.dueDate !== undefined) {
      // Check if overdue when dueDate changes
      const amountPaid = item.amountPaid;
      const amount = item.amount;
      const currentStatus = item.status;

      if (args.dueDate < Date.now() && currentStatus !== "paid") {
        if (amountPaid === 0) {
          updates.status = "overdue";
        } else if (amountPaid < amount) {
          updates.status = "overdue";
        }
      }
    }

    await ctx.db.patch(args.itemId, updates);

    // If this is a payroll expense and now paid, sync payroll status
    const finalStatus = updates.status ?? item.status;
    if (finalStatus === "paid" && item.name.startsWith("Payroll - ")) {
      const now = Date.now();
      const periodStr = item.name.replace("Payroll - ", "");
      const payrollRuns = await (ctx.db.query("payrollRuns") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", item.organizationId)
        )
        .collect();
      const matched = payrollRuns.find((pr: any) => pr.period === periodStr);
      if (matched && matched.status !== "paid") {
        await ctx.db.patch(matched._id, {
          status: "paid",
          updatedAt: now,
        });
      }
    }
  },
});

// Delete cost item
export const deleteCostItem = mutation({
  args: {
    itemId: v.id("accountingCostItems"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Cost item not found");
    await checkAuth(ctx, item.organizationId, "accounting");

    await ctx.db.delete(args.itemId);
  },
});
