import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization - allows all authenticated users
async function checkAuth(ctx: any, organizationId: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  let userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) {
    throw new Error(
      "User record not found. Please complete your account setup."
    );
  }

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

  return { ...userRecord, role: userRole, organizationId };
}

// Get announcements (only type="announcement", accessible to all authenticated users)
export const getAnnouncements = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Get only published announcements
    let announcements = await (ctx.db.query("memos") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter to only announcements that are published
    announcements = announcements.filter(
      (m: any) => m.type === "announcement" && m.isPublished === true
    );

    // Filter by target audience for employees
    if (userRecord.role === "employee" && args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (employee) {
        announcements = announcements.filter((m: any) => {
          if (m.targetAudience === "all") return true;
          if (m.targetAudience === "department") {
            return m.departments?.includes(employee.employment.department);
          }
          if (m.targetAudience === "specific-employees") {
            return m.specificEmployees?.includes(args.employeeId!);
          }
          return false;
        });
      }
    }

    announcements.sort((a: any, b: any) => b.publishedDate - a.publishedDate);
    return announcements;
  },
});

// Create announcement (admin/hr only)
export const createAnnouncement = mutation({
  args: {
    organizationId: v.id("organizations"),
    title: v.string(),
    content: v.string(),
    priority: v.union(
      v.literal("normal"),
      v.literal("important"),
      v.literal("urgent")
    ),
    targetAudience: v.union(
      v.literal("all"),
      v.literal("department"),
      v.literal("specific-employees")
    ),
    departments: v.optional(v.array(v.string())),
    specificEmployees: v.optional(v.array(v.id("employees"))),
    expiryDate: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    acknowledgementRequired: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Only admin and hr can create announcements
    if (userRecord.role !== "admin" && userRecord.role !== "hr") {
      throw new Error("Not authorized - admin or hr role required");
    }

    const now = Date.now();
    const announcementId = await ctx.db.insert("memos", {
      organizationId: args.organizationId,
      title: args.title,
      content: args.content,
      type: "announcement",
      priority: args.priority,
      author: userRecord._id,
      targetAudience: args.targetAudience,
      departments: args.departments,
      specificEmployees: args.specificEmployees,
      publishedDate: now,
      expiryDate: args.expiryDate,
      attachments: args.attachments,
      isPublished: true,
      acknowledgementRequired: args.acknowledgementRequired,
      createdAt: now,
      updatedAt: now,
    });

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
    expiryDate: v.optional(v.number()),
    attachments: v.optional(v.array(v.id("_storage"))),
    acknowledgementRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Only admin and hr can update announcements
    if (userRecord.role !== "admin" && userRecord.role !== "hr") {
      throw new Error("Not authorized - admin or hr role required");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    // Only author or admin/hr can update
    if (announcement.author !== userRecord._id && userRecord.role !== "admin") {
      throw new Error("Not authorized - only author or admin can update");
    }

    const updateData: any = {
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
    if (args.expiryDate !== undefined) updateData.expiryDate = args.expiryDate;
    if (args.attachments !== undefined)
      updateData.attachments = args.attachments;
    if (args.acknowledgementRequired !== undefined)
      updateData.acknowledgementRequired = args.acknowledgementRequired;

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

    // Only admin and hr can delete announcements
    if (userRecord.role !== "admin" && userRecord.role !== "hr") {
      throw new Error("Not authorized - admin or hr role required");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    // Only author or admin can delete
    if (announcement.author !== userRecord._id && userRecord.role !== "admin") {
      throw new Error("Not authorized - only author or admin can delete");
    }

    await ctx.db.delete(args.announcementId);
    return args.announcementId;
  },
});

// Add reaction to announcement (employees, hr, accounting)
export const addReaction = mutation({
  args: {
    announcementId: v.id("memos"),
    organizationId: v.id("organizations"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Employees, hr, and accounting can react
    if (
      userRecord.role !== "employee" &&
      userRecord.role !== "hr" &&
      userRecord.role !== "accounting" &&
      userRecord.role !== "admin"
    ) {
      throw new Error("Not authorized to react");
    }

    const announcement = await ctx.db.get(args.announcementId);
    if (!announcement || announcement.organizationId !== args.organizationId) {
      throw new Error("Announcement not found");
    }

    const reactions = announcement.reactions || [];
    const now = Date.now();

    // Remove existing reaction from this user if any
    const filteredReactions = reactions.filter(
      (r: any) => r.userId !== userRecord._id
    );

    // Add new reaction
    filteredReactions.push({
      userId: userRecord._id,
      emoji: args.emoji,
      createdAt: now,
    });

    await ctx.db.patch(args.announcementId, {
      reactions: filteredReactions,
      updatedAt: now,
    });

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

    const reactions = announcement.reactions || [];
    const filteredReactions = reactions.filter(
      (r: any) => r.userId !== userRecord._id
    );

    await ctx.db.patch(args.announcementId, {
      reactions: filteredReactions,
      updatedAt: Date.now(),
    });

    return args.announcementId;
  },
});
