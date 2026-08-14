import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireActiveMembership } from "./access";
import {
  loadEffectiveMemo,
  synchronizeEffectiveMemo,
  type EffectiveMemo,
} from "./communicationsCompatibility";
import { runOrgQuery } from "./queryAuthGrace";

type DatabaseContext = QueryCtx | MutationCtx;
type AnnouncementPersona = "admin" | "employee" | "member";
type AnnouncementViewer = {
  _id: Id<"users">;
  role: Doc<"userOrganizations">["role"];
  employeeId?: Id<"employees">;
  organizationId: Id<"organizations">;
};
type AnnouncementAudience = {
  organizationId: Id<"organizations">;
  targetAudience: Doc<"memos">["targetAudience"];
  departments: string[];
  specificEmployees: Id<"employees">[];
};

const MANAGEMENT_ROLES = new Set<Doc<"userOrganizations">["role"]>([
  "owner",
  "admin",
  "hr",
]);
const REACTION_EMOJIS = new Set(["👍", "😮", "❤️", "😊", "👏", "🎉"]);

function canManageAnnouncements(
  role: Doc<"userOrganizations">["role"],
): boolean {
  return MANAGEMENT_ROLES.has(role);
}

async function checkAuth(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<AnnouncementViewer> {
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

function requireAnnouncementManager(viewer: AnnouncementViewer): void {
  if (!canManageAnnouncements(viewer.role)) {
    throw new Error("Not authorized - owner, admin, or HR role required");
  }
}

async function getActiveLinkedEmployee(
  ctx: DatabaseContext,
  viewer: AnnouncementViewer,
): Promise<Doc<"employees"> | null> {
  if (!viewer.employeeId) return null;
  const employee = await ctx.db.get(viewer.employeeId);
  if (
    !employee ||
    employee.organizationId !== viewer.organizationId ||
    employee.archivedAt ||
    employee.employment.status !== "active"
  ) {
    return null;
  }
  return employee;
}

function getEmployeeName(employee: Doc<"employees">): string {
  return `${employee.personalInfo.firstName} ${employee.personalInfo.lastName}`.trim();
}

async function resolveManagerPersona(
  ctx: DatabaseContext,
  viewer: AnnouncementViewer,
  requestedPersona: "admin" | "employee" | undefined,
): Promise<{
  authorPersona: "admin" | "employee";
  authorDisplayName: string;
  authorEmployeeId?: Id<"employees">;
}> {
  if (requestedPersona !== "employee") {
    return { authorPersona: "admin", authorDisplayName: "Admin" };
  }

  const employee = await getActiveLinkedEmployee(ctx, viewer);
  if (!employee) {
    throw new Error("A linked active employee record is required");
  }
  return {
    authorPersona: "employee",
    authorDisplayName: getEmployeeName(employee),
    authorEmployeeId: employee._id,
  };
}

async function resolveCommentPersona(
  ctx: DatabaseContext,
  viewer: AnnouncementViewer,
  requestedPersona: "admin" | "employee" | undefined,
): Promise<{
  authorPersona: AnnouncementPersona;
  authorDisplayName: string;
  authorEmployeeId?: Id<"employees">;
}> {
  if (canManageAnnouncements(viewer.role)) {
    return resolveManagerPersona(ctx, viewer, requestedPersona);
  }

  const employee = await getActiveLinkedEmployee(ctx, viewer);
  if (employee) {
    return {
      authorPersona: "employee",
      authorDisplayName: getEmployeeName(employee),
      authorEmployeeId: employee._id,
    };
  }

  const user = await ctx.db.get(viewer._id);
  return {
    authorPersona: "member",
    authorDisplayName: user?.name?.trim() || user?.email || "Former member",
  };
}

async function normalizeAudience(
  ctx: DatabaseContext,
  audience: AnnouncementAudience,
): Promise<Pick<AnnouncementAudience, "departments" | "specificEmployees">> {
  if (audience.targetAudience === "all") {
    return { departments: [], specificEmployees: [] };
  }

  if (audience.targetAudience === "department") {
    const departments = Array.from(
      new Set(audience.departments.map((department) => department.trim())),
    ).filter(Boolean);
    if (departments.length === 0) {
      throw new Error("Select at least one department");
    }
    return { departments, specificEmployees: [] };
  }

  const specificEmployees = Array.from(new Set(audience.specificEmployees));
  if (specificEmployees.length === 0) {
    throw new Error("Select at least one employee");
  }
  for (const employeeId of specificEmployees) {
    const employee = await ctx.db.get(employeeId);
    if (
      !employee ||
      employee.organizationId !== audience.organizationId ||
      employee.archivedAt ||
      employee.employment.status !== "active"
    ) {
      throw new Error("Target employees must be active in this organization");
    }
  }
  return { departments: [], specificEmployees };
}

function normalizeAttachmentContentTypes(
  attachments: Id<"_storage">[],
  contentTypes: string[] | undefined,
  existing?: Pick<
    EffectiveMemo,
    "attachments" | "attachmentContentTypes"
  >,
): string[] {
  if (contentTypes && contentTypes.length !== attachments.length) {
    throw new Error("Attachment metadata does not match the selected files");
  }
  if (contentTypes) return contentTypes;
  return attachments.map((storageId) => {
    const existingIndex = existing?.attachments.indexOf(storageId) ?? -1;
    return existingIndex >= 0
      ? (existing?.attachmentContentTypes[existingIndex] ??
          "application/octet-stream")
      : "application/octet-stream";
  });
}

async function getAnnouncementAudienceEmployeeIds(
  ctx: DatabaseContext,
  announcement: AnnouncementAudience,
): Promise<Id<"employees">[]> {
  const employees = await ctx.db
    .query("employees")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", announcement.organizationId),
    )
    .collect();
  const activeEmployees = employees.filter(
    (employee) =>
      !employee.archivedAt && employee.employment.status === "active",
  );

  if (announcement.targetAudience === "all") {
    return activeEmployees.map((employee) => employee._id);
  }
  if (announcement.targetAudience === "department") {
    const departments = new Set(announcement.departments);
    return activeEmployees
      .filter((employee) => departments.has(employee.employment.department))
      .map((employee) => employee._id);
  }
  const selectedEmployees = new Set(announcement.specificEmployees);
  return activeEmployees
    .filter((employee) => selectedEmployees.has(employee._id))
    .map((employee) => employee._id);
}

async function canViewerAccessAnnouncement(
  ctx: DatabaseContext,
  announcement: EffectiveMemo,
  viewer: AnnouncementViewer,
  includeScheduled: boolean,
): Promise<boolean> {
  const hasPublished =
    announcement.isPublished && announcement.publishedDate <= Date.now();
  if (!hasPublished) {
    return includeScheduled && canManageAnnouncements(viewer.role);
  }
  if (canManageAnnouncements(viewer.role)) return true;
  if (announcement.targetAudience === "all") return true;

  const employee = await getActiveLinkedEmployee(ctx, viewer);
  if (!employee) return false;
  if (announcement.targetAudience === "department") {
    return announcement.departments.includes(employee.employment.department);
  }
  return announcement.specificEmployees.includes(employee._id);
}

async function getMemoAuthorPresentation(
  ctx: DatabaseContext,
  announcement: EffectiveMemo,
): Promise<{ authorName: string; authorPersona: AnnouncementPersona }> {
  if (
    announcement.authorPersona === "admin" ||
    announcement.authorDisplayName === "Admin"
  ) {
    return { authorName: "Admin", authorPersona: "admin" };
  }
  if (announcement.authorEmployeeId) {
    const employee = await ctx.db.get(announcement.authorEmployeeId);
    if (employee?.organizationId === announcement.organizationId) {
      return {
        authorName: getEmployeeName(employee),
        authorPersona: "employee",
      };
    }
  }

  const membership = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (builder) =>
      builder
        .eq("userId", announcement.author)
        .eq("organizationId", announcement.organizationId),
    )
    .unique();
  if (membership?.employeeId) {
    const employee = await ctx.db.get(membership.employeeId);
    if (employee?.organizationId === announcement.organizationId) {
      return {
        authorName: getEmployeeName(employee),
        authorPersona: "employee",
      };
    }
  }

  const author = await ctx.db.get(announcement.author);
  return {
    authorName:
      announcement.authorDisplayName?.trim() ||
      author?.name?.trim() ||
      author?.email ||
      "Former member",
    authorPersona: "member",
  };
}

async function decorateAnnouncement(
  ctx: DatabaseContext,
  announcement: EffectiveMemo,
) {
  const author = await getMemoAuthorPresentation(ctx, announcement);
  return {
    ...announcement,
    ...author,
    publicationStatus:
      announcement.isPublished && announcement.publishedDate <= Date.now()
        ? ("published" as const)
        : ("scheduled" as const),
  };
}

function sortAnnouncementsForDisplay(
  left: EffectiveMemo,
  right: EffectiveMemo,
): number {
  return right.publishedDate - left.publishedDate;
}

async function loadVisibleAnnouncements(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  viewer: AnnouncementViewer,
  includeScheduled: boolean,
) {
  const rawMemos = await ctx.db
    .query("memos")
    .withIndex("by_organization", (builder) =>
      builder.eq("organizationId", organizationId),
    )
    .collect();
  const announcements: EffectiveMemo[] = [];
  for (const memo of rawMemos) {
    if (memo.type !== "announcement") continue;
    const announcement = await loadEffectiveMemo(ctx, memo);
    if (
      await canViewerAccessAnnouncement(
        ctx,
        announcement,
        viewer,
        includeScheduled,
      )
    ) {
      announcements.push(announcement);
    }
  }
  announcements.sort(sortAnnouncementsForDisplay);
  return Promise.all(
    announcements.map((announcement) =>
      decorateAnnouncement(ctx, announcement),
    ),
  );
}

async function requireVisibleAnnouncement(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
  announcementId: Id<"memos">,
  viewer: AnnouncementViewer,
): Promise<EffectiveMemo> {
  const memo = await ctx.db.get(announcementId);
  if (
    !memo ||
    memo.organizationId !== organizationId ||
    memo.type !== "announcement"
  ) {
    throw new Error("Announcement not found");
  }
  const announcement = await loadEffectiveMemo(ctx, memo);
  if (
    !(await canViewerAccessAnnouncement(
      ctx,
      announcement,
      viewer,
      true,
    ))
  ) {
    throw new Error("Announcement not found");
  }
  return announcement;
}

export const getAnnouncementAttachmentUrl = query({
  args: {
    organizationId: v.id("organizations"),
    announcementId: v.id("memos"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) =>
    runOrgQuery(async () => {
      const viewer = await checkAuth(ctx, args.organizationId);
      const announcement = await requireVisibleAnnouncement(
        ctx,
        args.organizationId,
        args.announcementId,
        viewer,
      );
      if (!announcement.attachments.includes(args.storageId)) {
        throw new Error("Attachment not found for this announcement");
      }
      return ctx.storage.getUrl(args.storageId);
    }, null),
});

export const getAnnouncements = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
    includeScheduled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) =>
    runOrgQuery(async () => {
      const viewer = await checkAuth(ctx, args.organizationId);
      return loadVisibleAnnouncements(
        ctx,
        args.organizationId,
        viewer,
        args.includeScheduled === true,
      );
    }, []),
});

export const getUnreadAnnouncementsCount = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) =>
    runOrgQuery(async () => {
      const viewer = await checkAuth(ctx, args.organizationId);
      const lastSeen = await ctx.db
        .query("announcementLastSeen")
        .withIndex("by_user_organization", (builder) =>
          builder
            .eq("userId", viewer._id)
            .eq("organizationId", args.organizationId),
        )
        .first();
      const announcements = await loadVisibleAnnouncements(
        ctx,
        args.organizationId,
        viewer,
        false,
      );
      const lastSeenAt = lastSeen?.lastSeenAt ?? 0;
      return announcements.filter(
        (announcement) => announcement.publishedDate > lastSeenAt,
      ).length;
    }, 0),
});

export const setAnnouncementsLastSeen = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const viewer = await checkAuth(ctx, args.organizationId);
    const now = Date.now();
    const existing = await ctx.db
      .query("announcementLastSeen")
      .withIndex("by_user_organization", (builder) =>
        builder
          .eq("userId", viewer._id)
          .eq("organizationId", args.organizationId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("announcementLastSeen", {
        userId: viewer._id,
        organizationId: args.organizationId,
        lastSeenAt: now,
        updatedAt: now,
      });
    }
    return { success: true };
  },
});

export const publishScheduledAnnouncement = internalMutation({
  args: {
    announcementId: v.id("memos"),
    scheduledPublishDate: v.number(),
  },
  handler: async (ctx, args) => {
    const announcement = await ctx.db.get(args.announcementId);
    if (
      !announcement ||
      announcement.type !== "announcement" ||
      announcement.isPublished ||
      announcement.scheduledPublishDate !== args.scheduledPublishDate
    ) {
      return { published: false };
    }
    await ctx.db.patch(args.announcementId, {
      isPublished: true,
      publishedDate: args.scheduledPublishDate,
      updatedAt: Date.now(),
    });
    return { published: true };
  },
});

export const createAnnouncement = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    content: v.string(),
    priority: v.optional(
      v.union(
        v.literal("normal"),
        v.literal("important"),
        v.literal("urgent"),
      ),
    ),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees"),
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    scheduledPublishDate: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    attachmentContentTypes: v.optional(v.array(v.string())),
    postAs: v.optional(
      v.union(v.literal("admin"), v.literal("employee")),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await checkAuth(ctx, args.organizationId);
    requireAnnouncementManager(viewer);
    const title = args.title.trim();
    if (!title) throw new Error("Announcement title is required");
    if (!args.content.trim()) throw new Error("Announcement content is required");

    const audience = await normalizeAudience(ctx, {
      organizationId: args.organizationId,
      targetAudience: args.targetAudience,
      departments: args.departments ?? [],
      specificEmployees: args.specificEmployees ?? [],
    });
    const persona = await resolveManagerPersona(ctx, viewer, args.postAs);
    const now = Date.now();
    const isScheduled =
      args.scheduledPublishDate !== undefined &&
      args.scheduledPublishDate > now;
    const publishedDate = isScheduled ? args.scheduledPublishDate! : now;
    const audienceEmployeeIds = await getAnnouncementAudienceEmployeeIds(ctx, {
      organizationId: args.organizationId,
      targetAudience: args.targetAudience,
      ...audience,
    });
    const attachments = args.attachments ?? [];
    const attachmentContentTypes = normalizeAttachmentContentTypes(
      attachments,
      args.attachmentContentTypes,
    );
    const announcementId = await ctx.db.insert("memos", {
      organizationId: args.organizationId,
      title,
      content: args.content,
      type: "announcement",
      priority: args.priority ?? "normal",
      author: viewer._id,
      ...persona,
      targetAudience: args.targetAudience,
      publishedDate,
      ...(isScheduled
        ? { scheduledPublishDate: args.scheduledPublishDate }
        : {}),
      audienceSnapshot: {
        count: audienceEmployeeIds.length,
        generatedAt: now,
      },
      isPublished: !isScheduled,
      createdAt: now,
      updatedAt: now,
    });
    const announcement = await ctx.db.get(announcementId);
    if (!announcement) throw new Error("Announcement creation did not persist");
    await synchronizeEffectiveMemo(
      ctx,
      announcement,
      {
        departments: audience.departments,
        specificEmployees: audience.specificEmployees,
        attachments,
        attachmentContentTypes,
      },
      now,
    );
    if (isScheduled) {
      await ctx.scheduler.runAt(
        publishedDate,
        internal.announcements.publishScheduledAnnouncement,
        { announcementId, scheduledPublishDate: publishedDate },
      );
    }
    return announcementId;
  },
});

export const updateAnnouncement = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    priority: v.optional(
      v.union(
        v.literal("normal"),
        v.literal("important"),
        v.literal("urgent"),
      ),
    ),
    targetAudience: v.optional(
      v.union(
        v.literal("all"),
        v.literal("department"),
        v.literal("specific-employees"),
      ),
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    scheduledPublishDate: v.optional(v.union(v.number(), v.null())),
    attachments: v.optional(v.array(v.id("_storage"))),
    attachmentContentTypes: v.optional(v.array(v.string())),
    postAs: v.optional(
      v.union(v.literal("admin"), v.literal("employee")),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await checkAuth(ctx, args.organizationId);
    requireAnnouncementManager(viewer);
    const memo = await ctx.db.get(args.announcementId);
    if (
      !memo ||
      memo.organizationId !== args.organizationId ||
      memo.type !== "announcement"
    ) {
      throw new Error("Announcement not found");
    }
    if (memo.author !== viewer._id) {
      throw new Error("Only the author can update this announcement");
    }

    const effective = await loadEffectiveMemo(ctx, memo);
    const nextTargetAudience = args.targetAudience ?? memo.targetAudience;
    const audience = await normalizeAudience(ctx, {
      organizationId: args.organizationId,
      targetAudience: nextTargetAudience,
      departments:
        nextTargetAudience === "department"
          ? (args.departments ?? effective.departments)
          : [],
      specificEmployees:
        nextTargetAudience === "specific-employees"
          ? (args.specificEmployees ?? effective.specificEmployees)
          : [],
    });
    const now = Date.now();
    const updateData: Partial<Doc<"memos">> = { updatedAt: now };
    const updatesAttachments =
      args.attachments !== undefined ||
      args.attachmentContentTypes !== undefined;
    const nextAttachments = args.attachments ?? effective.attachments;
    const nextAttachmentContentTypes = updatesAttachments
      ? normalizeAttachmentContentTypes(
          nextAttachments,
          args.attachmentContentTypes,
          effective,
        )
      : undefined;
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Announcement title is required");
      updateData.title = title;
    }
    if (args.content !== undefined) {
      if (!args.content.trim()) {
        throw new Error("Announcement content is required");
      }
      updateData.content = args.content;
    }
    if (args.priority !== undefined) updateData.priority = args.priority;
    if (args.targetAudience !== undefined) {
      updateData.targetAudience = args.targetAudience;
    }
    if (args.postAs !== undefined) {
      const persona = await resolveManagerPersona(ctx, viewer, args.postAs);
      updateData.authorPersona = persona.authorPersona;
      updateData.authorDisplayName = persona.authorDisplayName;
      updateData.authorEmployeeId = persona.authorEmployeeId;
    }

    if (args.scheduledPublishDate !== undefined) {
      const isScheduled =
        args.scheduledPublishDate !== null &&
        args.scheduledPublishDate > now;
      if (isScheduled) {
        updateData.scheduledPublishDate = args.scheduledPublishDate!;
        updateData.publishedDate = args.scheduledPublishDate!;
        updateData.isPublished = false;
        await ctx.scheduler.runAt(
          args.scheduledPublishDate!,
          internal.announcements.publishScheduledAnnouncement,
          {
            announcementId: args.announcementId,
            scheduledPublishDate: args.scheduledPublishDate!,
          },
        );
      } else {
        updateData.scheduledPublishDate = undefined;
        updateData.isPublished = true;
        if (!memo.isPublished || memo.publishedDate > now) {
          updateData.publishedDate = now;
        }
      }
    }

    if (
      args.targetAudience !== undefined ||
      args.departments !== undefined ||
      args.specificEmployees !== undefined
    ) {
      const audienceEmployeeIds = await getAnnouncementAudienceEmployeeIds(
        ctx,
        {
          organizationId: args.organizationId,
          targetAudience: nextTargetAudience,
          ...audience,
        },
      );
      updateData.audienceSnapshot = {
        count: audienceEmployeeIds.length,
        generatedAt: now,
      };
    }

    await synchronizeEffectiveMemo(
      ctx,
      memo,
      {
        departments: audience.departments,
        specificEmployees: audience.specificEmployees,
        attachments: updatesAttachments ? nextAttachments : undefined,
        attachmentContentTypes: nextAttachmentContentTypes,
      },
      now,
    );
    await ctx.db.patch(args.announcementId, updateData);
    return args.announcementId;
  },
});

export const deleteAnnouncement = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const viewer = await checkAuth(ctx, args.organizationId);
    requireAnnouncementManager(viewer);
    const announcement = await ctx.db.get(args.announcementId);
    if (
      !announcement ||
      announcement.organizationId !== args.organizationId ||
      announcement.type !== "announcement"
    ) {
      throw new Error("Announcement not found");
    }
    if (announcement.author !== viewer._id) {
      throw new Error("Only the author can delete this announcement");
    }
    const comments = await ctx.db
      .query("announcementComments")
      .withIndex("by_announcement", (builder) =>
        builder.eq("announcementId", args.announcementId),
      )
      .collect();
    for (const comment of comments) await ctx.db.delete(comment._id);
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

async function updateReaction(
  ctx: MutationCtx,
  args: {
    announcementId: Id<"memos">;
    organizationId: Id<"organizations">;
    emoji: string | null;
  },
): Promise<Id<"memos">> {
  const viewer = await checkAuth(ctx, args.organizationId);
  await requireVisibleAnnouncement(
    ctx,
    args.organizationId,
    args.announcementId,
    viewer,
  );
  if (args.emoji !== null && !REACTION_EMOJIS.has(args.emoji)) {
    throw new Error("Unsupported reaction");
  }
  const existing = await ctx.db
    .query("memoReactions")
    .withIndex("by_memo", (builder) =>
      builder.eq("memoId", args.announcementId),
    )
    .collect();
  for (const reaction of existing) {
    if (reaction.userId === viewer._id) await ctx.db.delete(reaction._id);
  }
  if (args.emoji !== null) {
    const now = Date.now();
    await ctx.db.insert("memoReactions", {
      organizationId: args.organizationId,
      memoId: args.announcementId,
      userId: viewer._id,
      emoji: args.emoji,
      reactedAt: now,
      sourceIndex: existing.length,
      migrationVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(args.announcementId, { updatedAt: Date.now() });
  return args.announcementId;
}

export const setReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    emoji: v.union(v.string(), v.null()),
  },
  handler: updateReaction,
});

export const addReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    emoji: v.string(),
  },
  handler: (ctx, args) => updateReaction(ctx, args),
});

export const removeReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: (ctx, args) => updateReaction(ctx, { ...args, emoji: null }),
});

async function getCommentAuthorPresentation(
  ctx: DatabaseContext,
  comment: Doc<"announcementComments">,
): Promise<{ authorName: string; authorPersona: AnnouncementPersona }> {
  if (
    comment.authorPersona === "admin" ||
    comment.authorDisplayName === "Admin"
  ) {
    return { authorName: "Admin", authorPersona: "admin" };
  }
  if (comment.authorEmployeeId) {
    const employee = await ctx.db.get(comment.authorEmployeeId);
    if (employee?.organizationId === comment.organizationId) {
      return {
        authorName: getEmployeeName(employee),
        authorPersona: "employee",
      };
    }
  }
  const author = await ctx.db.get(comment.author);
  return {
    authorName:
      comment.authorDisplayName?.trim() ||
      author?.name?.trim() ||
      author?.email ||
      "Former member",
    authorPersona: comment.authorPersona ?? "member",
  };
}

export const getComments = query({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) =>
    runOrgQuery(async () => {
      const viewer = await checkAuth(ctx, args.organizationId);
      await requireVisibleAnnouncement(
        ctx,
        args.organizationId,
        args.announcementId,
        viewer,
      );
      const comments = await ctx.db
        .query("announcementComments")
        .withIndex("by_announcement", (builder) =>
          builder.eq("announcementId", args.announcementId),
        )
        .collect();
      comments.sort((left, right) => left.createdAt - right.createdAt);
      return Promise.all(
        comments.map(async (comment) => ({
          _id: comment._id,
          announcementId: comment.announcementId,
          organizationId: comment.organizationId,
          author: comment.author,
          ...(await getCommentAuthorPresentation(ctx, comment)),
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        })),
      );
    }, []),
});

export const addComment = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    content: v.string(),
    commentAs: v.optional(
      v.union(v.literal("admin"), v.literal("employee")),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await checkAuth(ctx, args.organizationId);
    await requireVisibleAnnouncement(
      ctx,
      args.organizationId,
      args.announcementId,
      viewer,
    );
    const content = args.content.trim();
    if (!content) throw new Error("Comment content is required");
    const persona = await resolveCommentPersona(ctx, viewer, args.commentAs);
    const now = Date.now();
    return ctx.db.insert("announcementComments", {
      announcementId: args.announcementId,
      organizationId: args.organizationId,
      author: viewer._id,
      ...persona,
      content,
      createdAt: now,
      updatedAt: now,
    });
  },
});
