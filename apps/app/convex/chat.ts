import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { randomBytes } from "@noble/ciphers/utils.js";
import {
  encryptUtf8,
  isEncryptedPayload,
} from "./chatMessageBodyCrypto";
import {
  getChatMasterSecret,
  wrapSessionKey,
  unwrapSessionKey,
} from "./chatSessionKey";
import { bytesToBase64 } from "./binaryBase64";

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

/** Reply preview: encrypted bodies pass through as ciphertext for client decryption. */
function buildReplyToPreview(replyMsg: any, replySender: any) {
  const replySenderName =
    replySender?.name || replySender?.email || "Unknown";
  if (!replyMsg || typeof replyMsg.content !== "string") {
    return null;
  }
  if (isEncryptedPayload(replyMsg.content)) {
    return {
      _id: replyMsg._id,
      content: replyMsg.content,
      senderName: replySenderName,
    };
  }
  const snippet =
    replyMsg.content.slice(0, 80) +
    (replyMsg.content.length > 80 ? "…" : "");
  return {
    _id: replyMsg._id,
    content: snippet,
    senderName: replySenderName,
  };
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

      // Enrich with sender details and replyTo
      const enriched = await Promise.all(
        messages.map(async (msg: any) => {
          const sender = (await ctx.db.get(msg.senderId)) as any;
          let replyTo = null;
          if (msg.replyToMessageId) {
            const replyMsg = (await ctx.db.get(
              msg.replyToMessageId,
            )) as any;
            if (replyMsg) {
              const replySender = (await ctx.db.get(
                replyMsg.senderId as any,
              )) as any;
              replyTo = buildReplyToPreview(replyMsg, replySender);
            }
          }
          if (sender && "email" in sender) {
            return {
              ...msg,
              sender: {
                _id: sender._id,
                name: sender.name || sender.email,
                email: sender.email,
              },
              replyTo,
            };
          }
          return {
            ...msg,
            sender: null,
            replyTo,
          };
        })
      );

      return {
        messages: enriched.reverse(), // Return in chronological order
        hasMore: filtered.length > limit,
        oldestTimestamp: enriched.length > 0 ? enriched[0].createdAt : null,
      };
    } else {
      // Initial load - take limit+1 in one go so we can detect hasMore without chaining the query again
      const fetched = await query.take(limit + 1);
      const hasMore = fetched.length > limit;
      const messages = fetched.slice(0, limit);

      // Enrich with sender details and replyTo
      const enriched = await Promise.all(
        messages.map(async (msg: any) => {
          const sender = (await ctx.db.get(msg.senderId)) as any;
          let replyTo = null;
          if (msg.replyToMessageId) {
            const rawReplyMsg = await ctx.db.get(msg.replyToMessageId);
            const replyMsg = rawReplyMsg as any;
            if (replyMsg) {
              const replySender = await ctx.db.get(replyMsg.senderId as any);
              replyTo = buildReplyToPreview(replyMsg, replySender);
            }
          }
          if (sender && "email" in sender) {
            return {
              ...msg,
              sender: {
                _id: sender._id,
                name: sender.name || sender.email,
                email: sender.email,
              },
              replyTo,
            };
          }
          return {
            ...msg,
            sender: null,
            replyTo,
          };
        })
      );

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
    replyToMessageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to send messages in this conversation");
    }

    // If replying, ensure the reply-to message is in the same conversation
    if (args.replyToMessageId) {
      const replyToMsg = await ctx.db.get(args.replyToMessageId);
      if (
        !replyToMsg ||
        replyToMsg.conversationId !== args.conversationId
      ) {
        throw new Error("Reply target message not found");
      }
    }

    const now = Date.now();
    const messageType = args.messageType || "text";

    let conv = conversation as any;
    if (
      getChatMasterSecret() &&
      messageType !== "system" &&
      !conv.chatSessionKeyEnc
    ) {
      const sk = randomBytes(32);
      const wrapped = wrapSessionKey(sk, conv.organizationId, conv._id);
      await ctx.db.patch(args.conversationId, { chatSessionKeyEnc: wrapped });
      conv = { ...conv, chatSessionKeyEnc: wrapped };
    }

    let contentToStore = args.content;
    if (
      messageType !== "system" &&
      conv.chatSessionKeyEnc &&
      getChatMasterSecret() &&
      !isEncryptedPayload(contentToStore)
    ) {
      const sk = unwrapSessionKey(
        conv.chatSessionKeyEnc,
        conv.organizationId,
        conv._id,
      );
      contentToStore = encryptUtf8(contentToStore, sk);
    }

    // Create message
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: userRecord._id,
      content: contentToStore,
      messageType,
      attachments: args.attachments,
      payslipId: args.payslipId,
      replyToMessageId: args.replyToMessageId,
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

// Forward a message to another conversation (within org: DM, group, or channel user belongs to)
export const forwardMessage = mutation({
  args: {
    organizationId: v.id("organizations"),
    targetConversationId: v.id("conversations"),
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
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const target = await ctx.db.get(args.targetConversationId);
    if (!target || target.organizationId !== args.organizationId) {
      throw new Error("Conversation not found");
    }
    if (!target.participants.includes(userRecord._id)) {
      throw new Error("You are not a member of that conversation");
    }

    const now = Date.now();
    const messageType = args.messageType || "text";
    const forwardedContent =
      args.content.trim().toLowerCase().startsWith("forwarded:")
        ? args.content
        : `Forwarded: ${args.content}`;

    let targetConv = target as any;
    if (
      getChatMasterSecret() &&
      messageType !== "system" &&
      !targetConv.chatSessionKeyEnc
    ) {
      const sk = randomBytes(32);
      const wrapped = wrapSessionKey(
        sk,
        targetConv.organizationId,
        targetConv._id,
      );
      await ctx.db.patch(args.targetConversationId, {
        chatSessionKeyEnc: wrapped,
      });
      targetConv = { ...targetConv, chatSessionKeyEnc: wrapped };
    }

    let forwardBody = forwardedContent;
    if (
      messageType !== "system" &&
      targetConv.chatSessionKeyEnc &&
      getChatMasterSecret() &&
      !isEncryptedPayload(forwardBody)
    ) {
      const sk = unwrapSessionKey(
        targetConv.chatSessionKeyEnc,
        targetConv.organizationId,
        targetConv._id,
      );
      forwardBody = encryptUtf8(forwardBody, sk);
    }

    await ctx.db.insert("messages", {
      conversationId: args.targetConversationId,
      senderId: userRecord._id,
      content: forwardBody,
      messageType,
      attachments: args.attachments,
      readBy: [userRecord._id],
      createdAt: now,
    });

    await ctx.db.patch(args.targetConversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    return { success: true };
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

// Get a single conversation by ID (for chat area when one is selected)
export const getConversationById = query({
  args: {
    conversationId: v.optional(v.id("conversations")),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    if (!args.conversationId) return null;
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.organizationId !== args.organizationId) return null;
    if (!Array.isArray(conv.participants) || conv.participants.length === 0)
      return null;

    const userRecord = await checkAuth(ctx, args.organizationId);
    if (!conv.participants.includes(userRecord._id)) return null;

    // Return all participants (including current user) so members count and list are correct
    const participantUsers = await Promise.all(
      conv.participants.map((id: any) => ctx.db.get(id))
    );

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

// Create channel (Organization or Personal)
export const createChannel = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    scope: v.union(
      v.literal("organization"),
      v.literal("personal")
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const trimmedName = args.name.trim();
    if (!trimmedName) throw new Error("Channel name is required");

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      organizationId: args.organizationId,
      participants: [userRecord._id],
      type: "channel",
      name: trimmedName,
      createdBy: userRecord._id,
      channelScope: args.scope,
      createdAt: now,
      updatedAt: now,
    });

    return conversationId;
  },
});

// Join a channel (org members can join organization channels; for personal, only by invite/add)
export const joinChannel = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Channel not found");
    if (conversation.type !== "channel") {
      throw new Error("Not a channel");
    }

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    if (conversation.participants.includes(userRecord._id)) {
      return { success: true, alreadyMember: true };
    }

    // Organization channels: any org member can join. Personal: only if invited (already in participants we skip above)
    if (conversation.channelScope === "personal") {
      throw new Error("You can only join this channel by invitation");
    }

    await ctx.db.patch(args.conversationId, {
      participants: [...conversation.participants, userRecord._id],
      updatedAt: Date.now(),
    });

    return { success: true, alreadyMember: false };
  },
});

// List channels in org (joined and joinable for organization scope)
export const listChannels = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const allChannels = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const channels = allChannels.filter((c: any) => c.type === "channel");

    return channels.map((c: any) => ({
      _id: c._id,
      name: c.name,
      channelScope: c.channelScope,
      createdBy: c.createdBy,
      participantCount: c.participants.length,
      joined: c.participants.includes(userRecord._id),
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
    }));
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

    // Group chats and channels can have members added
    if (conversation.type !== "group" && conversation.type !== "channel") {
      throw new Error("Can only add members to group chats or channels");
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

// Delete a conversation (and all its messages). Caller must be a participant.
export const deleteConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found");

    const userRecord = await checkAuth(ctx, conversation.organizationId);
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to delete this conversation");
    }

    // Delete all messages in this conversation
    const messages = await (ctx.db.query("messages") as any)
      .withIndex("by_conversation", (q: any) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    // Remove from any user's pinned list
    const allPrefs = await ctx.db.query("userChatPreferences").collect();
    for (const prefs of allPrefs) {
      if (
        prefs.organizationId === conversation.organizationId &&
        (prefs.pinnedConversations || []).includes(args.conversationId)
      ) {
        const updated = (prefs.pinnedConversations || []).filter(
          (id: any) => id !== args.conversationId
        );
        await ctx.db.patch(prefs._id, {
          pinnedConversations: updated,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.delete(args.conversationId);
    return { success: true };
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

// Get unread counts per conversation for current user
export const getUnreadCounts = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const conversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const userConvs = conversations.filter((c: any) =>
      c.participants.includes(userRecord._id)
    );

    const counts: Record<string, number> = {};

    for (const conv of userConvs) {
      const messages = await (ctx.db.query("messages") as any)
        .withIndex("by_conversation", (q: any) =>
          q.eq("conversationId", conv._id)
        )
        .collect();

      const unread = messages.filter((msg: any) => {
        const readBy = msg.readBy || [];
        return msg.senderId !== userRecord._id && !readBy.includes(userRecord._id);
      });

      counts[conv._id] = unread.length;
    }

    return counts;
  },
});

// Mark all messages in all conversations as read for current user
export const markAllConversationsAsRead = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const conversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    const userConvs = conversations.filter((c: any) =>
      c.participants.includes(userRecord._id)
    );

    for (const conv of userConvs) {
      const messages = await (ctx.db.query("messages") as any)
        .withIndex("by_conversation", (q: any) =>
          q.eq("conversationId", conv._id)
        )
        .collect();

      for (const msg of messages) {
        const readBy = msg.readBy || [];
        if (!readBy.includes(userRecord._id)) {
          await ctx.db.patch(msg._id, {
            readBy: [...readBy, userRecord._id],
          });
        }
      }
    }

    return { success: true };
  },
});

/** Raw AES-256 session key (base64) for decrypting message bodies; participant-only. */
export const getChatSessionKey = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    const userRecord = await checkAuth(ctx, conv.organizationId);
    if (!conv.participants.includes(userRecord._id)) return null;
    if (!conv.chatSessionKeyEnc || !getChatMasterSecret()) return null;
    try {
      const raw = unwrapSessionKey(
        conv.chatSessionKeyEnc,
        conv.organizationId,
        conv._id,
      );
      return { key: bytesToBase64(raw) };
    } catch {
      return null;
    }
  },
});

/** All session keys for conversations the user is in (for sidebar previews). */
export const listChatSessionKeysForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    if (!getChatMasterSecret()) return {};
    const conversations = await (ctx.db.query("conversations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const out: Record<string, string> = {};
    for (const c of conversations) {
      if (!c.participants?.includes(userRecord._id)) continue;
      if (!c.chatSessionKeyEnc) continue;
      try {
        const raw = unwrapSessionKey(
          c.chatSessionKeyEnc,
          c.organizationId,
          c._id,
        );
        out[c._id] = bytesToBase64(raw);
      } catch {
        /* skip */
      }
    }
    return out;
  },
});
