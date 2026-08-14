import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
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

const defaultSchedule = {
  monday: { in: "09:00", out: "18:00", isWorkday: true },
  tuesday: { in: "09:00", out: "18:00", isWorkday: true },
  wednesday: { in: "09:00", out: "18:00", isWorkday: true },
  thursday: { in: "09:00", out: "18:00", isWorkday: true },
  friday: { in: "09:00", out: "18:00", isWorkday: true },
  saturday: { in: "09:00", out: "18:00", isWorkday: false },
  sunday: { in: "09:00", out: "18:00", isWorkday: false },
};

type MemberFixture = {
  userId: Id<"users">;
  employeeId: Id<"employees">;
  email: string;
};

async function setup() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Professional Announcements",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

    const addMember = async (
      email: string,
      firstName: string,
      lastName: string,
      role: Doc<"userOrganizations">["role"],
    ): Promise<MemberFixture> => {
      const userId = await ctx.db.insert("users", {
        email,
        normalizedEmail: email,
        name: `${firstName} Account`,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName,
          lastName,
          email,
        },
        employment: {
          employeeId: `${firstName.slice(0, 1)}-${lastName}`,
          position: "Team member",
          department: lastName === "Other" ? "Finance" : "People",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: {
          basicSalary: 50_000,
          salaryType: "monthly",
        },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role,
        accessStatus: "active",
        employeeId,
        joinedAt: 1,
        updatedAt: 1,
      });
      return { userId, employeeId, email };
    };

    return {
      organizationId,
      owner: await addMember(
        "owner@example.com",
        "Olivia",
        "Owner",
        "owner",
      ),
      target: await addMember(
        "target@example.com",
        "Mina",
        "Member",
        "employee",
      ),
      other: await addMember(
        "other@example.com",
        "Otto",
        "Other",
        "employee",
      ),
    };
  });

  return {
    t,
    ...fixture,
    ownerActor: t.withIdentity({ email: fixture.owner.email }),
    targetActor: t.withIdentity({ email: fixture.target.email }),
    otherActor: t.withIdentity({ email: fixture.other.email }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("professional announcement workflow", () => {
  it("publishes a scheduled announcement through a durable scheduled transition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T02:00:00.000Z"));
    const { t, ownerActor, targetActor, organizationId } = await setup();
    const publishAt = Date.now() + 60_000;

    const announcementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "Scheduled update",
        content: "Scheduled content",
        targetAudience: "all",
        scheduledPublishDate: publishAt,
        postAs: "admin",
      },
    );

    const before = await t.run((ctx) => ctx.db.get(announcementId));
    expect(before?.isPublished).toBe(false);
    expect(
      await targetActor.query(api.announcements.getAnnouncements, {
        organizationId,
      }),
    ).toHaveLength(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await t.run((ctx) => ctx.db.get(announcementId));
    expect(after?.isPublished).toBe(true);
    expect(
      await targetActor.query(api.announcements.getAnnouncements, {
        organizationId,
      }),
    ).toEqual([
      expect.objectContaining({
        _id: announcementId,
        publicationStatus: "published",
      }),
    ]);
  });

  it("enforces the selected audience on direct comments and reactions", async () => {
    const {
      t,
      organizationId,
      owner,
      target,
      targetActor,
      otherActor,
    } = await setup();
    const announcementId = await t.run(async (ctx) => {
      const memoId = await ctx.db.insert("memos", {
        organizationId,
        title: "Private update",
        content: "For one employee",
        type: "announcement",
        priority: "normal",
        author: owner.userId,
        authorDisplayName: "Admin",
        targetAudience: "specific-employees",
        publishedDate: 1,
        isPublished: true,
        acknowledgementRequired: false,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("memoAudienceMembers", {
        organizationId,
        memoId,
        audienceType: "employee",
        employeeId: target.employeeId,
        sourceIndex: 0,
        migrationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      return memoId;
    });

    expect(
      await targetActor.query(api.announcements.getAnnouncements, {
        organizationId,
      }),
    ).toHaveLength(1);
    expect(
      await otherActor.query(api.announcements.getAnnouncements, {
        organizationId,
      }),
    ).toHaveLength(0);
    await expect(
      otherActor.mutation(api.announcements.addComment, {
        announcementId,
        organizationId,
        content: "I should not see this",
      }),
    ).rejects.toThrow("Announcement not found");
    await expect(
      otherActor.mutation(api.announcements.addReaction, {
        announcementId,
        organizationId,
        emoji: "👍",
      }),
    ).rejects.toThrow("Announcement not found");
  });

  it("enforces the selected audience on attachments with missing MIME metadata", async () => {
    const {
      t,
      organizationId,
      target,
      ownerActor,
      targetActor,
      otherActor,
    } = await setup();
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["announcement image"])),
    );
    const announcementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "Private attachment",
        content: "For one employee",
        targetAudience: "specific-employees",
        specificEmployees: [target.employeeId],
        attachments: [storageId],
      },
    );

    expect(
      await targetActor.query(
        api.announcements.getAnnouncementAttachmentUrl,
        { organizationId, announcementId, storageId },
      ),
    ).toMatch(/^https?:\/\//);
    await expect(
      otherActor.query(api.announcements.getAnnouncementAttachmentUrl, {
        organizationId,
        announcementId,
        storageId,
      }),
    ).rejects.toThrow("Announcement not found");
  });

  it("uses the linked employee identity when privileged users choose it", async () => {
    const { ownerActor, organizationId } = await setup();
    const announcementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "People update",
        content: "Posted by an employee persona",
        targetAudience: "all",
        postAs: "employee",
      },
    );
    await ownerActor.mutation(api.announcements.addComment, {
      announcementId,
      organizationId,
      content: "Employee persona comment",
      commentAs: "employee",
    });

    const [announcement] = await ownerActor.query(
      api.announcements.getAnnouncements,
      { organizationId },
    );
    const [comment] = await ownerActor.query(api.announcements.getComments, {
      announcementId,
      organizationId,
    });

    expect(announcement?.authorName).toBe("Olivia Owner");
    expect(announcement?.authorPersona).toBe("employee");
    expect(comment?.authorName).toBe("Olivia Owner");
    expect(comment?.authorPersona).toBe("employee");
  });

  it("defaults privileged announcements and comments to Admin", async () => {
    const { ownerActor, organizationId } = await setup();
    const announcementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "Admin update",
        content: "Official message",
        targetAudience: "all",
      },
    );
    await ownerActor.mutation(api.announcements.addComment, {
      announcementId,
      organizationId,
      content: "Official response",
    });

    const [announcement] = await ownerActor.query(
      api.announcements.getAnnouncements,
      { organizationId },
    );
    const [comment] = await ownerActor.query(api.announcements.getComments, {
      announcementId,
      organizationId,
    });

    expect(announcement?.authorName).toBe("Admin");
    expect(comment?.authorName).toBe("Admin");
  });

  it("persists nested comment replies and returns their thread relationships", async () => {
    const { ownerActor, targetActor, organizationId } = await setup();
    const announcementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "Threaded discussion",
        content: "Share questions below",
        targetAudience: "all",
      },
    );
    const parentCommentId = await targetActor.mutation(
      api.announcements.addComment,
      {
        announcementId,
        organizationId,
        content: "Can you clarify the deadline?",
      },
    );
    const replyId = await ownerActor.mutation(api.announcements.addComment, {
      announcementId,
      organizationId,
      content: "The deadline is Friday.",
      parentCommentId,
    });
    const nestedReplyId = await targetActor.mutation(
      api.announcements.addComment,
      {
        announcementId,
        organizationId,
        content: "Thank you!",
        parentCommentId: replyId,
      },
    );

    const comments = await targetActor.query(api.announcements.getComments, {
      announcementId,
      organizationId,
    });

    expect(comments).toEqual([
      expect.objectContaining({
        _id: parentCommentId,
        content: "Can you clarify the deadline?",
      }),
      expect.objectContaining({
        _id: replyId,
        content: "The deadline is Friday.",
        parentCommentId,
      }),
      expect.objectContaining({
        _id: nestedReplyId,
        content: "Thank you!",
        parentCommentId: replyId,
      }),
    ]);
    expect(comments[0]).not.toHaveProperty("parentCommentId");
  });

  it("rejects replies to comments from another announcement", async () => {
    const { ownerActor, organizationId } = await setup();
    const firstAnnouncementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "First update",
        content: "First discussion",
        targetAudience: "all",
      },
    );
    const secondAnnouncementId = await ownerActor.mutation(
      api.announcements.createAnnouncement,
      {
        organizationId,
        title: "Second update",
        content: "Second discussion",
        targetAudience: "all",
      },
    );
    const firstCommentId = await ownerActor.mutation(
      api.announcements.addComment,
      {
        announcementId: firstAnnouncementId,
        organizationId,
        content: "Only belongs to the first announcement",
      },
    );

    await expect(
      ownerActor.mutation(api.announcements.addComment, {
        announcementId: secondAnnouncementId,
        organizationId,
        content: "Invalid reply",
        parentCommentId: firstCommentId,
      }),
    ).rejects.toThrow("Reply target not found");
  });

  it("keeps announcement writes inside the dedicated announcement module", async () => {
    const { ownerActor, organizationId } = await setup();

    await expect(
      ownerActor.mutation(api.memos.createMemo, {
        organizationId,
        title: "Legacy announcement",
        content: "Legacy path",
        type: "announcement",
        priority: "normal",
        targetAudience: "all",
        acknowledgementRequired: true,
        isPublished: true,
      }),
    ).rejects.toThrow("Use the announcements module");
  });

  it("rejects legacy memo mutations for existing announcements", async () => {
    const { t, ownerActor, organizationId, owner, target } = await setup();
    const announcementIds = await t.run(async (ctx) => {
      const ids: Id<"memos">[] = [];
      for (const title of ["Update", "Publish", "Acknowledge", "Delete"]) {
        ids.push(
          await ctx.db.insert("memos", {
            organizationId,
            title,
            content: "Dedicated module only",
            type: "announcement",
            priority: "normal",
            author: owner.userId,
            targetAudience: "all",
            publishedDate: 1,
            isPublished: true,
            acknowledgementRequired: false,
            createdAt: 1,
            updatedAt: 1,
          }),
        );
      }
      return ids;
    });

    await expect(
      ownerActor.mutation(api.memos.updateMemo, {
        memoId: announcementIds[0]!,
        acknowledgementRequired: true,
      }),
    ).rejects.toThrow("Use the announcements module");
    await expect(
      ownerActor.mutation(api.memos.publishMemo, {
        memoId: announcementIds[1]!,
      }),
    ).rejects.toThrow("Use the announcements module");
    await expect(
      ownerActor.mutation(api.memos.acknowledgeMemo, {
        memoId: announcementIds[2]!,
        employeeId: target.employeeId,
      }),
    ).rejects.toThrow("Use the announcements module");
    await expect(
      ownerActor.mutation(api.memos.deleteMemo, {
        memoId: announcementIds[3]!,
      }),
    ).rejects.toThrow("Use the announcements module");
  });
});
