import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { randomBytes } from "@noble/ciphers/utils.js";
import {
  decryptUtf8,
  encryptUtf8,
  isEncryptedPayload,
} from "./chatMessageBodyCrypto";
import {
  getChatMasterSecret,
  wrapSessionKey,
  unwrapSessionKey,
} from "./chatSessionKey";
import { bytesToBase64 } from "./binaryBase64";
import { isOrgQueryAuthGraceError } from "./queryAuthGrace";
import { requireActiveMembership } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { canUseFullOrganizationAccess } from "@/utils/org-membership-lifecycle";
import {
  loadEffectiveConversation,
  loadEffectiveMessageAttachments,
  loadEffectiveMessageReadBy,
  loadEffectivePinnedConversations,
  replaceConversationMembers,
  replaceMessageAttachments,
  replaceMessageReceipts,
  replacePinnedConversations,
} from "./communicationsCompatibility";

const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 5_000;
const ALLOWED_REACTION_EMOJIS = new Set(["👍", "❤️", "🎉", "😂", "😮", "😢"]);

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr" | "manager" | "accounting" | "employee"
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Owner and admin have access to everything
  // For chat, all authenticated roles can access (owner, admin, hr, manager, accounting, employee)
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

  return {
    _id: user._id,
    email: user.email,
    name: user.name,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
  };
}

async function checkAuthForQuery(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr" | "manager" | "accounting" | "employee",
) {
  try {
    return await checkAuth(ctx, organizationId, requiredRole);
  } catch (e) {
    if (isOrgQueryAuthGraceError(e)) return null;
    throw e;
  }
}
function buildReplyToPreview(
  replyMsg: Doc<"messages"> | null,
  replySender: Doc<"users"> | null,
) {
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

async function loadMessageReactions(
  ctx: QueryCtx,
  messageId: Id<"messages">,
) {
  return ctx.db
    .query("messageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
}

async function requireAuthorizedMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
) {
  const message = await ctx.db.get(messageId);
  if (!message) throw new Error("Message not found");
  const conversationRow = await ctx.db.get(message.conversationId);
  if (!conversationRow) throw new Error("Conversation not found");
  const conversation = await loadEffectiveConversation(ctx, conversationRow);
  const user = await checkAuth(ctx, conversation.organizationId);
  if (!conversation.participants.includes(user._id)) {
    throw new Error("Not authorized to use this conversation");
  }
  return { message, conversation, conversationRow, user };
}

async function upsertConversationPreference(
  ctx: MutationCtx,
  input: {
    organizationId: Id<"organizations">;
    userId: Id<"users">;
    conversationId: Id<"conversations">;
    muted?: boolean;
    lastReadAt?: number;
  },
) {
  const existing = await ctx.db
    .query("userConversationPreferences")
    .withIndex("by_user_conversation", (q) =>
      q.eq("userId", input.userId).eq("conversationId", input.conversationId),
    )
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(input.muted !== undefined ? { muted: input.muted } : {}),
      ...(input.lastReadAt !== undefined
        ? { lastReadAt: Math.max(existing.lastReadAt ?? 0, input.lastReadAt) }
        : {}),
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("userConversationPreferences", {
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId: input.conversationId,
    muted: input.muted ?? false,
    lastReadAt: input.lastReadAt,
    createdAt: now,
    updatedAt: now,
  });
}

// Get user ID from employee ID
export const getUserByEmployeeId = query({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.id("employees"),
  },
  handler: async (ctx, args) => {
    if (!(await checkAuthForQuery(ctx, args.organizationId))) return null;

    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      return null;
    }

    const memberships = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("employeeId"), args.employeeId))
      .take(2);
    if (memberships.length > 1) {
      throw new Error("Employee has multiple organization memberships");
    }
    if (memberships[0]) {
      if (!canUseFullOrganizationAccess(memberships[0].accessStatus)) {
        return null;
      }
      return await ctx.db.get(memberships[0].userId);
    }

    return null;
  },
});

/** Best user to receive payslip appeals (owner → admin → hr). */
export const getPayrollAppealRecipient = query({
  args: {
    organizationId: v.id("organizations"),
    excludeUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    if (!(await checkAuthForQuery(ctx, args.organizationId))) return null;

    const userOrgs = (
      await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect()
    ).filter((membership) =>
      canUseFullOrganizationAccess(membership.accessStatus),
    );

    const priority = ["owner", "admin", "hr"] as const;
    for (const role of priority) {
      const candidates = userOrgs.filter(
        (membership) =>
          membership.role === role &&
          (!args.excludeUserId || membership.userId !== args.excludeUserId),
      );
      for (const candidate of candidates) {
        const user = await ctx.db.get(candidate.userId);
        if (user) {
          return { userId: candidate.userId, role: candidate.role as string };
        }
      }
    }
    return null;
  },
});

function normalizedDirectKind(
  conversation: Doc<"conversations">,
): "standard" | "staff_as_admin" {
  return conversation.directThreadKind === "staff_as_admin"
    ? "staff_as_admin"
    : "standard";
}

function canUseAdminPersona(role: string) {
  return role === "owner" || role === "admin" || role === "hr";
}

function assertAdminPersonaAccess(
  conversation: Doc<"conversations">,
  user: { _id: Id<"users">; role: string },
) {
  if (
    conversation.directThreadKind === "staff_as_admin" &&
    conversation.adminPersonaUserId === user._id &&
    !canUseAdminPersona(user.role)
  ) {
    throw new Error("Only Owner, Admin, or HR can message as Admin");
  }
}

async function assertActiveChatParticipants(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  participantIds: readonly Id<"users">[],
) {
  for (const participantId of new Set(participantIds)) {
    const [user, membership] = await Promise.all([
      ctx.db.get(participantId),
      ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (q) =>
          q
            .eq("userId", participantId)
            .eq("organizationId", organizationId),
        )
        .unique(),
    ]);
    if (
      !user ||
      !membership ||
      !canUseFullOrganizationAccess(membership.accessStatus)
    ) {
      throw new Error("Chat participant is not active in this organization");
    }
  }
}

// Get or create a direct conversation between two users
export const getOrCreateConversation = mutation({
  args: {
    organizationId: v.id("organizations"),
    participantId: v.id("users"),
    directThreadKind: v.optional(
      v.union(v.literal("standard"), v.literal("staff_as_admin")),
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);
    await assertActiveChatParticipants(ctx, args.organizationId, [
      args.participantId,
    ]);

    const requestedKind = args.directThreadKind ?? "standard";

    if (requestedKind === "staff_as_admin") {
      if (!canUseAdminPersona(userRecord.role)) {
        throw new Error(
          "Only owner, admin, or HR can start an Admin direct message",
        );
      }
    }

    const existingConversations = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const effectiveConversations = await Promise.all(
      existingConversations.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );
    const existing = effectiveConversations.find((conv) => {
      if (
        conv.type !== "direct" ||
        conv.participants.length !== 2 ||
        !conv.participants.includes(userRecord._id) ||
        !conv.participants.includes(args.participantId)
      ) {
        return false;
      }
      const kind = normalizedDirectKind(conv);
      if (kind !== requestedKind) return false;
      if (requestedKind === "staff_as_admin") {
        return conv.adminPersonaUserId === userRecord._id;
      }
      return !conv.adminPersonaUserId;
    });

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      organizationId: args.organizationId,
      type: "direct",
      ...(requestedKind === "staff_as_admin"
        ? {
            directThreadKind: "staff_as_admin" as const,
            adminPersonaUserId: userRecord._id,
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation creation did not persist");
    await replaceConversationMembers(
      ctx,
      conversation,
      [userRecord._id, args.participantId],
      now,
    );

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
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) {
      return {
        conversations: [],
        hasMore: false,
        nextCursor: null,
      };
    }
    const limit = args.limit || 20;

    const legacyConversations = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
    const conversations = await Promise.all(
      legacyConversations.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );

    // Filter conversations where user is a participant
    const userConversations = conversations.filter(
      (conv) =>
        conv.archivedAt === undefined &&
        conv.participants.includes(userRecord._id),
    );

    // Enrich with participant details and last message
    let enriched = await Promise.all(
      userConversations.map(async (conv) => {
        // Get other participants (not current user)
        const otherParticipants = conv.participants.filter(
          (id) => id !== userRecord._id,
        );

        // Get participant user records
        const participantUsers = await Promise.all(
          otherParticipants.map((id) => ctx.db.get(id)),
        );

        // Get last message
        const lastMessage = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conv._id)
          )
          .order("desc")
          .first();

        return {
          ...conv,
          participants: participantUsers.filter(
            (participant): participant is NonNullable<typeof participant> =>
              participant !== null,
          ),
          lastMessage,
        };
      })
    );

    // Sort by last message time
    enriched.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt;
      const bTime = b.lastMessage?.createdAt || b.createdAt;
      return bTime - aTime;
    });

    // Apply cursor if provided
    if (args.cursor) {
      const cursorTime = parseInt(args.cursor);
      enriched = enriched.filter((conv) => {
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
    const legacyConversation = await ctx.db.get(args.conversationId);
    if (!legacyConversation) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, legacyConversation);

    const userRecord = await checkAuthForQuery(ctx, conversation.organizationId);
    if (!userRecord) {
      return { messages: [], hasMore: false, oldestTimestamp: null };
    }

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to view this conversation");
    }

    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const beforeTimestamp = args.beforeTimestamp;
    const fetched =
      beforeTimestamp === undefined
        ? await ctx.db
            .query("messages")
            .withIndex("by_conversation_created_at", (q) =>
              q.eq("conversationId", args.conversationId),
            )
            .order("desc")
            .take(limit + 1)
        : await ctx.db
            .query("messages")
            .withIndex("by_conversation_created_at", (q) =>
              q
                .eq("conversationId", args.conversationId)
                .lt("createdAt", beforeTimestamp),
            )
            .order("desc")
            .take(limit + 1);
    const hasMore = fetched.length > limit;
    const messages = fetched.slice(0, limit);
    const enriched = await Promise.all(
      messages.map(async (message) => {
        const sender = await ctx.db.get(message.senderId);
        const [readBy, attachments, reactions] = await Promise.all([
          loadEffectiveMessageReadBy(ctx, conversation, message),
          loadEffectiveMessageAttachments(ctx, conversation, message),
          loadMessageReactions(ctx, message._id),
        ]);
        let replyTo = null;
        if (message.replyToMessageId) {
          const replyMessage = await ctx.db.get(message.replyToMessageId);
          if (replyMessage) {
            const replySender = await ctx.db.get(replyMessage.senderId);
            replyTo = buildReplyToPreview(replyMessage, replySender);
          }
        }
        return {
          ...message,
          readBy,
          attachments,
          reactions,
          sender: sender
            ? {
                _id: sender._id,
                name: sender.name || sender.email,
                email: sender.email,
              }
            : null,
          replyTo,
        };
      }),
    );

    return {
      messages: enriched.reverse(),
      hasMore,
      oldestTimestamp: enriched.length > 0 ? enriched[0].createdAt : null,
    };
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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    if (conversation.archivedAt !== undefined) {
      throw new Error("This conversation is archived");
    }

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to send messages in this conversation");
    }
    assertAdminPersonaAccess(conversation, userRecord);

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
    if (messageType === "system") {
      throw new Error("System messages cannot be sent by users");
    }
    if (!args.content.trim() && (args.attachments?.length ?? 0) === 0) {
      throw new Error("Message content is required");
    }
    if (args.content.length > MAX_MESSAGE_LENGTH * 4) {
      throw new Error("Message is too long");
    }

    if (args.payslipId) {
      const payslip = await ctx.db.get(args.payslipId);
      if (!payslip || payslip.organizationId !== conversation.organizationId) {
        throw new Error("Payslip does not belong to this organization");
      }
      if (
        userRecord.role === "employee" &&
        (!userRecord.employeeId || payslip.employeeId !== userRecord.employeeId)
      ) {
        throw new Error("Not authorized to link this payslip");
      }
    }

    for (const storageId of args.attachments ?? []) {
      const storageObject = await ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique();
      if (
        !storageObject ||
        storageObject.organizationId !== conversation.organizationId ||
        storageObject.state !== "active"
      ) {
        throw new Error("Attachment does not belong to this organization");
      }
      const canAttachOwnUpload =
        storageObject.purpose === "chat_attachment" &&
        storageObject.ownerUserId === userRecord._id;
      const canAttachPayslip =
        storageObject.purpose === "payslip_pdf" &&
        args.payslipId !== undefined &&
        ["owner", "admin", "hr", "accounting"].includes(userRecord.role);
      if (!canAttachOwnUpload && !canAttachPayslip) {
        throw new Error("Not authorized to attach this file");
      }
    }

    let conv = conversation;
    if (
      getChatMasterSecret() &&
      !conv.chatSessionKeyEnc
    ) {
      const sk = randomBytes(32);
      const wrapped = wrapSessionKey(sk, conv.organizationId, conv._id);
      await ctx.db.patch(args.conversationId, { chatSessionKeyEnc: wrapped });
      conv = { ...conv, chatSessionKeyEnc: wrapped };
    }

    let contentToStore = args.content;
    if (
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
      payslipId: args.payslipId,
      replyToMessageId: args.replyToMessageId,
      createdAt: now,
    });
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message creation did not persist");
    await replaceMessageReceipts(
      ctx,
      conversation,
      message,
      [userRecord._id],
      now,
    );
    await replaceMessageAttachments(
      ctx,
      conversation,
      message,
      args.attachments ?? [],
      now,
    );

    // Update conversation's lastMessageAt
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });

    if (args.payslipId) {
      const payslip = await ctx.db.get(args.payslipId);
      if (payslip) {
        const currentSummary = payslip.concernSummary ?? null;
        const currentCount =
          typeof currentSummary?.messageCount === "number"
            ? currentSummary.messageCount
            : 0;
        const currentLastMessageAt =
          typeof currentSummary?.lastMessageAt === "number"
            ? currentSummary.lastMessageAt
            : 0;
        await ctx.db.patch(args.payslipId, {
          concernSummary: {
            messageCount: currentCount + 1,
            lastMessageAt: Math.max(currentLastMessageAt, now),
          },
        });
      }
    }

    return messageId;
  },
});

export const toggleMessageReaction = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const { message, conversation, user } = await requireAuthorizedMessage(
      ctx,
      args.messageId,
    );
    if (message.deletedAt !== undefined) {
      throw new Error("Deleted messages cannot receive reactions");
    }
    if (!ALLOWED_REACTION_EMOJIS.has(args.emoji)) {
      throw new Error("Unsupported reaction");
    }

    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_user_emoji", (q) =>
        q
          .eq("messageId", args.messageId)
          .eq("userId", user._id)
          .eq("emoji", args.emoji),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { active: false };
    }

    const now = Date.now();
    await ctx.db.insert("messageReactions", {
      organizationId: conversation.organizationId,
      conversationId: conversation._id,
      messageId: args.messageId,
      userId: user._id,
      emoji: args.emoji,
      createdAt: now,
      updatedAt: now,
    });
    return { active: true };
  },
});

export const editMessage = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { message, conversation, user } = await requireAuthorizedMessage(
      ctx,
      args.messageId,
    );
    if (message.senderId !== user._id) {
      throw new Error("Only the author can edit this message");
    }
    if (message.deletedAt !== undefined || message.messageType === "system") {
      throw new Error("This message cannot be edited");
    }
    if (Date.now() - message.createdAt > MESSAGE_EDIT_WINDOW_MS) {
      throw new Error("Messages can only be edited for 15 minutes");
    }

    const content = args.content.trim();
    if (!content) throw new Error("Message content is required");
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error("Message is too long");
    }

    let contentToStore = content;
    if (
      conversation.chatSessionKeyEnc &&
      getChatMasterSecret() &&
      !isEncryptedPayload(contentToStore)
    ) {
      const sessionKey = unwrapSessionKey(
        conversation.chatSessionKeyEnc,
        conversation.organizationId,
        conversation._id,
      );
      contentToStore = encryptUtf8(contentToStore, sessionKey);
    }

    await ctx.db.patch(args.messageId, {
      content: contentToStore,
      editedAt: Date.now(),
    });
    return { success: true };
  },
});

export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const { message, conversation, user } = await requireAuthorizedMessage(
      ctx,
      args.messageId,
    );
    if (message.deletedAt !== undefined) return { success: true };
    const isAuthor = message.senderId === user._id;
    const canModerate =
      user.role === "owner" || user.role === "admin" || user.role === "hr";
    if (!isAuthor && !canModerate) {
      throw new Error("Not authorized to delete this message");
    }

    const deletedAt = Date.now();
    await ctx.db.patch(args.messageId, {
      content: "",
      deletedAt,
      deletedBy: user._id,
      deletionKind: isAuthor ? "author" : "moderator",
    });
    await replaceMessageAttachments(ctx, conversation, message, [], deletedAt);
    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
    await Promise.all(reactions.map((reaction) => ctx.db.delete(reaction._id)));
    return { success: true };
  },
});

// Forward a message to another conversation (within org: DM, group, or channel user belongs to)
export const forwardMessage = mutation({
  args: {
    organizationId: v.id("organizations"),
    targetConversationId: v.id("conversations"),
    sourceMessageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const targetRow = await ctx.db.get(args.targetConversationId);
    if (!targetRow || targetRow.organizationId !== args.organizationId) {
      throw new Error("Conversation not found");
    }
    const target = await loadEffectiveConversation(ctx, targetRow);
    if (!target.participants.includes(userRecord._id)) {
      throw new Error("You are not a member of that conversation");
    }
    assertAdminPersonaAccess(target, userRecord);

    const sourceMessage = await ctx.db.get(args.sourceMessageId);
    if (!sourceMessage || sourceMessage.deletedAt !== undefined) {
      throw new Error("Message not found");
    }
    const sourceRow = await ctx.db.get(sourceMessage.conversationId);
    if (!sourceRow || sourceRow.organizationId !== args.organizationId) {
      throw new Error("Message not found");
    }
    const source = await loadEffectiveConversation(ctx, sourceRow);
    if (!source.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to forward this message");
    }
    if (sourceMessage.payslipId) {
      throw new Error("Payslip messages cannot be forwarded");
    }

    const now = Date.now();
    const messageType =
      sourceMessage.messageType === "system"
        ? ("text" as const)
        : sourceMessage.messageType;
    let sourceContent = sourceMessage.content;
    if (
      source.chatSessionKeyEnc &&
      getChatMasterSecret() &&
      isEncryptedPayload(sourceContent)
    ) {
      sourceContent = decryptUtf8(
        sourceContent,
        unwrapSessionKey(
          source.chatSessionKeyEnc,
          source.organizationId,
          source._id,
        ),
      );
    }
    const forwardedContent = `Forwarded:\n${sourceContent}`;

    let targetConv = target;
    if (
      getChatMasterSecret() &&
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

    const messageId = await ctx.db.insert("messages", {
      conversationId: args.targetConversationId,
      senderId: userRecord._id,
      content: forwardBody,
      messageType,
      createdAt: now,
    });
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message creation did not persist");
    await replaceMessageReceipts(ctx, target, message, [userRecord._id], now);
    await replaceMessageAttachments(
      ctx,
      target,
      message,
      await loadEffectiveMessageAttachments(ctx, source, sourceMessage),
      now,
    );

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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Check if user is a participant
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized");
    }

    let lastReadAt = 0;
    for (const messageId of args.messageIds) {
      const message = await ctx.db.get(messageId);
      if (message && message.conversationId === args.conversationId) {
        lastReadAt = Math.max(lastReadAt, message.createdAt);
        const readBy = await loadEffectiveMessageReadBy(ctx, conversation, message);
        if (!readBy.includes(userRecord._id)) {
          const nextReadBy = [...readBy, userRecord._id];
          await replaceMessageReceipts(
            ctx,
            conversation,
            message,
            nextReadBy,
            Date.now(),
          );
        }
      }
    }

    if (lastReadAt > 0) {
      await upsertConversationPreference(ctx, {
        organizationId: conversation.organizationId,
        userId: userRecord._id,
        conversationId: conversation._id,
        lastReadAt,
      });
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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow || conversationRow.organizationId !== args.organizationId) {
      return null;
    }
    const conv = await loadEffectiveConversation(ctx, conversationRow);
    if (conv.archivedAt !== undefined) return null;
    if (!Array.isArray(conv.participants) || conv.participants.length === 0)
      return null;

    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord || !conv.participants.includes(userRecord._id)) return null;

    // Return all participants (including current user) so members count and list are correct
    const participantUsers = await Promise.all(
      conv.participants.map((id) => ctx.db.get(id)),
    );

    const lastMessage = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conv._id)
      )
      .order("desc")
      .first();

    return {
      ...conv,
      participants: participantUsers.filter(
        (participant): participant is NonNullable<typeof participant> =>
          participant !== null,
      ),
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
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return null;

    const conversationRows = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
    const conversations = await Promise.all(
      conversationRows.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );

    const dms = conversations.filter(
      (conv) =>
        conv.type === "direct" &&
        conv.participants.length === 2 &&
        conv.participants.includes(userRecord._id) &&
        conv.participants.includes(args.participantId),
    );
    const standard = dms.find(
      (conv) => normalizedDirectKind(conv) === "standard",
    );
    return standard ?? dms[0] ?? null;
  },
});

// Get all users in organization (for creating group chats)
export const getOrganizationUsers = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    // Get all user-organization relationships for this org
    const userOrgs = (
      await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect()
    ).filter((membership) =>
      canUseFullOrganizationAccess(membership.accessStatus),
    );

    // Get user records
    const users = await Promise.all(
      userOrgs.map(async (userOrg) => {
        const user = await ctx.db.get(userOrg.userId);
        if (!user) return null;
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
    await assertActiveChatParticipants(
      ctx,
      args.organizationId,
      args.participantIds,
    );

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
      type: "group",
      name: args.name,
      createdBy: userRecord._id,
      createdAt: now,
      updatedAt: now,
    });
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation creation did not persist");
    await replaceConversationMembers(ctx, conversation, allParticipants, now);

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

    if (
      userRecord.role !== "owner" &&
      userRecord.role !== "admin" &&
      userRecord.role !== "hr"
    ) {
      throw new Error(
        "Only Owner, Admin, or HR can create official channels",
      );
    }

    const trimmedName = args.name.trim();
    if (!trimmedName) throw new Error("Channel name is required");
    if (args.scope !== "organization") {
      throw new Error("Only official organization channels are supported");
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      organizationId: args.organizationId,
      type: "channel",
      name: trimmedName,
      createdBy: userRecord._id,
      channelScope: "organization",
      createdAt: now,
      updatedAt: now,
    });
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation creation did not persist");
    await replaceConversationMembers(
      ctx,
      conversation,
      [userRecord._id],
      now,
    );

    return conversationId;
  },
});

// Join a channel (org members can join organization channels; for personal, only by invite/add)
export const joinChannel = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Channel not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
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

    const now = Date.now();
    const participants = [...conversation.participants, userRecord._id];
    await replaceConversationMembers(ctx, conversationRow, participants, now);
    await ctx.db.patch(args.conversationId, { updatedAt: now });

    return { success: true, alreadyMember: false };
  },
});

// List channels in org (joined and joinable for organization scope)
export const listChannels = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    const allChannelRows = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
    const allChannels = await Promise.all(
      allChannelRows.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );

    const channels = allChannels.filter(
      (conversation) =>
        conversation.type === "channel" &&
        conversation.archivedAt === undefined,
    );

    return channels.map((conversation) => ({
      _id: conversation._id,
      name: conversation.name,
      channelScope: conversation.channelScope,
      createdBy: conversation.createdBy,
      participantCount: conversation.participants.length,
      joined: conversation.participants.includes(userRecord._id),
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);

    const userRecord = await checkAuth(ctx, conversation.organizationId);

    // Group chats and channels can have members added
    if (conversation.type !== "group" && conversation.type !== "channel") {
      throw new Error("Can only add members to group chats or channels");
    }

    // Check if user is a participant (and optionally creator/admin)
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to add members to this conversation");
    }
    if (
      conversation.type === "channel" &&
      !canUseAdminPersona(userRecord.role)
    ) {
      throw new Error("Only Owner, Admin, or HR can manage channel members");
    }

    // Add new participants (avoid duplicates)
    const existingParticipants = new Set(conversation.participants);
    const newParticipants = args.participantIds.filter(
      (id) => !existingParticipants.has(id)
    );

    if (newParticipants.length === 0) {
      return { success: true, added: 0 };
    }

    await assertActiveChatParticipants(
      ctx,
      conversation.organizationId,
      newParticipants,
    );

    const now = Date.now();
    const participants = [...conversation.participants, ...newParticipants];
    await replaceConversationMembers(ctx, conversationRow, participants, now);
    await ctx.db.patch(args.conversationId, { updatedAt: now });

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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);

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

    const now = Date.now();
    const participants = conversation.participants.filter(
      (id) => id !== args.participantId,
    );
    await replaceConversationMembers(ctx, conversationRow, participants, now);
    await ctx.db.patch(args.conversationId, { updatedAt: now });

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
    const conversationRow = await ctx.db.get(args.conversationId);
    if (
      !conversationRow ||
      conversationRow.organizationId !== args.organizationId
    ) {
      throw new Error("Conversation not found");
    }
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to pin this conversation");
    }

    // Get or create user chat preferences
    const preferences = await ctx.db
      .query("userChatPreferences")
      .withIndex("by_user_organization", (q) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const now = Date.now();
    const pinned = await loadEffectivePinnedConversations(
      ctx,
      args.organizationId,
      userRecord._id,
    );

    if (pinned.includes(args.conversationId)) {
      // Unpin
      const updatedPinned = pinned.filter(
        (id) => id !== args.conversationId,
      );
      if (preferences) {
        await replacePinnedConversations(ctx, preferences, updatedPinned, now);
        await ctx.db.patch(preferences._id, { updatedAt: now });
      }
      return { pinned: false };
    } else {
      // Pin
      const updatedPinned = [...pinned, args.conversationId];
      if (preferences) {
        await replacePinnedConversations(ctx, preferences, updatedPinned, now);
        await ctx.db.patch(preferences._id, { updatedAt: now });
      } else {
        const preferencesId = await ctx.db.insert("userChatPreferences", {
          userId: userRecord._id,
          organizationId: args.organizationId,
          createdAt: now,
          updatedAt: now,
        });
        const createdPreferences = await ctx.db.get(preferencesId);
        if (!createdPreferences) throw new Error("Chat preferences did not persist");
        await replacePinnedConversations(
          ctx,
          createdPreferences,
          updatedPinned,
          now,
        );
      }
      return { pinned: true };
    }
  },
});

// Legacy endpoint retained for callers that previously treated delete as leave.
// Shared chat history is preserved for the remaining participants.
export const deleteConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);

    const userRecord = await checkAuth(ctx, conversation.organizationId);
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to delete this conversation");
    }

    if (conversation.type === "direct") {
      throw new Error("Direct messages cannot be deleted");
    }

    const now = Date.now();
    await replaceConversationMembers(
      ctx,
      conversationRow,
      conversation.participants.filter((id) => id !== userRecord._id),
      now,
    );

    const pin = await ctx.db
      .query("userPinnedConversations")
      .withIndex("by_user_conversation", (q) =>
        q
          .eq("userId", userRecord._id)
          .eq("conversationId", args.conversationId),
      )
      .unique();
    if (pin) await ctx.db.delete(pin._id);

    await ctx.db.patch(args.conversationId, { updatedAt: now });
    return { success: true };
  },
});

export const leaveConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
    const user = await checkAuth(ctx, conversation.organizationId);
    if (!conversation.participants.includes(user._id)) {
      throw new Error("Not authorized to leave this conversation");
    }
    if (conversation.type === "direct") {
      throw new Error("Direct messages cannot be left");
    }

    const remaining = conversation.participants.filter((id) => id !== user._id);
    const now = Date.now();
    await replaceConversationMembers(ctx, conversationRow, remaining, now);
    const nextCreator =
      conversation.type === "group" && conversation.createdBy === user._id
        ? remaining[0]
        : conversation.createdBy;
    await ctx.db.patch(args.conversationId, {
      createdBy: nextCreator,
      updatedAt: now,
    });

    const pin = await ctx.db
      .query("userPinnedConversations")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", user._id).eq("conversationId", args.conversationId),
      )
      .unique();
    if (pin) await ctx.db.delete(pin._id);
    const preference = await ctx.db
      .query("userConversationPreferences")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", user._id).eq("conversationId", args.conversationId),
      )
      .unique();
    if (preference) await ctx.db.delete(preference._id);

    return { success: true };
  },
});

export const archiveConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
    const user = await checkAuth(ctx, conversation.organizationId);
    const elevated =
      user.role === "owner" || user.role === "admin" || user.role === "hr";
    const groupCreator =
      conversation.type === "group" && conversation.createdBy === user._id;
    if (conversation.type === "direct" || (!elevated && !groupCreator)) {
      throw new Error("Not authorized to archive this conversation");
    }

    const now = Date.now();
    await ctx.db.patch(args.conversationId, {
      archivedAt: now,
      archivedBy: user._id,
      updatedAt: now,
    });
    return { success: true };
  },
});

export const setConversationMuted = mutation({
  args: {
    conversationId: v.id("conversations"),
    muted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
    const user = await checkAuth(ctx, conversation.organizationId);
    if (!conversation.participants.includes(user._id)) {
      throw new Error("Not authorized to update this conversation");
    }

    await upsertConversationPreference(ctx, {
      organizationId: conversation.organizationId,
      userId: user._id,
      conversationId: args.conversationId,
      muted: args.muted,
    });
    return { muted: args.muted };
  },
});

export const getMutedConversationIds = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await checkAuthForQuery(ctx, args.organizationId);
    if (!user) return [];
    const preferences = await ctx.db
      .query("userConversationPreferences")
      .withIndex("by_user_organization", (q) =>
        q.eq("userId", user._id).eq("organizationId", args.organizationId),
      )
      .collect();
    return preferences
      .filter((preference) => preference.muted)
      .map((preference) => preference.conversationId);
  },
});

export const getChatAttachmentUrl = query({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) throw new Error("Conversation not found");
    const conversation = await loadEffectiveConversation(ctx, conversationRow);
    const userRecord = await checkAuth(ctx, conversation.organizationId);
    if (!conversation.participants.includes(userRecord._id)) {
      throw new Error("Not authorized to view this conversation");
    }

    const message = await ctx.db.get(args.messageId);
    if (!message || message.conversationId !== args.conversationId) {
      throw new Error("Attachment not found");
    }

    const link = await ctx.db
      .query("storageObjectLinks")
      .withIndex("by_storage_parent", (q) =>
        q
          .eq("storageId", args.storageId)
          .eq("parentType", "message")
          .eq("parentId", args.messageId),
      )
      .unique();
    if (
      !link ||
      link.organizationId !== conversation.organizationId ||
      link.purpose !== "chat_attachment"
    ) {
      throw new Error("Attachment not found");
    }

    const [url, storageObject, metadata] = await Promise.all([
      ctx.storage.getUrl(args.storageId),
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
        .unique(),
      ctx.db.system.get("_storage", args.storageId),
    ]);

    return {
      url,
      contentType:
        storageObject?.contentType ?? metadata?.contentType ?? null,
    };
  },
});

// Get pinned conversations for user
export const getPinnedConversations = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return [];

    return loadEffectivePinnedConversations(
      ctx,
      args.organizationId,
      userRecord._id,
    );
  },
});

async function loadUnreadCounts(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
) {
  const conversationRows = await ctx.db
    .query("conversations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
  const conversations = await Promise.all(
    conversationRows.map((conversation) =>
      loadEffectiveConversation(ctx, conversation),
    ),
  );
  const preferences = await ctx.db
    .query("userConversationPreferences")
    .withIndex("by_user_organization", (q) =>
      q.eq("userId", userId).eq("organizationId", organizationId),
    )
    .collect();
  const lastReadByConversation = new Map(
    preferences.map((preference) => [
      preference.conversationId,
      preference.lastReadAt ?? 0,
    ]),
  );
  const counts: Record<string, number> = {};

  for (const conversation of conversations) {
    if (
      conversation.archivedAt !== undefined ||
      !conversation.participants.includes(userId)
    ) {
      continue;
    }
    const lastReadAt = lastReadByConversation.get(conversation._id) ?? 0;
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_created_at", (q) =>
        q
          .eq("conversationId", conversation._id)
          .gt("createdAt", lastReadAt),
      )
      .take(100);
    counts[conversation._id] = messages.filter(
      (message) => message.senderId !== userId,
    ).length;
  }

  return counts;
}

export const getUnreadCounts = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return {};

    return loadUnreadCounts(ctx, args.organizationId, userRecord._id);
  },
});

export const getUnreadNotificationCount = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    const user = await checkAuthForQuery(ctx, args.organizationId);
    if (!user) return 0;
    const [counts, preferences] = await Promise.all([
      loadUnreadCounts(ctx, args.organizationId, user._id),
      ctx.db
        .query("userConversationPreferences")
        .withIndex("by_user_organization", (q) =>
          q.eq("userId", user._id).eq("organizationId", args.organizationId),
        )
        .collect(),
    ]);
    const muted = new Set(
      preferences
        .filter((preference) => preference.muted)
        .map((preference) => preference.conversationId),
    );
    return Object.entries(counts).reduce(
      (total, [conversationId, count]) =>
        muted.has(conversationId as Id<"conversations">) ? total : total + count,
      0,
    );
  },
});

// Mark all messages in all conversations as read for current user
export const markAllConversationsAsRead = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const conversationRows = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();
    const conversations = await Promise.all(
      conversationRows.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );

    const userConvs = conversations.filter(
      (conversation) =>
        conversation.archivedAt === undefined &&
        conversation.participants.includes(userRecord._id),
    );
    const lastReadAt = Date.now();
    await Promise.all(
      userConvs.map((conversation) =>
        upsertConversationPreference(ctx, {
          organizationId: args.organizationId,
          userId: userRecord._id,
          conversationId: conversation._id,
          lastReadAt,
        }),
      ),
    );

    return { success: true };
  },
});

/** Raw AES-256 session key (base64) for decrypting message bodies; participant-only. */
export const getChatSessionKey = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversationRow = await ctx.db.get(args.conversationId);
    if (!conversationRow) return null;
    const conv = await loadEffectiveConversation(ctx, conversationRow);
    const userRecord = await checkAuthForQuery(ctx, conv.organizationId);
    if (!userRecord || !conv.participants.includes(userRecord._id)) return null;
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
    const userRecord = await checkAuthForQuery(ctx, args.organizationId);
    if (!userRecord) return {};
    if (!getChatMasterSecret()) return {};
    const conversationRows = await ctx.db
      .query("conversations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();
    const conversations = await Promise.all(
      conversationRows.map((conversation) =>
        loadEffectiveConversation(ctx, conversation),
      ),
    );
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
