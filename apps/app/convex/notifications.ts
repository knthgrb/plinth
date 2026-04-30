import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import type { Id } from "./_generated/dataModel";

async function checkAuth(ctx: any, organizationId: Id<"organizations">) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();
  if (!userRecord) {
    throw new Error("User record not found. Please complete your account setup.");
  }
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId),
    )
    .first();
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);
  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }
  return { ...userRecord, role: userOrg?.role ?? userRecord.role };
}

export const getUnreadNotificationCount = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const me = await checkAuth(ctx, organizationId);
    const rows = await (ctx.db.query("notifications") as any)
      .withIndex("by_user_org_unread", (q: any) =>
        q
          .eq("userId", me._id)
          .eq("organizationId", organizationId)
          .eq("read", false),
      )
      .collect();
    return { count: rows.length };
  },
});

/** Total + unread counts for tab labels (one indexed scan of user notifications). */
export const getNotificationTabCounts = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const me = await checkAuth(ctx, organizationId);
    const rows = await (ctx.db.query("notifications") as any)
      .withIndex("by_user_org_created", (q: any) =>
        q.eq("userId", me._id).eq("organizationId", organizationId),
      )
      .collect() as Array<{ read: boolean }>;
    const unread = rows.filter((r) => !r.read).length;
    return { total: rows.length, unread };
  },
});

export const listNotificationsPage = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.number(),
    /** Pass the `createdAt` of the last item to load the next (older) page. */
    cursor: v.optional(v.number()),
    /** When true, only unread — uses `by_user_org_read_created` for correct paging. */
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { organizationId, limit, cursor, unreadOnly }) => {
    const me = await checkAuth(ctx, organizationId);
    const lim = Math.min(Math.max(1, limit), 50);

    if (unreadOnly) {
      const batch = await (ctx.db.query("notifications") as any)
        .withIndex("by_user_org_read_created", (q: any) => {
          const base = q
            .eq("userId", me._id)
            .eq("organizationId", organizationId)
            .eq("read", false);
          if (cursor !== undefined) {
            return base.lt("createdAt", cursor);
          }
          return base;
        })
        .order("desc")
        .take(lim + 1);
      const hasMore = batch.length > lim;
      const items = (hasMore ? batch.slice(0, lim) : batch) as Array<{
        _id: Id<"notifications">;
        type: string;
        title: string;
        body?: string;
        read: boolean;
        createdAt: number;
        pathAfterOrg: string;
      }>;
      const nextCursor =
        hasMore && items.length > 0
          ? items[items.length - 1].createdAt
          : null;
      return { items, nextCursor, hasMore };
    }

    const batch = await (ctx.db.query("notifications") as any)
      .withIndex("by_user_org_created", (q: any) => {
        const base = q
          .eq("userId", me._id)
          .eq("organizationId", organizationId);
        if (cursor !== undefined) {
          return base.lt("createdAt", cursor);
        }
        return base;
      })
      .order("desc")
      .take(lim + 1);
    const hasMore = batch.length > lim;
    const items = (hasMore ? batch.slice(0, lim) : batch) as Array<{
      _id: Id<"notifications">;
      type: string;
      title: string;
      body?: string;
      read: boolean;
      createdAt: number;
      pathAfterOrg: string;
    }>;
    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1].createdAt : null;
    return { items, nextCursor, hasMore };
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get(notificationId);
    if (!n) throw new Error("Notification not found");
    const me = await checkAuth(ctx, (n as { organizationId: Id<"organizations"> }).organizationId);
    if (String((n as { userId: Id<"users"> }).userId) !== String(me._id)) {
      throw new Error("Not authorized");
    }
    if ((n as { read: boolean }).read) {
      return { success: true };
    }
    await ctx.db.patch(notificationId, { read: true });
    return { success: true };
  },
});

export const markAllNotificationsRead = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, { organizationId }) => {
    const me = await checkAuth(ctx, organizationId);
    const rows = await (ctx.db.query("notifications") as any)
      .withIndex("by_user_org_unread", (q: any) =>
        q
          .eq("userId", me._id)
          .eq("organizationId", organizationId)
          .eq("read", false),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.patch((row as { _id: Id<"notifications"> })._id, {
        read: true,
      });
    }
    return { updated: rows.length };
  },
});
