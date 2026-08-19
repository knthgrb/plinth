import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { normalizeUserEmail } from "./userEmail";

/**
 * One-off / dashboard: removes userOrganizations rows whose userId has no users row.
 * Run from Convex dashboard → Functions → internal.maintenance.deleteOrphanedUserOrganizations
 * (not available from the “Custom test query” editor, which is query-only).
 */
export const deleteOrphanedUserOrganizations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const validUserIds = new Set(users.map((u) => u._id));

    const rows = await ctx.db.query("userOrganizations").collect();
    const deletedIds: Array<(typeof rows)[number]["_id"]> = [];

    for (const row of rows) {
      if (!validUserIds.has(row.userId)) {
        await ctx.db.delete(row._id);
        deletedIds.push(row._id);
      }
    }

    return { deletedCount: deletedIds.length, deletedIds };
  },
});

export const backfillNormalizedUserEmails = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("users").paginate({
      cursor: args.cursor ?? null,
      numItems: Math.max(1, Math.min(args.numItems ?? 100, 500)),
    });
    const conflicts: Array<{
      normalizedEmail: string;
      userIds: string[];
    }> = [];
    let updatedCount = 0;
    for (const user of page.page) {
      const normalizedEmail = normalizeUserEmail(user.email);
      const existingMatches = await ctx.db
        .query("users")
        .withIndex("by_normalized_email", (query) =>
          query.eq("normalizedEmail", normalizedEmail),
        )
        .take(10);
      const conflictingIds = existingMatches
        .filter((match) => match._id !== user._id)
        .map((match) => String(match._id));
      if (conflictingIds.length > 0) {
        conflicts.push({
          normalizedEmail,
          userIds: [String(user._id), ...conflictingIds],
        });
      }
      if (user.normalizedEmail !== normalizedEmail) {
        await ctx.db.patch(user._id, { normalizedEmail });
        updatedCount += 1;
      }
    }

    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      updatedCount,
      conflicts,
    };
  },
});
