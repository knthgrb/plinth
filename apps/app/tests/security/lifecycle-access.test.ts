import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

vi.mock("../../convex/auth", () => ({
  authComponent: {
    getAuthUser: async (ctx: {
      auth: { getUserIdentity: () => Promise<{ email?: string } | null> };
    }) => ctx.auth.getUserIdentity(),
  },
}));

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

const workday = { in: "09:00", out: "18:00", isWorkday: true };
const restDay = { in: "09:00", out: "18:00", isWorkday: false };
const defaultSchedule = {
  monday: workday,
  tuesday: workday,
  wednesday: workday,
  thursday: workday,
  friday: workday,
  saturday: restDay,
  sunday: restDay,
};

describe("employee lifecycle access", () => {
  it("links and moves the organization membership to alumni when an employee resigns", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "hr@example.com";
    const employeeEmail = "employee@example.com";

    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Lifecycle Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const hrUserId = await ctx.db.insert("users", {
        email: hrEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Employee",
          lastName: "One",
          email: employeeEmail,
        },
        employment: {
          employeeId: "EMP-001",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: {
          basicSalary: 30_000,
          salaryType: "monthly",
        },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: employeeEmail,
        employeeId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: hrUserId,
        organizationId,
        role: "hr",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const employeeMembershipId = await ctx.db.insert("userOrganizations", {
        userId: employeeUserId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });

      return { employeeId, employeeMembershipId };
    });

    await t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
      employeeId: fixture.employeeId,
      employment: {
        employeeId: "EMP-001",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        separationDate: 2,
        status: "resigned",
      },
    });

    const membership = await t.run((ctx) =>
      ctx.db.get(fixture.employeeMembershipId),
    );
    expect(membership?.employeeId).toBe(fixture.employeeId);
    expect(membership?.accessStatus).toBe("alumni");
  });

  it("does not return organization chat users to an alumni member", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "alumni@example.com";

    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Past Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const alumniUserId = await ctx.db.insert("users", {
        email: alumniEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const activeUserId = await ctx.db.insert("users", {
        email: "active@example.com",
        name: "Active Employee",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: alumniUserId,
        organizationId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: activeUserId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    const result = await t
      .withIdentity({ email: alumniEmail })
      .query(api.chat.getOrganizationUsers, { organizationId });

    expect(result).toEqual([]);
  });

  it("does not return organization notifications to an alumni member", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "alumni@example.com";

    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Past Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: alumniEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("notifications", {
        userId,
        organizationId,
        type: "leave_approved",
        title: "Leave approved",
        read: false,
        createdAt: 1,
        pathAfterOrg: "leave",
      });
      return organizationId;
    });

    const result = await t
      .withIdentity({ email: alumniEmail })
      .query(api.notifications.getUnreadNotificationCount, { organizationId });

    expect(result).toEqual({ count: 0 });
  });

  it("does not return organization announcements to an alumni member", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "alumni@example.com";

    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Past Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: alumniEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("memos", {
        organizationId,
        title: "Private announcement",
        content: "{}",
        type: "announcement",
        priority: "normal",
        author: userId,
        targetAudience: "all",
        publishedDate: 1,
        isPublished: true,
        acknowledgementRequired: false,
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    const result = await t
      .withIdentity({ email: alumniEmail })
      .query(api.announcements.getAnnouncements, { organizationId });

    expect(result).toEqual([]);
  });
});
