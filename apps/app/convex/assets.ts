import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { runOrgQuery } from "./queryAuthGrace";

const assetConditionValidator = v.optional(
  v.union(
    v.literal("new"),
    v.literal("good"),
    v.literal("fair"),
    v.literal("needs_repair"),
    v.literal("damaged")
  )
);

const maintenanceHistoryValidator = v.optional(
  v.array(
    v.object({
      date: v.number(),
      description: v.string(),
      cost: v.optional(v.number()),
      performedBy: v.optional(v.string()),
      nextServiceDate: v.optional(v.number()),
    })
  )
);

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr" | "accounting"
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Owner and admin have access to everything
  // For read operations, allow accounting and hr roles
  // For write operations (requiredRole specified), only allow specified role, admin, or owner
  if (requiredRole) {
    if (
      userRole !== requiredRole &&
      userRole !== "admin" &&
      userRole !== "owner"
    ) {
      throw new Error("Not authorized");
    }
  } else {
    // No required role means read access - allow owner, admin, hr, and accounting
    if (
      userRole !== "owner" &&
      userRole !== "admin" &&
      userRole !== "hr" &&
      userRole !== "accounting"
    ) {
      throw new Error("Not authorized");
    }
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

// Get all assets for an organization
export const getAssets = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId);

      const assets = await ctx.db
        .query("assets")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      return assets;
    }, []);
  },
});

// Get a single asset
export const getAsset = query({
  args: {
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const asset = await ctx.db.get(args.assetId);
      if (!asset) throw new Error("Asset not found");

      await checkAuth(ctx, asset.organizationId);
      return asset;
    }, null);
  },
});

// Create a new asset
export const createAsset = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    quantity: v.number(),
    unitPrice: v.optional(v.number()),
    totalValue: v.optional(v.number()),
    datePurchased: v.optional(v.number()),
    supplier: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    assignedEmployeeId: v.optional(v.union(v.id("employees"), v.null())),
    custodyAcknowledgedAt: v.optional(v.union(v.number(), v.null())),
    returnDueDate: v.optional(v.union(v.number(), v.null())),
    returnedAt: v.optional(v.union(v.number(), v.null())),
    condition: assetConditionValidator,
    maintenanceHistory: maintenanceHistoryValidator,
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("disposed"),
        v.literal("maintenance")
      )
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const now = Date.now();
    const assignedEmployeeId = args.assignedEmployeeId ?? undefined;
    const assetId = await ctx.db.insert("assets", {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description,
      category: args.category,
      quantity: args.quantity,
      unitPrice: args.unitPrice,
      totalValue: args.totalValue,
      datePurchased: args.datePurchased,
      supplier: args.supplier,
      serialNumber: args.serialNumber,
      location: args.location,
      assignedEmployeeId,
      assignedAt: assignedEmployeeId ? now : undefined,
      assignedBy: assignedEmployeeId ? userRecord._id : undefined,
      custodyAcknowledgedAt: args.custodyAcknowledgedAt ?? undefined,
      returnDueDate: args.returnDueDate ?? undefined,
      returnedAt: args.returnedAt ?? undefined,
      condition: args.condition,
      maintenanceHistory: args.maintenanceHistory,
      status: args.status || "active",
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    return assetId;
  },
});

// Update an asset
export const updateAsset = mutation({
  args: {
    assetId: v.id("assets"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    totalValue: v.optional(v.number()),
    datePurchased: v.optional(v.number()),
    supplier: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    assignedEmployeeId: v.optional(v.union(v.id("employees"), v.null())),
    custodyAcknowledgedAt: v.optional(v.union(v.number(), v.null())),
    returnDueDate: v.optional(v.union(v.number(), v.null())),
    returnedAt: v.optional(v.union(v.number(), v.null())),
    condition: assetConditionValidator,
    maintenanceHistory: maintenanceHistoryValidator,
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("disposed"),
        v.literal("maintenance")
      )
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    const userRecord = await checkAuth(ctx, asset.organizationId);

    const now = Date.now();
    const updates: any = {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.description !== undefined && { description: args.description }),
      ...(args.category !== undefined && { category: args.category }),
      ...(args.quantity !== undefined && { quantity: args.quantity }),
      ...(args.unitPrice !== undefined && { unitPrice: args.unitPrice }),
      ...(args.totalValue !== undefined && { totalValue: args.totalValue }),
      ...(args.datePurchased !== undefined && {
        datePurchased: args.datePurchased,
      }),
      ...(args.supplier !== undefined && { supplier: args.supplier }),
      ...(args.serialNumber !== undefined && {
        serialNumber: args.serialNumber,
      }),
      ...(args.location !== undefined && { location: args.location }),
      ...(args.custodyAcknowledgedAt !== undefined && {
        custodyAcknowledgedAt: args.custodyAcknowledgedAt ?? undefined,
      }),
      ...(args.returnDueDate !== undefined && {
        returnDueDate: args.returnDueDate ?? undefined,
      }),
      ...(args.returnedAt !== undefined && {
        returnedAt: args.returnedAt ?? undefined,
      }),
      ...(args.condition !== undefined && { condition: args.condition }),
      ...(args.maintenanceHistory !== undefined && {
        maintenanceHistory: args.maintenanceHistory,
      }),
      ...(args.status !== undefined && { status: args.status }),
      ...(args.notes !== undefined && { notes: args.notes }),
      updatedAt: now,
    };

    if (args.assignedEmployeeId !== undefined) {
      const assignedEmployeeId = args.assignedEmployeeId ?? undefined;
      updates.assignedEmployeeId = assignedEmployeeId;
      updates.assignedAt = assignedEmployeeId ? now : undefined;
      updates.assignedBy = assignedEmployeeId ? userRecord._id : undefined;
      if (!assignedEmployeeId && args.custodyAcknowledgedAt === undefined) {
        updates.custodyAcknowledgedAt = undefined;
      }
    }

    await ctx.db.patch(args.assetId, updates);

    return { success: true };
  },
});

// Delete an asset
export const deleteAsset = mutation({
  args: {
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    await checkAuth(ctx, asset.organizationId);

    await ctx.db.delete(args.assetId);
    return { success: true };
  },
});
