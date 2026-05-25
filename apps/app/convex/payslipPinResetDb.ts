import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const insertReset = internalMutation({
  args: {
    employeeId: v.id("employees"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("payslipPinResets", {
      employeeId: args.employeeId,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
    return { success: true };
  },
});

export const getResetByTokenHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const reset = await ctx.db
      .query("payslipPinResets")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .first();
    return reset ?? null;
  },
});

export const markResetUsed = internalMutation({
  args: { resetId: v.id("payslipPinResets") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resetId, { usedAt: Date.now() });
    return { success: true };
  },
});
