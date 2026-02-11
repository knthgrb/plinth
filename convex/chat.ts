import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr" | "accounting" | "employee"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

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

  // Owner and admin have access to everything
  // For chat, all authenticated roles can access (owner, admin, hr, accounting, employee)
  if (requiredRole) {
    if (
      userRole !== requiredRole &&
      userRole !== "admin" &&
      userRole !== "owner"
    ) {
      throw new Error("Not authorized");
    }
  }
  // If no requiredRole specified, allow all authenticated users (read access)

  return { ...userRecord, role: userRole, organizationId };
}

// Get user ID from employee ID
export const getUserByEmployeeId = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId);

    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      return null;
    }

    // Find user linked to this employee
    const user = await (ctx.db.query("users") as any)
      .withIndex("by_employee", (q: any) => q.eq("employeeId", args.employeeId))
      .first();

    // Also check userOrganizations for employeeId
    if (!user) {
      const userOrg = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId)
        )
        .filter((q: any) => q.eq(q.field("employeeId"), args.employeeId))
        .first();

      if (userOrg) {
        return await ctx.db.get(userOrg.userId);
      }
    }

    return user;
  },
});

// Get or create a direct conversation between two users
export const getOrCreateConversation = mutation({
  args: {
    organizationId: v.id("organizations"),
    participantId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Check if conversation already exists
    const existingConversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const existing = existingConversations.find((conv: any) => {
      return (
        conv.type === "direct" &&
        conv.participants.length === 2 &&
        conv.participants.includes(userRecord._id) &&
        conv.participants.includes(args.participantId)
      );
    });

    if (existing) {
      return existing._id;
    }

    // Create new conversation
    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      organizationId: args.organizationId,
      participants: [userRecord._id, args.participantId],
      type: "direct",
      createdAt: now,
      updatedAt: now,
    });

    return conversationId;
  },
});

// Get all conversations for a user in an organization
export const getConversations = query({
  args: {
    organizationId: v.id("organizations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()), // lastMessageAt timestamp as cursor
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    const limit = args.limit || 20;

    const conversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter conversations where user is a participant
    let userConversations = conversations.filter((conv: any) =>
      conv.participants.includes(userRecord._id)
    );

    // Enrich with participant details and last message
    let enriched = await Promise.all(
      userConversations.map(async (conv: any) => {
        // Get other participants (not current user)
        const otherParticipants = conv.participants.filter(
          (id: any) => id !== userRecord._id
        );

        // Get participant user records
        const participantUsers = await Promise.all(
          otherParticipants.map((id: any) => ctx.db.get(id))
        );

        // Get last message
        const lastMessage = await (ctx.db.query("messages") as any)
          .withIndex("by_conversation", (q: any) =>
            q.eq("conversationId", conv._id)
          )
          .order("desc")
          .first();

        return {
          ...conv,
          participants: participantUsers.filter(Boolean),
          lastMessage,
        };
      })
    );

    // Sort by last message time
    enriched.sort((a: any, b: any) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt;
      const bTime = b.lastMessage?.createdAt || b.createdAt;
      return bTime - aTime;
    });

    // Apply cursor if provided
    if (args.cursor) {
      const cursorTime = parseInt(args.cursor);
      enriched = enriched.filter((conv: any) => {
        const convTime = conv.lastMessage?.createdAt || conv.createdAt;
        return convTime < cursorTime;
      });
    }

    // Apply limit
    const limited = enriched.slice(0, limit);
    const hasMore = enriched.length > limit;

    return {
      conversations: limited,
      hasMore,
      nextCursor:
        limited.length > 0
          ? String(
              limited[limited.length - 1].lastMessage?.createdAt ||
                limited[limited.length - 1].createdAt
            )
          : null,
    };
  },
});

// Get messages for a conversation
export const getMessages = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    beforeTimestamp: v.optional(v.number()), // Load messages before this timestamp
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to view this conversation");
    }

    const limit = args.limit || 50;
    let query = (ctx.db.query("messages") as any)
      .withIndex("by_conversation", (q: any) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc");

    // If beforeTimestamp is provided, filter messages before that time
    if (args.beforeTimestamp !== undefined) {
      // We need to get all and filter, as Convex doesn't support range queries directly
      const allMessages = await query.collect();
      const filtered = allMessages.filter(
        (msg: any) => msg.createdAt < args.beforeTimestamp!
      );
      const messages = filtered.slice(0, limit);

      // Enrich with sender details
      const enriched = await Promise.all(
        messages.map(async (msg: any) => {
          const sender = (await ctx.db.get(msg.senderId)) as any;
          if (sender && "email" in sender) {
            return {
              ...msg,
              sender: {
                _id: sender._id,
                name: sender.name || sender.email,
                email: sender.email,
              },
            };
          }
          return {
            ...msg,
            sender: null,
          };
        })
      );

      return {
        messages: enriched.reverse(), // Return in chronological order
        hasMore: filtered.length > limit,
        oldestTimestamp: enriched.length > 0 ? enriched[0].createdAt : null,
      };
    } else {
      // Initial load - get most recent messages
      const messages = await query.take(limit);

      // Enrich with sender details
      const enriched = await Promise.all(
        messages.map(async (msg: any) => {
          const sender = (await ctx.db.get(msg.senderId)) as any;
          if (sender && "email" in sender) {
            return {
              ...msg,
              sender: {
                _id: sender._id,
                name: sender.name || sender.email,
                email: sender.email,
              },
            };
          }
          return {
            ...msg,
            sender: null,
          };
        })
      );

      // Check if there are more messages
      const checkMore = await query.take(limit + 1);
      const hasMore = checkMore.length > limit;

      return {
        messages: enriched.reverse(), // Return in chronological order
        hasMore,
        oldestTimestamp: enriched.length > 0 ? enriched[0].createdAt : null,
      };
    }
  },
});

// Send a message
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    messageType: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("file"),
        v.literal("system")
      )
    ),
    attachments: v.optional(v.array(v.id("_storage"))),
    payslipId: v.optional(v.id("payslips")), // Link message to payslip
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to send messages in this conversation");
    }

    const now = Date.now();

    // Create message
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: userRecord._id,
      content: args.content,
      messageType: args.messageType || "text",
      attachments: args.attachments,
      payslipId: args.payslipId,
      readBy: [userRecord._id], // Sender has read their own message
      createdAt: now,
    });

    // Update conversation's lastMessageAt
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    return messageId;
  },
});

// Mark messages as read
export const markMessagesAsRead = mutation({
  args: {
    conversationId: v.id("conversations"),
    messageIds: v.array(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized");
    }

    // Update each message to include user in readBy
    for (const messageId of args.messageIds) {
      const message = await ctx.db.get(messageId);
      if (message && message.conversationId === args.conversationId) {
        const readBy = message.readBy || [];
        if (!readBy.includes(userRecord._id)) {
          await ctx.db.patch(messageId, {
            readBy: [...readBy, userRecord._id],
          });
        }
      }
    }

    return { success: true };
  },
});

// Get conversation by participant (for direct messages)
export const getConversationByParticipant = query({
  args: {
    organizationId: v.id("organizations"),
    participantId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const conversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const conversation = conversations.find((conv: any) => {
      return (
        conv.type === "direct" &&
        conv.participants.length === 2 &&
        conv.participants.includes(userRecord._id) &&
        conv.participants.includes(args.participantId)
      );
    });

    return conversation || null;
  },
});

// Get all users in organization (for creating group chats)
export const getOrganizationUsers = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Get all user-organization relationships for this org
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Get user records
    const users = await Promise.all(
      userOrgs.map(async (userOrg: any) => {
        const user = (await ctx.db.get(userOrg.userId)) as any;
        if (!user || !("email" in user)) return null;
        return {
          _id: user._id,
          name: user.name || user.email,
          email: user.email,
          role: userOrg.role,
        };
      })
    );

    // Filter out nulls and exclude current user
    return users.filter(
      (u): u is NonNullable<typeof u> => u !== null && u._id !== userRecord._id
    );
  },
});

// Create group chat
export const createGroupChat = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    participantIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Ensure creator is included in participants
    const allParticipants = [
      userRecord._id,
      ...args.participantIds.filter((id) => id !== userRecord._id),
    ];

    if (allParticipants.length < 2) {
      throw new Error("Group chat must have at least 2 participants");
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      organizationId: args.organizationId,
      participants: allParticipants,
      type: "group",
      name: args.name,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });

    return conversationId;
  },
});

// Add members to group chat
export const addMembersToGroup = mutation({
  args: {
    conversationId: v.id("conversations"),
    participantIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Only group chats can have members added
    if (conversation.type !== "group") {
      throw new Error("Can only add members to group chats");
    }

    // Check if user is a participant (and optionally creator/admin)
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to add members to this conversation");
    }

    // Add new participants (avoid duplicates)
    const existingParticipants = new Set(conversation.participants);
    const newParticipants = args.participantIds.filter(
      (id) => !existingParticipants.has(id)
    );

    if (newParticipants.length === 0) {
      return { success: true, added: 0 };
    }

    await ctx.db.patch(args.conversationId, {
      participants: [...conversation.participants, ...newParticipants],
      updatedAt: Date.now(),
    });

    return { success: true, added: newParticipants.length };
  },
});

// Remove member from group chat
export const removeMemberFromGroup = mutation({
  args: {
    conversationId: v.id("conversations"),
    participantId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Only group chats
    if (conversation.type !== "group") {
      throw new Error("Can only remove members from group chats");
    }

    // Check authorization (creator, admin, or owner)
    const isCreator = conversation.createdBy === userRecord._id;
    const isAdmin = userRecord.role === "admin";
    const isOwner = userRecord.role === "owner";

    if (
      !isCreator &&
      !isAdmin &&
      !isOwner &&
      userRecord._id !== args.participantId
    ) {
      throw new Error("Not authorized to remove members");
    }

    // Can't remove if only 2 participants left
    if (conversation.participants.length <= 2) {
      throw new Error(
        "Cannot remove member - group must have at least 2 members"
      );
    }

    await ctx.db.patch(args.conversationId, {
      participants: conversation.participants.filter(
        (id) => id !== args.participantId
      ),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Pin/unpin conversation
export const togglePinConversation = mutation({
  args: {
    organizationId: v.id("organizations"),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    // Get or create user chat preferences
    let preferences = await (ctx.db.query("userChatPreferences") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const now = Date.now();
    const pinned = preferences?.pinnedConversations || [];

    if (pinned.includes(args.conversationId)) {
      // Unpin
      const updatedPinned = pinned.filter(
        (id: any) => id !== args.conversationId
      );
      if (preferences) {
        await ctx.db.patch(preferences._id, {
          pinnedConversations: updatedPinned,
          updatedAt: now,
        });
      }
      return { pinned: false };
    } else {
      // Pin
      const updatedPinned = [...pinned, args.conversationId];
      if (preferences) {
        await ctx.db.patch(preferences._id, {
          pinnedConversations: updatedPinned,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("userChatPreferences", {
          userId: userRecord._id,
          organizationId: args.organizationId,
          pinnedConversations: updatedPinned,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { pinned: true };
    }
  },
});

// Get pinned conversations for user
export const getPinnedConversations = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const preferences = await (ctx.db.query("userChatPreferences") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    return preferences?.pinnedConversations || [];
  },
});
