import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr" | "accounting"
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

  return { ...userRecord, role: userRole, organizationId };
}

// Get all assets for an organization
export const getAssets = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    return assets;
  },
});

// Get a single asset
export const getAsset = query({
  args: {
    assetId: v.id("assets"),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Asset not found");

    await checkAuth(ctx, asset.organizationId);
    return asset;
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
    await checkAuth(ctx, args.organizationId);

    const now = Date.now();
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

    await checkAuth(ctx, asset.organizationId);

    await ctx.db.patch(args.assetId, {
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
      ...(args.status !== undefined && { status: args.status }),
      ...(args.notes !== undefined && { notes: args.notes }),
      updatedAt: Date.now(),
    });

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
