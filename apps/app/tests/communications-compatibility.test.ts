import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

vi.mock("../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../convex/", "./"),
    loader,
  ]),
);

async function setup() {
  const t = convexTest(schema, modules);
  const email = "communications-user@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Communications Compatibility",
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      role: "employee",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    const memoId = await ctx.db.insert("memos", {
      organizationId,
      title: "Normalized announcement",
      content: "{}",
      type: "announcement",
      priority: "normal",
      author: userId,
      targetAudience: "all",
      publishedDate: 1,
      isPublished: true,
      acknowledgementRequired: false,
      reactions: [{ userId, emoji: "legacy", createdAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("memoReactions", {
      organizationId,
      memoId,
      userId,
      emoji: "👍",
      reactedAt: 2,
      sourceIndex: 0,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { organizationId, userId, memoId };
  });
  return { t, actor: t.withIdentity({ email }), ...fixture };
}

describe("communications compatibility", () => {
  it("uses normalized reactions before conflicting embedded reactions", async () => {
    const { actor, organizationId } = await setup();
    const announcements = await actor.query(api.announcements.getAnnouncements, {
      organizationId,
    });
    expect(announcements[0]?.reactions).toEqual([
      expect.objectContaining({ emoji: "👍", createdAt: 2 }),
    ]);
  });

  it("dual-writes announcement reactions", async () => {
    const { t, actor, organizationId, userId, memoId } = await setup();
    await actor.mutation(api.announcements.addReaction, {
      announcementId: memoId,
      organizationId,
      emoji: "🎉",
    });
    const state = await t.run(async (ctx) => ({
      memo: await ctx.db.get(memoId),
      reactions: await ctx.db
        .query("memoReactions")
        .withIndex("by_memo", (q) => q.eq("memoId", memoId))
        .collect(),
    }));
    expect(state.memo?.reactions).toEqual([
      expect.objectContaining({ userId, emoji: "🎉" }),
    ]);
    expect(state.reactions.map((row) => row.emoji)).toEqual(["🎉"]);
  });

  it("uses normalized conversation members and receipts across chat queries", async () => {
    const { t, actor, organizationId, userId } = await setup();
    const { conversationId } = await t.run(async (ctx) => {
      const conversationId = await ctx.db.insert("conversations", {
        organizationId,
        participants: [],
        type: "channel",
        name: "Normalized channel",
        channelScope: "organization",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("conversationMembers", {
        organizationId,
        conversationId,
        userId,
        status: "active",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const messageId = await ctx.db.insert("messages", {
        conversationId,
        senderId: userId,
        content: "normalized receipt",
        messageType: "text",
        readBy: [],
        createdAt: 2,
      });
      await ctx.db.insert("messageReceipts", {
        organizationId,
        conversationId,
        messageId,
        userId,
        state: "read",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return { conversationId };
    });

    const [conversation, channels, unread] = await Promise.all([
      actor.query(api.chat.getConversationById, {
        organizationId,
        conversationId,
      }),
      actor.query(api.chat.listChannels, { organizationId }),
      actor.query(api.chat.getUnreadCounts, { organizationId }),
    ]);

    expect(conversation?._id).toBe(conversationId);
    expect(channels).toEqual([
      expect.objectContaining({ _id: conversationId, joined: true }),
    ]);
    expect(unread[conversationId]).toBe(0);
  });

  it("removes normalized chat children when deleting a conversation", async () => {
    const { t, actor, organizationId, userId } = await setup();
    const fixture = await t.run(async (ctx) => {
      const conversationId = await ctx.db.insert("conversations", {
        organizationId,
        participants: [userId],
        type: "group",
        createdAt: 1,
        updatedAt: 1,
      });
      const memberId = await ctx.db.insert("conversationMembers", {
        organizationId,
        conversationId,
        userId,
        status: "active",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const messageId = await ctx.db.insert("messages", {
        conversationId,
        senderId: userId,
        content: "delete me",
        messageType: "text",
        readBy: [userId],
        createdAt: 2,
      });
      const receiptId = await ctx.db.insert("messageReceipts", {
        organizationId,
        conversationId,
        messageId,
        userId,
        state: "read",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      const preferencesId = await ctx.db.insert("userChatPreferences", {
        userId,
        organizationId,
        pinnedConversations: [conversationId],
        createdAt: 1,
        updatedAt: 1,
      });
      const pinId = await ctx.db.insert("userPinnedConversations", {
        organizationId,
        userId,
        conversationId,
        sourcePreferencesId: preferencesId,
        position: 0,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return { conversationId, memberId, receiptId, pinId };
    });

    await actor.mutation(api.chat.deleteConversation, {
      conversationId: fixture.conversationId,
    });

    const remaining = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(fixture.conversationId),
      member: await ctx.db.get(fixture.memberId),
      receipt: await ctx.db.get(fixture.receiptId),
      pin: await ctx.db.get(fixture.pinId),
    }));
    expect(remaining).toEqual({
      conversation: null,
      member: null,
      receipt: null,
      pin: null,
    });
  });

  it("rejects pinning a conversation from another organization", async () => {
    const { t, actor, organizationId, userId } = await setup();
    const otherConversationId = await t.run(async (ctx) => {
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("conversations", {
        organizationId: otherOrganizationId,
        participants: [userId],
        type: "direct",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      actor.mutation(api.chat.togglePinConversation, {
        organizationId,
        conversationId: otherConversationId,
      }),
    ).rejects.toThrow("Conversation not found");
  });
});
