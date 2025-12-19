import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Create or update user record after Better Auth signup
export const syncUser = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("hr"),
        v.literal("employee"),
        v.literal("accounting")
      )
    ),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), args.email))
      .first();

    const now = Date.now();

    if (existingUser) {
      // Update existing user
      const updates: any = { updatedAt: now };
      if (args.name !== undefined) updates.name = args.name;
      if (args.organizationId !== undefined)
        updates.organizationId = args.organizationId;
      if (args.role !== undefined) updates.role = args.role;

      await ctx.db.patch(existingUser._id, updates);
      return existingUser._id;
    } else {
      // Create new user record
      // Note: organizationId and role are required in schema, but we'll make them optional for initial signup
      const userId = await ctx.db.insert("users", {
        email: args.email,
        name: args.name,
        organizationId:
          args.organizationId ||
          (await ctx.db.query("organizations").first())?._id ||
          (await ctx.db.insert("organizations", {
            name: "Default Organization",
            createdAt: now,
            updatedAt: now,
          })),
        role: args.role || "employee",
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    }
  },
});
