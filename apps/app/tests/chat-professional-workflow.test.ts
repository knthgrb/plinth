import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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

const getChatAttachmentUrl = makeFunctionReference<
  "query",
  {
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    storageId: Id<"_storage">;
  },
  { url: string | null; contentType: string | null }
>("chat:getChatAttachmentUrl");

const toggleMessageReaction = makeFunctionReference<
  "mutation",
  { messageId: Id<"messages">; emoji: string },
  { active: boolean }
>("chat:toggleMessageReaction");

const editMessage = makeFunctionReference<
  "mutation",
  { messageId: Id<"messages">; content: string },
  { success: boolean }
>("chat:editMessage");

const deleteMessage = makeFunctionReference<
  "mutation",
  { messageId: Id<"messages"> },
  { success: boolean }
>("chat:deleteMessage");

const leaveConversation = makeFunctionReference<
  "mutation",
  { conversationId: Id<"conversations"> },
  { success: boolean }
>("chat:leaveConversation");

const archiveConversation = makeFunctionReference<
  "mutation",
  { conversationId: Id<"conversations"> },
  { success: boolean }
>("chat:archiveConversation");

const setConversationMuted = makeFunctionReference<
  "mutation",
  { conversationId: Id<"conversations">; muted: boolean },
  { muted: boolean }
>("chat:setConversationMuted");

const getMutedConversationIds = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  Id<"conversations">[]
>("chat:getMutedConversationIds");

const getUnreadNotificationCount = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  number
>("chat:getUnreadNotificationCount");

type Role = "owner" | "admin" | "hr" | "manager" | "accounting" | "employee";

const defaultSchedule = Object.fromEntries(
  [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].map((day) => [
    day,
    {
      in: "09:00",
      out: "18:00",
      isWorkday: !["saturday", "sunday"].includes(day),
    },
  ]),
) as {
  monday: { in: string; out: string; isWorkday: boolean };
  tuesday: { in: string; out: string; isWorkday: boolean };
  wednesday: { in: string; out: string; isWorkday: boolean };
  thursday: { in: string; out: string; isWorkday: boolean };
  friday: { in: string; out: string; isWorkday: boolean };
  saturday: { in: string; out: string; isWorkday: boolean };
  sunday: { in: string; out: string; isWorkday: boolean };
};

async function setupOrganization() {
  const t = convexTest(schema, modules);
  const actors = {
    owner: "chat-owner@example.com",
    hr: "chat-hr@example.com",
    employee: "chat-employee@example.com",
    outsider: "chat-outsider@example.com",
    alumni: "chat-alumni@example.com",
  } as const;

  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Professional Chat Org",
      createdAt: 1,
      updatedAt: 1,
    });

    const memberships: Array<{
      email: string;
      role: Role;
      accessStatus: "active" | "alumni";
    }> = [
      { email: actors.owner, role: "owner", accessStatus: "active" },
      { email: actors.hr, role: "hr", accessStatus: "active" },
      { email: actors.employee, role: "employee", accessStatus: "active" },
      { email: actors.outsider, role: "employee", accessStatus: "active" },
      { email: actors.alumni, role: "employee", accessStatus: "alumni" },
    ];

    const users = new Map<string, Id<"users">>();
    for (const membership of memberships) {
      const userId = await ctx.db.insert("users", {
        email: membership.email,
        name: membership.email.split("@")[0],
        createdAt: 1,
        updatedAt: 1,
      });
      users.set(membership.email, userId);
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: membership.role,
        accessStatus: membership.accessStatus,
        joinedAt: 1,
        updatedAt: 1,
      });
    }

    return {
      organizationId,
      ownerId: users.get(actors.owner)!,
      employeeId: users.get(actors.employee)!,
      outsiderId: users.get(actors.outsider)!,
    };
  });

  return { t, actors, ...fixture };
}

describe("professional organization chat", () => {
  it("allows only Owner, Admin, and HR to create official channels", async () => {
    const { t, actors, organizationId } = await setupOrganization();

    await expect(
      t.withIdentity({ email: actors.employee }).mutation(api.chat.createChannel, {
        organizationId,
        name: "employee-created",
        scope: "organization",
      }),
    ).rejects.toThrow("Only Owner, Admin, or HR can create official channels");

    await expect(
      t.withIdentity({ email: actors.hr }).mutation(api.chat.createChannel, {
        organizationId,
        name: "people-updates",
        scope: "organization",
      }),
    ).resolves.toBeDefined();

    await expect(
      t.withIdentity({ email: actors.hr }).mutation(api.chat.createChannel, {
        organizationId,
        name: "hidden-channel",
        scope: "personal",
      }),
    ).rejects.toThrow("Only official organization channels are supported");
  });

  it("restricts official channel membership management to Owner, Admin, and HR", async () => {
    const { t, actors, organizationId, employeeId, outsiderId } =
      await setupOrganization();
    const hr = t.withIdentity({ email: actors.hr });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await hr.mutation(api.chat.createChannel, {
      organizationId,
      name: "operations-updates",
      scope: "organization",
    });
    await employee.mutation(api.chat.joinChannel, { conversationId });

    await expect(
      employee.mutation(api.chat.addMembersToGroup, {
        conversationId,
        participantIds: [outsiderId],
      }),
    ).rejects.toThrow("Only Owner, Admin, or HR can manage channel members");

    await expect(
      hr.mutation(api.chat.addMembersToGroup, {
        conversationId,
        participantIds: [employeeId, outsiderId],
      }),
    ).resolves.toEqual({ success: true, added: 1 });
  });

  it("prevents a former elevated member from continuing to message as Admin", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const hr = t.withIdentity({ email: actors.hr });
    const conversationId = await hr.mutation(api.chat.getOrCreateConversation, {
      organizationId,
      participantId: employeeId,
      directThreadKind: "staff_as_admin",
    });

    await t.run(async (ctx) => {
      const hrUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", actors.hr))
        .unique();
      if (!hrUser) throw new Error("HR user not found");
      const membership = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (q) =>
          q.eq("userId", hrUser._id).eq("organizationId", organizationId),
        )
        .unique();
      if (!membership) throw new Error("HR membership not found");
      await ctx.db.patch(membership._id, { role: "manager" });
    });

    await expect(
      hr.mutation(api.chat.sendMessage, {
        conversationId,
        content: "Still presented as Admin",
      }),
    ).rejects.toThrow("Only Owner, Admin, or HR can message as Admin");
  });

  it("preserves shared history when a participant removes a conversation", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Operations",
      participantIds: [employeeId],
    });
    const messageId = await owner.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Retained record",
    });

    await t
      .withIdentity({ email: actors.employee })
      .mutation(api.chat.deleteConversation, { conversationId });

    const state = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(conversationId),
      message: await ctx.db.get(messageId),
      membership: await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation_user", (q) =>
          q.eq("conversationId", conversationId).eq("userId", employeeId),
        )
        .unique(),
    }));

    expect(state.conversation).not.toBeNull();
    expect(state.message?.content).toBeTruthy();
    expect(state.membership).toBeNull();
  });

  it("serves chat attachments only to participants in the linked conversation", async () => {
    const {
      t,
      actors,
      organizationId,
      ownerId,
      employeeId,
    } = await setupOrganization();

    const fixture = await t.run(async (ctx) => {
      const conversationId = await ctx.db.insert("conversations", {
        organizationId,
        type: "direct",
        createdAt: 1,
        updatedAt: 1,
      });
      for (const [sourceIndex, userId] of [ownerId, employeeId].entries()) {
        await ctx.db.insert("conversationMembers", {
          organizationId,
          conversationId,
          userId,
          status: "active",
          sourceIndex,
          migrationVersion: 1,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      const storageId = await ctx.storage.store(
        new Blob(["private attachment"], { type: "text/plain" }),
      );
      const messageId = await ctx.db.insert("messages", {
        conversationId,
        senderId: ownerId,
        content: "Attachment",
        messageType: "file",
        createdAt: 2,
      });
      await ctx.db.insert("storageObjectLinks", {
        organizationId,
        storageId,
        parentType: "message",
        parentId: messageId,
        purpose: "chat_attachment",
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 2,
        updatedAt: 2,
      });
      return { conversationId, messageId, storageId };
    });

    await expect(
      t.withIdentity({ email: actors.employee }).query(getChatAttachmentUrl, fixture),
    ).resolves.toMatchObject({ url: expect.stringMatching(/^https:\/\//) });

    await expect(
      t.withIdentity({ email: actors.outsider }).query(getChatAttachmentUrl, fixture),
    ).rejects.toThrow("Not authorized to view this conversation");

    await expect(
      t.withIdentity({ email: actors.alumni }).query(getChatAttachmentUrl, fixture),
    ).rejects.toThrow("Not authorized");

    await t.withIdentity({ email: actors.owner }).mutation(deleteMessage, {
      messageId: fixture.messageId,
    });
    await expect(
      t.withIdentity({ email: actors.employee }).query(getChatAttachmentUrl, fixture),
    ).rejects.toThrow("Attachment not found");
  });

  it("toggles one reaction per user and exposes reactions with messages", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Recognition",
      participantIds: [employeeId],
    });
    const messageId = await owner.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Excellent work",
    });

    await expect(
      employee.mutation(toggleMessageReaction, { messageId, emoji: "🎉" }),
    ).resolves.toEqual({ active: true });

    const withReaction = await employee.query(api.chat.getMessages, {
      conversationId,
    });
    expect(withReaction.messages[0]).toMatchObject({
      reactions: [{ emoji: "🎉", userId: employeeId }],
    });

    await expect(
      employee.mutation(toggleMessageReaction, { messageId, emoji: "🎉" }),
    ).resolves.toEqual({ active: false });
    const withoutReaction = await employee.query(api.chat.getMessages, {
      conversationId,
    });
    expect(withoutReaction.messages[0]).toMatchObject({ reactions: [] });
  });

  it("allows authors to edit messages and preserves deletions as tombstones", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Project",
      participantIds: [employeeId],
    });
    const messageId = await employee.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Initial wording",
    });

    await expect(
      owner.mutation(editMessage, { messageId, content: "Impersonated edit" }),
    ).rejects.toThrow("Only the author can edit this message");

    await employee.mutation(editMessage, {
      messageId,
      content: "Corrected wording",
    });
    await employee.mutation(deleteMessage, { messageId });

    const deleted = await t.run((ctx) => ctx.db.get(messageId));
    expect(deleted).toMatchObject({
      content: "",
      deletedBy: employeeId,
      deletionKind: "author",
    });
    expect(deleted?.editedAt).toBeTypeOf("number");
    expect(deleted?.deletedAt).toBeTypeOf("number");
  });

  it("lets elevated staff moderate with an attributed tombstone", async () => {
    const { t, actors, organizationId, ownerId } =
      await setupOrganization();
    const employee = t.withIdentity({ email: actors.employee });
    const owner = t.withIdentity({ email: actors.owner });
    const conversationId = await employee.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Team",
      participantIds: [ownerId],
    });
    const messageId = await employee.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Remove this",
    });

    await owner.mutation(deleteMessage, { messageId });

    await expect(t.run((ctx) => ctx.db.get(messageId))).resolves.toMatchObject({
      content: "",
      deletedBy: ownerId,
      deletionKind: "moderator",
    });
  });

  it("supports leaving conversations, archiving managed channels, and personal mute state", async () => {
    const { t, actors, organizationId } = await setupOrganization();
    const hr = t.withIdentity({ email: actors.hr });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await hr.mutation(api.chat.createChannel, {
      organizationId,
      name: "company-news",
      scope: "organization",
    });
    await employee.mutation(api.chat.joinChannel, { conversationId });

    await employee.mutation(setConversationMuted, {
      conversationId,
      muted: true,
    });
    await expect(
      employee.query(getMutedConversationIds, { organizationId }),
    ).resolves.toEqual([conversationId]);

    await expect(
      employee.mutation(archiveConversation, { conversationId }),
    ).rejects.toThrow("Not authorized to archive this conversation");
    await employee.mutation(leaveConversation, { conversationId });

    const leftConversation = await employee.query(api.chat.getConversationById, {
      organizationId,
      conversationId,
    });
    expect(leftConversation).toBeNull();

    await hr.mutation(archiveConversation, { conversationId });
    const archived = await t.run((ctx) => ctx.db.get(conversationId));
    expect(archived?.archivedAt).toBeTypeOf("number");
    expect(archived?.archivedBy).toBeDefined();
  });

  it("rejects spoofed system messages, blank content, and cross-organization payslip links", async () => {
    const { t, actors, organizationId, employeeId, ownerId } =
      await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Secure messages",
      participantIds: [employeeId],
    });

    await expect(
      owner.mutation(api.chat.sendMessage, {
        conversationId,
        content: "Forged event",
        messageType: "system",
      }),
    ).rejects.toThrow("System messages cannot be sent by users");

    await expect(
      owner.mutation(api.chat.sendMessage, {
        conversationId,
        content: "   ",
      }),
    ).rejects.toThrow("Message content is required");

    const foreignPayslipId = await t.run(async (ctx) => {
      const foreignOrganizationId = await ctx.db.insert("organizations", {
        name: "Foreign org",
        createdAt: 1,
        updatedAt: 1,
      });
      const foreignEmployeeId = await ctx.db.insert("employees", {
        organizationId: foreignOrganizationId,
        personalInfo: {
          firstName: "Foreign",
          lastName: "Employee",
          email: "foreign-employee@example.com",
        },
        employment: {
          employeeId: "FOREIGN-1",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 1, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      const payrollRunId = await ctx.db.insert("payrollRuns", {
        organizationId: foreignOrganizationId,
        cutoffStart: 1,
        cutoffEnd: 2,
        period: "Foreign period",
        status: "draft",
        processedBy: ownerId,
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("payslips", {
        organizationId: foreignOrganizationId,
        employeeId: foreignEmployeeId,
        payrollRunId,
        period: "Foreign period",
        grossPay: 0,
        deductions: [],
        netPay: 0,
        daysWorked: 0,
        absences: 0,
        lateHours: 0,
        undertimeHours: 0,
        overtimeHours: 0,
        createdAt: 1,
      });
    });

    await expect(
      owner.mutation(api.chat.sendMessage, {
        conversationId,
        content: "Foreign payslip",
        payslipId: foreignPayslipId,
      }),
    ).rejects.toThrow("Payslip does not belong to this organization");
  });

  it("keeps unread state visible in chat while excluding muted conversations from notifications", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Muted updates",
      participantIds: [employeeId],
    });
    await owner.mutation(api.chat.sendMessage, {
      conversationId,
      content: "First unread message",
    });
    await owner.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Second unread message",
    });

    expect(
      (await employee.query(api.chat.getUnreadCounts, { organizationId }))[
        conversationId
      ],
    ).toBe(2);

    await employee.mutation(setConversationMuted, {
      conversationId,
      muted: true,
    });
    await expect(
      employee.query(getUnreadNotificationCount, { organizationId }),
    ).resolves.toBe(0);

    await employee.mutation(setConversationMuted, {
      conversationId,
      muted: false,
    });
    await expect(
      employee.query(getUnreadNotificationCount, { organizationId }),
    ).resolves.toBe(2);
  });

  it("clears a sender's unread badge when they reply in the conversation", async () => {
    const { t, actors, organizationId, employeeId } = await setupOrganization();
    const owner = t.withIdentity({ email: actors.owner });
    const employee = t.withIdentity({ email: actors.employee });
    const conversationId = await owner.mutation(api.chat.createGroupChat, {
      organizationId,
      name: "Active conversation",
      participantIds: [employeeId],
    });

    await owner.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Can you review this?",
    });
    expect(
      (await employee.query(api.chat.getUnreadCounts, { organizationId }))[
        conversationId
      ],
    ).toBe(1);

    await employee.mutation(api.chat.sendMessage, {
      conversationId,
      content: "Reviewed.",
    });

    expect(
      (await employee.query(api.chat.getUnreadCounts, { organizationId }))[
        conversationId
      ],
    ).toBe(0);
    expect(
      (await owner.query(api.chat.getUnreadCounts, { organizationId }))[
        conversationId
      ],
    ).toBe(1);
  });
});
