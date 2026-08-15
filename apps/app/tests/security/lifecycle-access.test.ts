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

    const { employeeId } = await t
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
      lifecycleEvents: await ctx.db
        .query("employeeLifecycleEvents")
        .withIndex("by_employee_effective_at", (query) =>
          query.eq("employeeId", employeeId),
        )
        .collect(),
    }));
    expect(state.employee?.personalInfo.email).toBe(employeeEmail);
    expect(state.user).toBeNull();
    expect(state.linkedMemberships).toEqual([]);
    expect(state.lifecycleEvents).toMatchObject([
      { type: "hired", effectiveAt: 1 },
    ]);
    await expect(
      t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
        employeeId,
        employment: {
          employeeId: "TEMP",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          separationDate: 0,
          status: "resigned",
        },
      }),
    ).rejects.toThrow("on or after the current hire date");
    await expect(
      t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
        employeeId,
        employment: {
          employeeId: "TEMP",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 0,
          separationDate: 1,
          status: "resigned",
        },
      }),
    ).rejects.toThrow("Hire date cannot be changed during separation");
  });

  it("allows only active status when creating an employee", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "inactive-status-hr@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Three-state Employment Org",
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

    for (const status of ["inactive", "resigned", "terminated"] as const) {
      await expect(
        t
          .withIdentity({ email: hrEmail })
          .mutation(api.employees.createEmployee, {
            organizationId,
            personalInfo: {
              firstName: "Only",
              lastName: "Active",
              email: `${status}@example.com`,
            },
            employment: {
              employeeId: "TEMP",
              position: "Analyst",
              department: "Operations",
              employmentType: "regular",
              hireDate: 1,
              status: status as never,
            },
            compensation: { basicSalary: 30_000, salaryType: "monthly" },
            schedule: { defaultSchedule },
          }),
      ).rejects.toThrow();
    }
  });

  it("links a new employee to an available member and inherits account email", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "link-member-hr@example.com";
    const memberEmail = "canonical-member@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Link Existing Member Org",
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
      const memberUserId = await ctx.db.insert("users", {
        email: memberEmail,
        name: "Canonical Member",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId: memberUserId,
        organizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, memberUserId, membershipId };
    });

    const availableBefore = await t
      .withIdentity({ email: hrEmail })
      .query(api.employees.getAvailableOrganizationMembers, {
        organizationId: fixture.organizationId,
      });
    expect(availableBefore).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: fixture.memberUserId,
          email: memberEmail,
        }),
      ]),
    );

    const result = await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.createEmployee, {
        organizationId: fixture.organizationId,
        accountAccess: {
          kind: "link_member",
          userId: fixture.memberUserId,
        },
        personalInfo: {
          firstName: "Linked",
          lastName: "Employee",
          email: "must-not-be-used@example.com",
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
      employee: await ctx.db.get(result.employeeId),
      membership: await ctx.db.get(fixture.membershipId),
    }));
    expect(state.employee?.personalInfo.email).toBe(memberEmail);
    expect(state.membership?.employeeId).toBe(result.employeeId);
    const availableAfter = await t
      .withIdentity({ email: hrEmail })
      .query(api.employees.getAvailableOrganizationMembers, {
        organizationId: fixture.organizationId,
      });
    expect(availableAfter.map((member) => member._id)).not.toContain(
      fixture.memberUserId,
    );
  });

  it("creates an employee-linked invitation without creating a user account", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "invite-employee-hr@example.com";
    const inviteEmail = "future-member@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Invite New Employee Org",
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

    const result = await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.createEmployee, {
        organizationId,
        accountAccess: { kind: "invite_member", email: inviteEmail },
        personalInfo: {
          firstName: "Future",
          lastName: "Member",
          email: "must-not-be-used@example.com",
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
      employee: await ctx.db.get(result.employeeId),
      invitation: result.invitationId
        ? await ctx.db.get(result.invitationId)
        : null,
      user: await ctx.db
        .query("users")
        .withIndex("by_email", (query) => query.eq("email", inviteEmail))
        .unique(),
    }));
    expect(state.employee?.personalInfo.email).toBe(inviteEmail);
    expect(state.invitation).toMatchObject({
      employeeId: result.employeeId,
      email: inviteEmail,
      status: "pending",
    });
    expect(state.user).toBeNull();
  });

  it("requires separation when removing a linked employee membership", async () => {
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
      const invitationId = await ctx.db.insert("invitations", {
        organizationId,
        employeeId,
        email: "linked-remove@example.com",
        role: "employee",
        invitedBy: ownerUserId,
        tokenHash: "linked-removal-pending-token",
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return {
        organizationId,
        employeeId,
        employeeUserId,
        membershipId,
        invitationId,
      };
    });

    await expect(
      t
        .withIdentity({ email: ownerEmail })
        .mutation(api.organizations.removeUserFromOrganization, {
          organizationId: fixture.organizationId,
          userId: fixture.employeeUserId,
        }),
    ).rejects.toThrow("Choose resigned or terminated");

    await expect(
      t
        .withIdentity({ email: ownerEmail })
        .mutation(api.organizations.removeUserFromOrganization, {
          organizationId: fixture.organizationId,
          userId: fixture.employeeUserId,
          separation: { type: "resigned", effectiveAt: 0 },
        }),
    ).rejects.toThrow("on or after the current hire date");

    await t
      .withIdentity({ email: ownerEmail })
      .mutation(api.organizations.removeUserFromOrganization, {
        organizationId: fixture.organizationId,
        userId: fixture.employeeUserId,
        separation: {
          type: "resigned",
          effectiveAt: 2,
          reason: "Career change",
        },
      });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(fixture.employeeId),
      membership: await ctx.db.get(fixture.membershipId),
      user: await ctx.db.get(fixture.employeeUserId),
      invitation: await ctx.db.get(fixture.invitationId),
    }));
    expect(state.employee?._id).toBe(fixture.employeeId);
    expect(state.employee?.employment).toMatchObject({
      status: "resigned",
      separationDate: 2,
      separationReason: "Career change",
    });
    expect(state.user?._id).toBe(fixture.employeeUserId);
    expect(state.membership).toMatchObject({
      employeeId: fixture.employeeId,
      accessStatus: "alumni",
    });
    expect(state.invitation?.status).toBe("cancelled");

    const visibleMembers = await t
      .withIdentity({ email: ownerEmail })
      .query(api.organizations.getOrganizationMembers, {
        organizationId: fixture.organizationId,
      });
    expect(visibleMembers.map((member) => member?._id)).not.toContain(
      fixture.employeeUserId,
    );
  });

  it("deletes a standalone membership while retaining the user account", async () => {
    const t = convexTest(schema, modules);
    const ownerEmail = "standalone-remove-owner@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Standalone Membership Org",
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
      const memberUserId = await ctx.db.insert("users", {
        email: "standalone-member@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId: memberUserId,
        organizationId,
        role: "manager",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { organizationId, memberUserId, membershipId };
    });

    await t
      .withIdentity({ email: ownerEmail })
      .mutation(api.organizations.removeUserFromOrganization, {
        organizationId: fixture.organizationId,
        userId: fixture.memberUserId,
      });

    const state = await t.run(async (ctx) => ({
      membership: await ctx.db.get(fixture.membershipId),
      user: await ctx.db.get(fixture.memberUserId),
    }));
    expect(state.membership).toBeNull();
    expect(state.user?._id).toBe(fixture.memberUserId);
  });

  it("rejects rehiring an alumni employee through generic editing", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "explicit-rehire-hr@example.com";
    const employeeId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Explicit Rehire Org",
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
          firstName: "Former",
          lastName: "Employee",
          email: "former-employee@example.com",
        },
        employment: {
          employeeId: "EMP-FORMER",
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
        updatedAt: 2,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: "former-employee@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: employeeUserId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 2,
      });
      return employeeId;
    });

    await expect(
      t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
        employeeId,
        employment: {
          employeeId: "EMP-FORMER",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 3,
          status: "active",
        },
      }),
    ).rejects.toThrow("Use Rehire Employee");

    await expect(
      t.withIdentity({ email: hrEmail }).mutation(api.employees.updateEmployee, {
        employeeId,
        employment: {
          employeeId: "EMP-FORMER",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          separationDate: 2,
          status: "terminated",
        },
      }),
    ).rejects.toThrow("cannot be changed through generic editing");
  });

  it("rehire restores alumni membership and records complete lifecycle history", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "rehire-history-hr@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Rehire History Org",
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
          firstName: "Returning",
          lastName: "Employee",
          email: "returning-employee@example.com",
        },
        employment: {
          employeeId: "EMP-RETURN",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          separationDate: 2,
          separationReason: "Career change",
          status: "resigned",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 2,
      });
      const employeeUserId = await ctx.db.insert("users", {
        email: "returning-employee@example.com",
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
        updatedAt: 2,
      });
      return { employeeId, membershipId };
    });

    await expect(
      t
        .withIdentity({ email: hrEmail })
        .mutation(api.employees.rehireEmployee, {
          employeeId: fixture.employeeId,
          hireDate: 2,
          position: "Senior Analyst",
          department: "Operations",
          employmentType: "regular",
        }),
    ).rejects.toThrow("after the latest separation date");

    await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.rehireEmployee, {
        employeeId: fixture.employeeId,
        hireDate: 3,
        position: "Senior Analyst",
        department: "Operations",
        employmentType: "regular",
      });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(fixture.employeeId),
      membership: await ctx.db.get(fixture.membershipId),
      lifecycleEvents: await ctx.db
        .query("employeeLifecycleEvents")
        .withIndex("by_employee_effective_at", (query) =>
          query.eq("employeeId", fixture.employeeId),
        )
        .collect(),
    }));
    expect(state.employee?.employment).toMatchObject({
      status: "active",
      hireDate: 3,
      position: "Senior Analyst",
    });
    expect(state.employee?.employment.separationDate).toBeUndefined();
    expect(state.membership?.accessStatus).toBe("active");
    expect(state.membership?.joinedAt).toBe(1);
    expect(state.lifecycleEvents).toMatchObject([
      { type: "hired", effectiveAt: 1 },
      { type: "resigned", effectiveAt: 2 },
      { type: "rehired", effectiveAt: 3 },
    ]);

    const timeline = await t
      .withIdentity({ email: hrEmail })
      .query(api.employees.getEmployeeLifecycleTimeline, {
        employeeId: fixture.employeeId,
      });
    expect(timeline.map((event) => event.type)).toEqual([
      "hired",
      "resigned",
      "rehired",
    ]);
    expect(timeline[2]).toMatchObject({
      effectiveAt: 3,
      position: "Senior Analyst",
      recordedBy: { email: hrEmail },
    });

    const coworkerEmail = "timeline-coworker@example.com";
    await t.run(async (ctx) => {
      const coworkerEmployeeId = await ctx.db.insert("employees", {
        organizationId: state.employee!.organizationId,
        personalInfo: {
          firstName: "Timeline",
          lastName: "Coworker",
          email: coworkerEmail,
        },
        employment: {
          employeeId: "EMP-COWORKER",
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
      const coworkerUserId = await ctx.db.insert("users", {
        email: coworkerEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: coworkerUserId,
        organizationId: state.employee!.organizationId,
        employeeId: coworkerEmployeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      t
        .withIdentity({ email: coworkerEmail })
        .query(api.employees.getEmployeeLifecycleTimeline, {
          employeeId: fixture.employeeId,
        }),
    ).rejects.toThrow("Not authorized");
  });

  it("rehire restores a separated employee-only record without creating membership", async () => {
    const t = convexTest(schema, modules);
    const hrEmail = "rehire-record-only-hr@example.com";
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Record-only Rehire Org",
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
          firstName: "Record",
          lastName: "Only",
          email: "record-only@example.com",
        },
        employment: {
          employeeId: "EMP-RECORD-ONLY",
          position: "Analyst",
          department: "Operations",
          employmentType: "regular",
          hireDate: 1,
          separationDate: 2,
          status: "terminated",
        },
        compensation: { basicSalary: 30_000, salaryType: "monthly" },
        schedule: { defaultSchedule },
        createdAt: 1,
        updatedAt: 2,
      });
      return { organizationId, employeeId };
    });

    const result = await t
      .withIdentity({ email: hrEmail })
      .mutation(api.employees.rehireEmployee, {
        employeeId: fixture.employeeId,
        hireDate: 3,
        position: "Senior Analyst",
        department: "Operations",
        employmentType: "regular",
      });

    const state = await t.run(async (ctx) => ({
      employee: await ctx.db.get(fixture.employeeId),
      memberships: await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization", (query) =>
          query.eq("organizationId", fixture.organizationId),
        )
        .filter((query) =>
          query.eq(query.field("employeeId"), fixture.employeeId),
        )
        .collect(),
    }));
    expect(result).toEqual({ success: true, membershipReactivated: false });
    expect(state.employee?.employment.status).toBe("active");
    expect(state.memberships).toHaveLength(0);
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

  it("keeps archived organizations discoverable without granting active access", async () => {
    const t = convexTest(schema, modules);
    const email = "archived-org-owner@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Archived Organization",
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
        role: "owner",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    await t
      .withIdentity({ email })
      .mutation(api.organizations.deleteOrganization, {
        organizationId,
      });

    await expect(
      t
        .withIdentity({ email })
        .query(api.organizations.getUserOrganizations, {}),
    ).resolves.toEqual([]);
    await expect(
      t
        .withIdentity({ email })
        .query(api.organizations.getArchivedUserOrganizations, {}),
    ).resolves.toEqual([
      expect.objectContaining({
        _id: organizationId,
        name: "Archived Organization",
        status: "archived",
        role: "owner",
      }),
    ]);
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
