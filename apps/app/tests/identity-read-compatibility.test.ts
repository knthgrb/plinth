import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
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

const insertEmployee = (
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  employeeNumber: string,
  email: string,
) => {
  const workday = { in: "09:00", out: "18:00", isWorkday: true };
  return ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: employeeNumber,
      lastName: "Employee",
      email,
    },
    employment: {
      employeeId: employeeNumber,
      position: "Analyst",
      department: "Operations",
      employmentType: "regular",
      hireDate: 1,
      status: "active",
    },
    compensation: { basicSalary: 30_000, salaryType: "monthly" },
    schedule: {
      defaultSchedule: {
        monday: workday,
        tuesday: workday,
        wednesday: workday,
        thursday: workday,
        friday: workday,
        saturday: { ...workday, isWorkday: false },
        sunday: { ...workday, isWorkday: false },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  });
};

describe("identity normalized-first reads", () => {
  it("uses the membership employee link for announcement audience filtering", async () => {
    const t = convexTest(schema, modules);
    const email = "announcement-employee@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Announcement Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const canonicalEmployeeId = await insertEmployee(
        ctx,
        organizationId,
        "CANONICAL",
        email,
      );
      const legacyEmployeeId = await insertEmployee(
        ctx,
        organizationId,
        "LEGACY",
        "legacy-link@example.com",
      );
      const userId = await ctx.db.insert("users", {
        email,
        organizationId,
        role: "admin",
        employeeId: legacyEmployeeId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId: canonicalEmployeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("memos", {
        organizationId,
        title: "Not for the signed-in employee",
        content: "Private audience",
        type: "announcement",
        priority: "normal",
        author: userId,
        targetAudience: "specific-employees",
        specificEmployees: [legacyEmployeeId],
        publishedDate: 1,
        isPublished: true,
        acknowledgementRequired: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, legacyEmployeeId };
    });

    await expect(
      t.withIdentity({ email }).query(api.announcements.getAnnouncements, {
        organizationId: fixture.organizationId,
        employeeId: fixture.legacyEmployeeId,
      }),
    ).resolves.toEqual([]);
  });

  it("resolves chat users from the organization membership before legacy employee fields", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "chat-actor@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Chat Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await insertEmployee(
        ctx,
        organizationId,
        "CHAT-001",
        "chat-recipient@example.com",
      );
      const actorId = await ctx.db.insert("users", {
        email: actorEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: actorId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const legacyUserId = await ctx.db.insert("users", {
        email: "legacy-chat-link@example.com",
        employeeId,
        createdAt: 1,
        updatedAt: 1,
      });
      const canonicalUserId = await ctx.db.insert("users", {
        email: "canonical-chat-link@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: canonicalUserId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, employeeId, canonicalUserId, legacyUserId };
    });

    const result = await t.withIdentity({ email: actorEmail }).query(
      api.chat.getUserByEmployeeId,
      {
        organizationId: fixture.organizationId,
        employeeId: fixture.employeeId,
      },
    );
    expect(result?._id).toBe(fixture.canonicalUserId);
    expect(result?._id).not.toBe(fixture.legacyUserId);
  });

  it("excludes globally inactive users from chat recipients", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "active-chat-user@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Inactive Recipient Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const actorId = await ctx.db.insert("users", {
        email: actorEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: actorId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const inactiveUserId = await ctx.db.insert("users", {
        email: "inactive-chat-user@example.com",
        isActive: false,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: inactiveUserId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId };
    });
    const actor = t.withIdentity({ email: actorEmail });

    await expect(
      actor.query(api.chat.getOrganizationUsers, {
        organizationId: fixture.organizationId,
      }),
    ).resolves.toEqual([]);
    await expect(
      actor.query(api.chat.getPayrollAppealRecipient, {
        organizationId: fixture.organizationId,
      }),
    ).resolves.toBeNull();
  });

  it("rejects chat participants without an active membership in the organization", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "chat-tenant-actor@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Actor Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const actorId = await ctx.db.insert("users", {
        email: actorEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: actorId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "other-tenant-chat-user@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: otherUserId,
        organizationId: otherOrganizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, otherUserId };
    });
    const actor = t.withIdentity({ email: actorEmail });

    await expect(
      actor.mutation(api.chat.getOrCreateConversation, {
        organizationId: fixture.organizationId,
        participantId: fixture.otherUserId,
      }),
    ).rejects.toThrow("Chat participant is not active in this organization");
    await expect(
      actor.mutation(api.chat.createGroupChat, {
        organizationId: fixture.organizationId,
        name: "Cross-tenant group",
        participantIds: [fixture.otherUserId],
      }),
    ).rejects.toThrow("Chat participant is not active in this organization");
  });
});
