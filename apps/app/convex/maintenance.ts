import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

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
