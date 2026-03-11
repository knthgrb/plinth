import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

/**
 * Set a user as super_admin. Run from Convex dashboard:
 * npx convex run demoRequests:setSuperAdmin '{"email":"you@example.com"}'
 */
export const setSuperAdmin = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!userRecord) throw new Error("User not found");

    await ctx.db.patch(userRecord._id, {
      masterRole: "super_admin",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Create a demo request (public - called from marketing API).
 */
export const create = mutation({
  args: {
    email: v.string(),
    companyName: v.optional(v.string()),
    name: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("demoRequests", {
      email: args.email,
      companyName: args.companyName,
      name: args.name,
      message: args.message,
      createdAt: now,
    });
  },
});

/**
 * Check if current user is super_admin.
 */
export const isSuperAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user?.email) return false;

    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .first();

    return (userRecord as any)?.masterRole === "super_admin";
  },
});

/**
 * List demo requests (super_admin only).
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user?.email) return null;

    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .first();

    if (!userRecord || (userRecord as any).masterRole !== "super_admin") {
      return null;
    }

    return await ctx.db
      .query("demoRequests")
      .withIndex("by_created")
      .order("desc")
      .collect();
  },
});
