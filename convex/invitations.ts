import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to get user record
async function getUserRecord(ctx: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");
  return userRecord;
}

// Create invitation (mutation - email will be sent from server action)
export const createInvitation = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("hr"),
      v.literal("employee"),
      v.literal("accounting")
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if current user is admin or hr in the organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const isAuthorized =
      userOrg?.role === "admin" ||
      userOrg?.role === "hr" ||
      (userRecord.organizationId === args.organizationId &&
        (userRecord.role === "admin" || userRecord.role === "hr"));

    if (!isAuthorized) {
      throw new Error("Not authorized to invite users to organization");
    }

    // Check if user is already in this organization
    const existingUser = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      const existingUserOrg = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user_organization", (q: any) =>
          q
            .eq("userId", existingUser._id)
            .eq("organizationId", args.organizationId)
        )
        .first();

      if (existingUserOrg) {
        throw new Error("User is already a member of this organization");
      }
    }

    // Check for existing pending invitation
    const existingInvitations = await (ctx.db.query("invitations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const existingInvitation = existingInvitations.find(
      (inv: any) =>
        inv.email === args.email &&
        inv.status === "pending" &&
        inv.organizationId === args.organizationId
    );

    if (existingInvitation) {
      throw new Error("An invitation has already been sent to this email");
    }

    // Generate unique token
    const token = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    // Create invitation
    const invitationId = await ctx.db.insert("invitations", {
      organizationId: args.organizationId,
      email: args.email,
      role: args.role,
      invitedBy: userRecord._id,
      token,
      status: "pending",
      expiresAt,
      createdAt: now,
    });

    return invitationId;
  },
});

// Get invitation by ID (for server action to send email)
export const getInvitationById = query({
  args: {
    invitationId: v.id("invitations"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;

    const organization = await ctx.db.get(invitation.organizationId);
    const inviter = await ctx.db.get(invitation.invitedBy);

    return {
      ...invitation,
      organization,
      inviter: inviter
        ? {
            name: inviter.name || inviter.email,
            email: inviter.email,
          }
        : null,
    };
  },
});

// Get invitation by token
export const getInvitationByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const invitation = await (ctx.db.query("invitations") as any)
      .withIndex("by_token", (q: any) => q.eq("token", args.token))
      .first();

    if (!invitation) {
      return null;
    }

    // Check if expired
    if (invitation.expiresAt < Date.now() && invitation.status === "pending") {
      await ctx.db.patch(invitation._id, { status: "expired" });
      return null;
    }

    // Get organization and inviter details
    const organization = await ctx.db.get(invitation.organizationId);
    const inviter = await ctx.db.get(invitation.invitedBy);

    return {
      ...invitation,
      organization,
      inviter: inviter
        ? {
            name: inviter.name || inviter.email,
            email: inviter.email,
          }
        : null,
    };
  },
});

// Check if user exists by email
export const checkUserExists = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", args.email))
      .first();
    return !!user;
  },
});

// Accept invitation
export const acceptInvitation = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await (ctx.db.query("invitations") as any)
      .withIndex("by_token", (q: any) => q.eq("token", args.token))
      .first();

    if (!invitation) {
      throw new Error("Invalid invitation token");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation has already been used or expired");
    }

    if (invitation.expiresAt < Date.now()) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new Error("Invitation has expired");
    }

    // Try to get authenticated user (may not be authenticated yet for new users)
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);

    // If authenticated, verify email matches
    if (authUser && authUser.email !== invitation.email) {
      throw new Error("Invitation email does not match your account");
    }

    const now = Date.now();

    // Get or create user record in Convex
    let user = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", invitation.email))
      .first();

    let userId: any;

    if (!user) {
      // Create user record if it doesn't exist
      userId = await ctx.db.insert("users", {
        email: invitation.email,
        name: args.name,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      userId = user._id;
      if (args.name) {
        // Update user name if provided
        await ctx.db.patch(user._id, {
          name: args.name,
          updatedAt: now,
        });
      }
    }

    // Add user to organization
    const existingUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userId).eq("organizationId", invitation.organizationId)
      )
      .first();

    if (!existingUserOrg) {
      await ctx.db.insert("userOrganizations", {
        userId: userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        employeeId: invitation.employeeId,
        joinedAt: now,
        updatedAt: now,
      });
    } else {
      // Update existing relationship
      await ctx.db.patch(existingUserOrg._id, {
        role: invitation.role,
        employeeId: invitation.employeeId,
        updatedAt: now,
      });
    }

    // Mark invitation as accepted
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: now,
    });

    return {
      success: true,
      userId: userId,
      email: invitation.email,
      organizationId: invitation.organizationId,
    };
  },
});

// Get invitations for organization
export const getInvitations = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check authorization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const isAuthorized =
      userOrg?.role === "admin" ||
      userOrg?.role === "hr" ||
      (userRecord.organizationId === args.organizationId &&
        (userRecord.role === "admin" || userRecord.role === "hr"));

    if (!isAuthorized) {
      throw new Error("Not authorized");
    }

    const invitations = await (ctx.db.query("invitations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    return invitations.sort((a: any, b: any) => b.createdAt - a.createdAt);
  },
});

// Cancel invitation
export const cancelInvitation = mutation({
  args: {
    invitationId: v.id("invitations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");

    // Check authorization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", invitation.organizationId)
      )
      .first();

    const isAuthorized =
      userOrg?.role === "admin" ||
      userOrg?.role === "hr" ||
      (userRecord.organizationId === invitation.organizationId &&
        (userRecord.role === "admin" || userRecord.role === "hr"));

    if (!isAuthorized) {
      throw new Error("Not authorized");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only cancel pending invitations");
    }

    await ctx.db.patch(args.invitationId, {
      status: "cancelled",
    });

    return { success: true };
  },
});
