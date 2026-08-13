import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { runOrgQuery } from "./queryAuthGrace";
import { requireActiveMembership } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  loadEffectiveMemo,
  synchronizeEffectiveMemo,
  type MemoReaction,
} from "./communicationsCompatibility";

type AnnouncementAudience = Pick<
  Doc<"memos">,
  "organizationId" | "targetAudience" | "departments" | "specificEmployees"
>;

// Helper to check authorization - allows all authenticated users
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  return {
    _id: user._id,
    role: membership.role,
    employeeId: membership.employeeId,
    organizationId,
  };
}

async function getAnnouncementAudienceEmployeeIds(
  ctx: QueryCtx | MutationCtx,
  announcement: AnnouncementAudience,
) {
  const employees = await ctx.db
    .query("employees")
    .withIndex("by_organization", (q) =>
      q.eq("organizationId", announcement.organizationId),
    )
    .collect();

  if (announcement.targetAudience === "all") {
    return employees
      .filter((employee) => employee.employment.status === "active")
      .map((employee) => employee._id);
  }

  if (announcement.targetAudience === "department") {
    const departments = new Set(announcement.departments ?? []);
    return employees
      .filter(
        (employee) =>
          employee.employment.status === "active" &&
          departments.has(employee.employment.department),
      )
      .map((employee) => employee._id);
  }

  if (announcement.targetAudience === "specific-employees") {
    return announcement.specificEmployees ?? [];
  }

  return [];
}

function sortAnnouncementsForDisplay(a: Doc<"memos">, b: Doc<"memos">) {
  if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
    return a.isPinned ? -1 : 1;
  }
  return b.publishedDate - a.publishedDate;
}

// Get a presigned URL for an announcement attachment. Only returns a URL if the user
// is in the same org and the attachment belongs to that announcement (private to org).
export const getAnnouncementAttachmentUrl = query({
  args: {
    organizationId: v.id("organizations"),
    announcementId: v.id("memos"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId);

      const announcement = await ctx.db.get(args.announcementId);
      if (
        !announcement ||
        announcement.organizationId !== args.organizationId ||
        announcement.type !== "announcement"
      ) {
        throw new Error("Announcement not found");
      }

      const attachments = announcement.attachments || [];
      if (!attachments.includes(args.storageId)) {
        throw new Error("Attachment not found for this announcement");
      }

      return await ctx.storage.getUrl(args.storageId);
    }, null);
  },
});

// Get announcements (only type="announcement", accessible to all authenticated users).
// Reactive: Convex re-runs this when memos change (new/edit/delete, reactions), so the
// client always sees fresh data without manual cache invalidation.
export const getAnnouncements = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const userRecord = await checkAuth(ctx, args.organizationId);

      let announcements = await ctx.db
        .query("memos")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      announcements = await Promise.all(
        announcements.map((memo) => loadEffectiveMemo(ctx, memo)),
      );

      const now = Date.now();
      announcements = announcements.filter(
        (m) =>
          m.type === "announcement" &&
          m.publishedDate <= now &&
          (!m.expiryDate || m.expiryDate >= now),
      );

      if (userRecord.role === "employee") {
        const employee = userRecord.employeeId
          ? await ctx.db.get(userRecord.employeeId)
          : null;
        announcements = announcements.filter((m) => {
          if (m.targetAudience === "all") return true;
          if (m.targetAudience === "department") {
            const department = employee?.employment?.department;
            return department
              ? (m.departments?.includes(department) ?? false)
              : false;
          }
          if (m.targetAudience === "specific-employees") {
            return userRecord.employeeId
              ? (m.specificEmployees?.includes(userRecord.employeeId) ?? false)
              : false;
          }
          return false;
        });
      }

      announcements.sort(sortAnnouncementsForDisplay);
      return announcements;
    }, []);
  },
});

// Count announcements user hasn't seen yet (published after last visit) — for sidebar badge
export const getUnreadAnnouncementsCount = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const userRecord = await checkAuth(ctx, args.organizationId);

      const lastSeen = await ctx.db
        .query("announcementLastSeen")
        .withIndex("by_user_organization", (q) =>
          q.eq("userId", userRecord._id).eq("organizationId", args.organizationId),
        )
        .first();

      let announcements = await ctx.db
        .query("memos")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      announcements = await Promise.all(
        announcements.map((memo) => loadEffectiveMemo(ctx, memo)),
      );

      const now = Date.now();
      announcements = announcements.filter(
        (m) =>
          m.type === "announcement" &&
          m.publishedDate <= now &&
          (!m.expiryDate || m.expiryDate >= now),
      );

      if (userRecord.role === "employee") {
        const employee = userRecord.employeeId
          ? await ctx.db.get(userRecord.employeeId)
          : null;
        announcements = announcements.filter((m) => {
          if (m.targetAudience === "all") return true;
          if (m.targetAudience === "department") {
            const department = employee?.employment?.department;
            return department
              ? (m.departments?.includes(department) ?? false)
              : false;
          }
          if (m.targetAudience === "specific-employees") {
            return userRecord.employeeId
              ? (m.specificEmployees?.includes(userRecord.employeeId) ?? false)
              : false;
          }
          return false;
        });
      }

      const after = lastSeen?.lastSeenAt ?? 0;
      return announcements.filter((m) => m.publishedDate > after).length;
    }, 0);
  },
});

// Mark announcements as seen (call when user opens announcements page)
export const setAnnouncementsLastSeen = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    const now = Date.now();

    const existing = await ctx.db
      .query("announcementLastSeen")
      .withIndex("by_user_organization", (q) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("announcementLastSeen", {
        userId: userRecord._id,
        organizationId: args.organizationId,
        lastSeenAt: now,
        updatedAt: now,
      });
    }
    return { success: true };
  },
});

// Create announcement (admin/hr/owner only)
export const createAnnouncement = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    content: v.string(),
    priority: v.optional(
      v.union(
        v.literal("normal"),
        v.literal("important"),
        v.literal("urgent")
      )
    ),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees")
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    scheduledPublishDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    reminderCadenceDays: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    attachmentContentTypes: v.optional(v.array(v.string())),
    acknowledgementRequired: v.boolean(),
    postAs: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Only admin, hr, and owner can create announcements
    if (
      userRecord.role !== "admin" &&
      userRecord.role !== "hr" &&
      userRecord.role !== "owner"
    ) {
      throw new Error("Not authorized - admin, hr, or owner role required");
    }

    const wantsPersonalName = args.postAs === "user";
    const authorDisplayName = wantsPersonalName ? undefined : "Admin";

    const now = Date.now();
    const publishedDate = args.scheduledPublishDate ?? now;
    const audienceEmployeeIds = await getAnnouncementAudienceEmployeeIds(ctx, {
      organizationId: args.organizationId,
      targetAudience: args.targetAudience,
      departments: args.departments,
      specificEmployees: args.specificEmployees,
    });
    const announcementId = await ctx.db.insert("memos", {
      organizationId: args.organizationId,
      title: args.title,
      content: args.content,
      type: "announcement",
      priority: args.priority ?? "normal",
      author: userRecord._id,
      ...(authorDisplayName ? { authorDisplayName } : {}),
      targetAudience: args.targetAudience,
      departments: args.departments,
      specificEmployees: args.specificEmployees,
      publishedDate,
      scheduledPublishDate: args.scheduledPublishDate,
      expiryDate: args.expiryDate,
      isPinned: args.isPinned ?? false,
      reminderCadenceDays: args.reminderCadenceDays,
      audienceSnapshot: {
        count: audienceEmployeeIds.length,
        generatedAt: now,
      },
      attachments: args.attachments,
      attachmentContentTypes: args.attachmentContentTypes,
      isPublished: true,
      acknowledgementRequired: args.acknowledgementRequired,
      createdAt: now,
      updatedAt: now,
    });
    const announcement = await ctx.db.get(announcementId);
    if (!announcement) throw new Error("Announcement creation did not persist");
    await synchronizeEffectiveMemo(
      ctx,
      announcement,
      {
        specificEmployees: args.specificEmployees,
        departments: args.departments,
        attachments: args.attachments,
        attachmentContentTypes: args.attachmentContentTypes,
      },
      now,
    );

    return announcementId;
  },
});

// Update announcement (admin/hr only)
export const updateAnnouncement = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
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
    scheduledPublishDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    reminderCadenceDays: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    attachmentContentTypes: v.optional(v.array(v.string())),
    acknowledgementRequired: v.optional(v.boolean()),
    postAs: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Only admin, hr, and owner can update announcements
    if (
      userRecord.role !== "admin" &&
      userRecord.role !== "hr" &&
      userRecord.role !== "owner"
    ) {
      throw new Error("Not authorized - admin, hr, or owner role required");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    if (announcement.author !== userRecord._id) {
      throw new Error("Only the author can update this announcement");
    }

    const updateData: Partial<Doc<"memos">> = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) updateData.title = args.title;
    if (args.content !== undefined) updateData.content = args.content;
    if (args.priority !== undefined) updateData.priority = args.priority;
    if (args.targetAudience !== undefined)
      updateData.targetAudience = args.targetAudience;
    if (args.departments !== undefined)
      updateData.departments = args.departments;
    if (args.specificEmployees !== undefined)
      updateData.specificEmployees = args.specificEmployees;
    if (args.scheduledPublishDate !== undefined) {
      updateData.scheduledPublishDate = args.scheduledPublishDate;
      updateData.publishedDate = args.scheduledPublishDate;
    }
    if (args.expiryDate !== undefined) updateData.expiryDate = args.expiryDate;
    if (args.isPinned !== undefined) updateData.isPinned = args.isPinned;
    if (args.reminderCadenceDays !== undefined)
      updateData.reminderCadenceDays = args.reminderCadenceDays;
    if (args.attachments !== undefined)
      updateData.attachments = args.attachments;
    if (args.attachmentContentTypes !== undefined)
      updateData.attachmentContentTypes = args.attachmentContentTypes;
    if (args.acknowledgementRequired !== undefined)
      updateData.acknowledgementRequired = args.acknowledgementRequired;

    if (
      args.targetAudience !== undefined ||
      args.departments !== undefined ||
      args.specificEmployees !== undefined
    ) {
      const nextAnnouncement = {
        ...announcement,
        targetAudience: args.targetAudience ?? announcement.targetAudience,
        departments: args.departments ?? announcement.departments,
        specificEmployees:
          args.specificEmployees ?? announcement.specificEmployees,
      };
      const audienceEmployeeIds = await getAnnouncementAudienceEmployeeIds(
        ctx,
        nextAnnouncement,
      );
      updateData.audienceSnapshot = {
        count: audienceEmployeeIds.length,
        generatedAt: Date.now(),
      };
    }

    if (args.postAs !== undefined) {
      if (args.postAs === "user") {
        updateData.authorDisplayName = "";
      } else {
        updateData.authorDisplayName = "Admin";
      }
    }

    await synchronizeEffectiveMemo(ctx, announcement, updateData, Date.now());
    await ctx.db.patch(args.announcementId, updateData);
    return args.announcementId;
  },
});

// Delete announcement (admin/hr only)
export const deleteAnnouncement = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Only admin, hr, and owner can delete announcements
    if (
      userRecord.role !== "admin" &&
      userRecord.role !== "hr" &&
      userRecord.role !== "owner"
    ) {
      throw new Error("Not authorized - admin, hr, or owner role required");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    if (announcement.author !== userRecord._id) {
      throw new Error("Only the author can delete this announcement");
    }

    await synchronizeEffectiveMemo(
      ctx,
      announcement,
      {
        reactions: [],
        acknowledgedBy: [],
        specificEmployees: [],
        departments: [],
        attachments: [],
        attachmentContentTypes: [],
      },
      Date.now(),
    );
    await ctx.db.delete(args.announcementId);
    return args.announcementId;
  },
});

export const sendAnnouncementAcknowledgementReminders = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    if (
      userRecord.role !== "admin" &&
      userRecord.role !== "hr" &&
      userRecord.role !== "owner"
    ) {
      throw new Error("Not authorized - admin, hr, or owner role required");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }
    if (!announcement.acknowledgementRequired) {
      throw new Error("This announcement does not require acknowledgement");
    }

    const audienceEmployeeIds = await getAnnouncementAudienceEmployeeIds(
      ctx,
      announcement,
    );
    const acknowledged = new Set(
      (announcement.acknowledgedBy ?? []).map((entry) =>
        String(entry.employeeId),
      ),
    );
    const pendingEmployeeIds = audienceEmployeeIds.filter(
      (employeeId) => !acknowledged.has(String(employeeId)),
    );
    const now = Date.now();

    await ctx.db.patch(args.announcementId, {
      reminderLastSentAt: now,
      reminderLastSentBy: userRecord._id,
      audienceSnapshot: {
        count: audienceEmployeeIds.length,
        generatedAt: now,
      },
      updatedAt: now,
    });

    return {
      success: true,
      reminderCount: pendingEmployeeIds.length,
      pendingEmployeeIds,
    };
  },
});

// Add reaction to announcement (all org members: employee, accounting, hr, admin, owner)
export const addReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    // All org members can react (role already verified by checkAuth)

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    const effective = await loadEffectiveMemo(ctx, announcement);
    const reactions = (effective.reactions || []) as MemoReaction[];
    const now = Date.now();

    // Remove existing reaction from this user if any
    const filteredReactions = reactions.filter(
      (reaction) => reaction.userId !== userRecord._id,
    );

    // Add new reaction
    filteredReactions.push({
      userId: userRecord._id,
      emoji: args.emoji,
      createdAt: now,
    });

    await synchronizeEffectiveMemo(
      ctx,
      announcement,
      { reactions: filteredReactions },
      now,
    );
    await ctx.db.patch(args.announcementId, { updatedAt: now });

    return args.announcementId;
  },
});

// Remove reaction from announcement
export const removeReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    const effective = await loadEffectiveMemo(ctx, announcement);
    const reactions = (effective.reactions || []) as MemoReaction[];
    const filteredReactions = reactions.filter(
      (reaction) => reaction.userId !== userRecord._id,
    );

    const now = Date.now();
    await synchronizeEffectiveMemo(
      ctx,
      announcement,
      { reactions: filteredReactions },
      now,
    );
    await ctx.db.patch(args.announcementId, { updatedAt: now });

    return args.announcementId;
  },
});

// Get comments for an announcement (only org members can view)
export const getComments = query({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      await checkAuth(ctx, args.organizationId);

      const announcement = await ctx.db.get(args.announcementId);
      if (!announcement || announcement.organizationId !== args.organizationId) {
        return [];
      }

      const comments = await ctx.db
        .query("announcementComments")
        .withIndex("by_announcement", (q) =>
          q.eq("announcementId", args.announcementId),
        )
        .collect();

      comments.sort((a, b) => a.createdAt - b.createdAt);

      const withAuthors = await Promise.all(
        comments.map(async (comment) => {
          const author = await ctx.db.get(comment.author);
          const authorName =
            comment.authorDisplayName ??
            author?.name ??
            author?.email ??
            "Unknown";
          return {
            _id: comment._id,
            announcementId: comment.announcementId,
            organizationId: comment.organizationId,
            author: comment.author,
            authorName,
            content: comment.content,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
          };
        }),
      );

      return withAuthors;
    }, []);
  },
});

// Add comment to announcement (only org members can comment)
export const addComment = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    content: v.string(),
    commentAs: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    const contentTrimmed = args.content.trim();
    if (!contentTrimmed) throw new Error("Comment content is required");

    const isAdminOrOwnerOrHr =
      userRecord.role === "admin" ||
      userRecord.role === "hr" ||
      userRecord.role === "owner";
    const authorDisplayName =
      args.commentAs === "admin" && isAdminOrOwnerOrHr ? "Admin" : undefined;

    const now = Date.now();
    const commentId = await ctx.db.insert("announcementComments", {
      announcementId: args.announcementId,
      organizationId: args.organizationId,
      author: userRecord._id,
      ...(authorDisplayName && { authorDisplayName }),
      content: contentTrimmed,
      createdAt: now,
      updatedAt: now,
    });

    return commentId;
  },
});
