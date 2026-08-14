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
  it("creates an employee record without creating a user account or membership", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "employee-only-hr@example.com";
    const employeeEmail = "employee-only@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Employee-only Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const hrUserId = await ctx.db.insert("users", {
        email: hrEmail,
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
      return organizationId;
    });

    const employeeId = await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.createEmployee, {
        organizationId,
        personalInfo: {
          firstName: "Employee",
          lastName: "Only",
          email: employeeEmail,
        },
        employment: {
          employeeId: "TEMP",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
      });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(employeeId),
      user: await ctx.db
        .query("users")
        .withIndex("by_email", (query) => query.eq("email", employeeEmail))
        .unique(),
      linkedMemberships: await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization_employee", (query) =>
          query
            .eq("organizationId", organizationId)
            .eq("employeeId", employeeId),
        )
        .collect(),
    }));
    expect(state.employee?.personalInfo.email).toBe(employeeEmail);
    expect(state.user).toBeNull();
    expect(state.linkedMemberships).toEqual([]);
  });

  it("soft-removes membership without deleting its linked employee record", async () => {
    const t = convexTest(schema, modules);
    const ownerEmail = "remove-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Soft Membership Removal Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const ownerUserId = await ctx.db.insert("users", {
        email: ownerEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: ownerUserId,
        organizationId,
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Linked",
          lastName: "Employee",
          email: "linked-remove@example.com",
        },
        employment: {
          employeeId: "EMP-LINKED",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: "linked-remove@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId: employeeUserId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, employeeId, employeeUserId, membershipId };
    });

    await t
      .withIdentity({ email: ownerEmail })
      .mutation(api.organizations.removeUserFromOrganization, {
        organizationId: fixture.organizationId,
        userId: fixture.employeeUserId,
      });

    await expect(
      t
        .withIdentity({ email: ownerEmail })
        .mutation(api.organizations.updateUserRoleInOrganization, {
          organizationId: fixture.organizationId,
          userId: fixture.employeeUserId,
          role: "manager",
        }),
    ).rejects.toThrow("Removed members must rejoin through an invitation");

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(fixture.employeeId),
      membership: await ctx.db.get(fixture.membershipId),
      user: await ctx.db.get(fixture.employeeUserId),
    }));
    expect(state.employee?._id).toBe(fixture.employeeId);
    expect(state.user?._id).toBe(fixture.employeeUserId);
    expect(state.membership).toMatchObject({
      employeeId: fixture.employeeId,
      accessStatus: "removed",
    });
  });

  it("does not authorize a user without an organization membership", async () => {
    const t = convexTest(schema, modules);
    const email = "legacy-admin@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Canonical membership organization",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    await expect(
      t.withIdentity({ email }).query(api.settings.getSettings, {
        organizationId,
      }),
    ).rejects.toThrow("Organization access is limited or inactive");
    await expect(
      t.withIdentity({ email }).query(api.organizations.getUserOrganizations, {}),
    ).resolves.toEqual([]);
    await expect(
      t.withIdentity({ email }).mutation(api.organizations.updateOrganization, {
        organizationId,
        name: "Unauthorized rename",
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("lets authenticated accounts create organizations regardless of current membership", async () => {
    const t = convexTest(schema, modules);
    const identities = {
      employee: "org-creator-employee@example.com",
      alumni: "org-creator-alumni@example.com",
      independent: "org-creator-independent@example.com",
    };
    await t.run(async (ctx) => {
      const existingOrganizationId = await ctx.db.insert("organizations", {
        name: "Existing Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      for (const [membership, email] of Object.entries(identities)) {
        const userId = await ctx.db.insert("users", {
          email,
          createdAt: 1,
          updatedAt: 1,
        });
        if (membership !== "independent") {
          await ctx.db.insert("userOrganizations", {
            userId,
            organizationId: existingOrganizationId,
            role: "employee",
            accessStatus: membership === "alumni" ? "alumni" : "active",
            joinedAt: 1,
            updatedAt: 1,
          });
        }
      }
    });

    const createdOrganizationIds = await Promise.all(
      Object.entries(identities).map(([label, email]) =>
        t.withIdentity({ email }).mutation(api.organizations.createOrganization, {
          name: `${label} Created Org`,
        }),
      ),
    );

    for (let index = 0; index < createdOrganizationIds.length; index += 1) {
      const memberships = await t
        .withIdentity({ email: Object.values(identities)[index] })
        .query(api.organizations.getUserOrganizations, {});
      expect(memberships).toContainEqual(
        expect.objectContaining({
          _id: createdOrganizationIds[index],
          role: "owner",
          accessStatus: "active",
        }),
      );
    }
  });

  it("uses the organization membership role", async () => {
    const t = convexTest(schema, modules);
    const email = "membership-employee@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Membership role organization",
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
      return organizationId;
    });

    await expect(
      t.withIdentity({ email }).mutation(api.settings.updatePayrollSettings, {
        organizationId,
        payrollSettings: { nightDiffPercent: 2 },
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("blocks alumni members from reading or changing organization settings", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "former-hr@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Former HR organization",
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
        role: "hr",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });
    const alumni = t.withIdentity({ email: alumniEmail });

    await expect(
      alumni.query(api.settings.getSettings, { organizationId }),
    ).rejects.toThrow("Organization access is limited or inactive");
    await expect(
      alumni.mutation(api.settings.updatePayrollSettings, {
        organizationId,
        payrollSettings: { nightDiffPercent: 1.5 },
      }),
    ).rejects.toThrow("Organization access is limited or inactive");

    await expect(
      t.run((ctx) => ctx.db.query("settings").collect()),
    ).resolves.toEqual([]);
  });

  it("blocks an alumni administrator from changing organization payroll cadence", async () => {
    const t = convexTest(schema, modules);
    const alumniEmail = "former-admin@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Protected organization",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationPayrollSettings", {
        organizationId,
        salaryPaymentFrequency: "bimonthly",
        firstPayDate: 15,
        secondPayDate: 30,
        migrationVersion: 2,
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
        role: "admin",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    await expect(
      t
        .withIdentity({ email: alumniEmail })
        .mutation(api.organizations.updateOrganization, {
          organizationId,
          salaryPaymentFrequency: "monthly",
          firstPayDate: 28,
          secondPayDate: 28,
        }),
    ).rejects.toThrow("Not authorized");

    await expect(
      t.run((ctx) =>
        ctx.db
          .query("organizationPayrollSettings")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", organizationId),
          )
          .unique(),
      ),
    ).resolves.toMatchObject({
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });
  });

  it("moves an explicitly linked organization membership to alumni when an employee resigns", async () => {
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
        employeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });

      return { employeeId, employeeMembershipId };
    });

    await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.updateEmployee, {
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

  it("does not infer an employee membership link from a matching email", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "explicit-link-hr@example.com";
    const employeeEmail = "unlinked-employee@example.com";

    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Explicit Link Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const hrUserId = await ctx.db.insert("users", {
        email: hrEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: employeeEmail,
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
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId: employeeUserId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Unlinked",
          lastName: "Employee",
          email: employeeEmail,
        },
        employment: {
          employeeId: "EMP-UNLINKED",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      return { employeeId, membershipId };
    });

    await t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
      employeeId: fixture.employeeId,
      employment: {
        employeeId: "EMP-UNLINKED",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        separationDate: 2,
        status: "resigned",
      },
    });

    const membership = await t.run((ctx) => ctx.db.get(fixture.membershipId));
    expect(membership?.employeeId).toBeUndefined();
    expect(membership?.accessStatus).toBe("active");
  });

  it("keeps a separated employee membership in alumni access when the employee is archived", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "archive-hr@example.com";

    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Archive Alumni Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const hrUserId = await ctx.db.insert("users", {
        email: hrEmail,
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
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Past",
          lastName: "Employee",
          email: "past-employee@example.com",
        },
        employment: {
          employeeId: "EMP-PAST",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          separationDate: 2,
          status: "resigned",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: "past-employee@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId: employeeUserId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { employeeId, membershipId };
    });

    await t.withIdentity({ email: hrEmail }).mutation(api.employees.deleteEmployee, {
      employeeId: fixture.employeeId,
    });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(fixture.employeeId),
      membership: await ctx.db.get(fixture.membershipId),
    }));
    expect(state.employee?.archivedAt).toBeTypeOf("number");
    expect(state.membership?.accessStatus).toBe("alumni");

    await t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
      employeeId: fixture.employeeId,
      employment: {
        employeeId: "EMP-PAST",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        status: "active",
      },
    });

    await expect(
      t.run((ctx) => ctx.db.get(fixture.membershipId)),
    ).resolves.toMatchObject({ accessStatus: "disabled" });
  });

  it("cancels pending invitations when an employee separates", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "separation-hr@example.com";

    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Invitation Separation Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const hrUserId = await ctx.db.insert("users", {
        email: hrEmail,
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
      const employeeId = await ctx.db.insert("employees", {
        organizationId,
        personalInfo: {
          firstName: "Pending",
          lastName: "Invite",
          email: "pending-invite@example.com",
        },
        employment: {
          employeeId: "EMP-PENDING",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          status: "active",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 1,
      });
      const invitationId = await ctx.db.insert("invitations", {
        organizationId,
        employeeId,
        email: "pending-invite@example.com",
        role: "employee",
        invitedBy: hrUserId,
        tokenHash: "pending-token-hash",
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return { employeeId, invitationId };
    });

    await t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
      employeeId: fixture.employeeId,
      employment: {
        employeeId: "EMP-PENDING",
        position: "Analyst",
        department: "Operations",
        employmentType: "regular",
        hireDate: 1,
        separationDate: 2,
        status: "terminated",
      },
    });

    await expect(
      t.run((ctx) => ctx.db.get(fixture.invitationId)),
    ).resolves.toMatchObject({ status: "cancelled" });
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
