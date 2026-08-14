import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import { hashInvitationToken } from "../convex/invitationTokenHash";
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
) => {
  const workday = { in: "09:00", out: "18:00", isWorkday: true };
  return ctx.db.insert("employees", {
    organizationId,
    personalInfo: {
      firstName: "Invite",
      lastName: "Recipient",
      email: "employee-invite@example.com",
    },
    employment: {
      employeeId: "INVITE-001",
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

const setupActor = async (accessStatus: "active" | "alumni") => {
  const t = convexTest(schema, modules);
  const actorEmail = `${accessStatus}-hr@example.com`;
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Invitation Compatibility Org",
      createdAt: 1,
      updatedAt: 1,
    });
    const userId = await ctx.db.insert("users", {
      email: actorEmail,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userOrganizations", {
      userId,
      organizationId,
      role: "hr",
      accessStatus,
      joinedAt: 1,
      updatedAt: 1,
    });
    const employeeId = await insertEmployee(ctx, organizationId);
    return { organizationId, employeeId };
  });
  return { t, actor: t.withIdentity({ email: actorEmail }), ...fixture };
};

describe("invitation token compatibility writes", () => {
  it("atomically hashes tokens created through the general invitation path", async () => {
    const { t, actor, organizationId } = await setupActor("active");
    const created = await actor.mutation(
      api.invitations.createInvitation,
      {
        organizationId,
        email: "general-invite@example.com",
        role: "employee",
      },
    );

    const invitation = await t.run((ctx) =>
      ctx.db.get(created.invitationId as Id<"invitations">),
    );
    expect(invitation).not.toHaveProperty("token");
    expect(invitation?.tokenHash).toBe(hashInvitationToken(created.token));
  });

  it("accepts only the token matching the stored hash", async () => {
    const { t, organizationId } = await setupActor("active");
    const fixture = await t.run(async (ctx) => {
      const inviter = await ctx.db.query("users").first();
      if (!inviter) throw new Error("Inviter fixture was not found");
      const currentToken = "current-token";
      const legacyToken = "legacy-token-that-must-not-work";
      await ctx.db.insert("invitations", {
        organizationId,
        email: "hash-first@example.com",
        role: "employee",
        invitedBy: inviter._id,
        tokenHash: hashInvitationToken(currentToken),
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return { currentToken, legacyToken };
    });

    await expect(
      t.query(api.invitations.getInvitationByToken, {
        token: fixture.legacyToken,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.invitations.getInvitationByToken, {
        token: fixture.currentToken,
      }),
    ).resolves.toMatchObject({ email: "hash-first@example.com" });
  });

  it("requires a matching authenticated account to accept an invitation", async () => {
    const { t, actor, organizationId } = await setupActor("active");
    const created = await actor.mutation(api.invitations.createInvitation, {
      organizationId,
      email: "invitee@example.com",
      role: "employee",
    });

    await expect(
      t.mutation(api.invitations.acceptInvitation, { token: created.token }),
    ).rejects.toThrow("Not authenticated");
  });

  it("creates only the membership projection when an employee invitation is accepted", async () => {
    const { t, actor, organizationId, employeeId } = await setupActor("active");
    const created = await actor.mutation(api.invitations.createUserForEmployee, {
      organizationId,
      employeeId,
      role: "employee",
    });
    const inviteeEmail = "employee-invite@example.com";

    const result = await t
      .withIdentity({ email: inviteeEmail })
      .mutation(api.invitations.acceptInvitation, { token: created.token });

    expect(result).toMatchObject({ success: true, organizationId });
    const state = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (query) => query.eq("email", inviteeEmail))
        .unique();
      if (!user) throw new Error("Accepted invitation user was not created");
      const membership = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (query) =>
          query.eq("userId", user._id).eq("organizationId", organizationId),
        )
        .unique();
      return { user, membership };
    });

    expect(state.membership).toMatchObject({
      employeeId,
      role: "employee",
      accessStatus: "active",
    });
    expect(state.user).not.toHaveProperty("organizationId");
    expect(state.user).not.toHaveProperty("role");
    expect(state.user).not.toHaveProperty("employeeId");
  });

  it("stores the authenticated email representation when accepting an invitation", async () => {
    const { t, actor, organizationId } = await setupActor("active");
    const existingUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "Mixed.Case.Invitee@Example.com",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const created = await actor.mutation(api.invitations.createInvitation, {
      organizationId,
      email: "MIXED.CASE.INVITEE@EXAMPLE.COM",
      role: "employee",
      confirmInviteToExistingPlinthUser: true,
    });
    const authenticatedEmail = "mixed.case.invitee@example.com";

    await t
      .withIdentity({ email: authenticatedEmail })
      .mutation(api.invitations.acceptInvitation, { token: created.token });

    const state = await t.run(async (ctx) => ({
      canonicalUser: await ctx.db
        .query("users")
        .withIndex("by_email", (query) =>
          query.eq("email", authenticatedEmail),
        )
        .unique(),
    }));
    expect(state.canonicalUser?.email).toBe(authenticatedEmail);
    expect(state.canonicalUser?._id).toBe(existingUserId);
    await expect(
      t
        .withIdentity({ email: authenticatedEmail })
        .query(api.organizations.getUserOrganizations, {}),
    ).resolves.toHaveLength(1);
  });

  it("restores a removed membership only after a matching invitation is accepted", async () => {
    const { t, actor, organizationId, employeeId } = await setupActor("active");
    const inviteeEmail = "employee-invite@example.com";
    const membershipId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: inviteeEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "removed",
        joinedAt: 1,
        updatedAt: 1,
      });
    });

    const created = await actor.mutation(api.invitations.createInvitation, {
      organizationId,
      employeeId,
      email: inviteeEmail,
      role: "employee",
      confirmInviteToExistingPlinthUser: true,
    });
    await t
      .withIdentity({ email: inviteeEmail })
      .mutation(api.invitations.acceptInvitation, { token: created.token });

    const memberships = await t.run((ctx) =>
      ctx.db
        .query("userOrganizations")
        .withIndex("by_organization_employee", (query) =>
          query
            .eq("organizationId", organizationId)
            .eq("employeeId", employeeId),
        )
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      _id: membershipId,
      accessStatus: "active",
      role: "employee",
    });
  });

  it("does not restore a removed membership linked to a separated employee", async () => {
    const { t, actor, organizationId, employeeId } = await setupActor("active");
    const inviteeEmail = "employee-invite@example.com";
    const fixture = await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee.employment,
          status: "resigned",
          separationDate: 2,
        },
      });
      const userId = await ctx.db.insert("users", {
        email: inviteeEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "removed",
        joinedAt: 1,
        updatedAt: 1,
      });
      return { membershipId };
    });

    const created = await actor.mutation(api.invitations.createInvitation, {
      organizationId,
      email: inviteeEmail,
      role: "employee",
      confirmInviteToExistingPlinthUser: true,
    });

    await expect(
      t
        .withIdentity({ email: inviteeEmail })
        .mutation(api.invitations.acceptInvitation, { token: created.token }),
    ).rejects.toThrow("Invitation is no longer eligible");
    await expect(
      t.run((ctx) => ctx.db.get(fixture.membershipId)),
    ).resolves.toMatchObject({ accessStatus: "removed", employeeId });
  });

  it("redacts stored bearer tokens and rotates them for resend", async () => {
    const { t, actor, organizationId } = await setupActor("active");
    const created = await actor.mutation(api.invitations.createInvitation, {
      organizationId,
      email: "rotate@example.com",
      role: "employee",
    });

    const details = await actor.query(api.invitations.getInvitationById, {
      invitationId: created.invitationId,
    });
    expect(details).not.toHaveProperty("token");
    expect(details).not.toHaveProperty("tokenHash");

    const rotated = await actor.mutation(api.invitations.resendInvitation, {
      invitationId: created.invitationId,
    });
    expect(rotated.token).not.toBe(created.token);
    await expect(
      t.query(api.invitations.getInvitationByToken, { token: created.token }),
    ).resolves.toBeNull();
    await expect(
      t.query(api.invitations.getInvitationByToken, { token: rotated.token }),
    ).resolves.toMatchObject({ email: "rotate@example.com" });
  });

  it("atomically hashes tokens created for an employee", async () => {
    const { t, actor, organizationId, employeeId } = await setupActor("active");
    const result = await actor.mutation(api.invitations.createUserForEmployee, {
      organizationId,
      employeeId,
      role: "employee",
    });

    const invitation = await t.run((ctx) =>
      ctx.db.get(result.invitationId as Id<"invitations">),
    );
    expect(invitation).not.toHaveProperty("token");
    expect(invitation?.tokenHash).toBe(hashInvitationToken(result.token));
  });

  it("does not create an invitation for a separated employee", async () => {
    const { actor, t, organizationId, employeeId } = await setupActor("active");
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee.employment,
          separationDate: 2,
          status: "resigned",
        },
      });
    });

    await expect(
      actor.mutation(api.invitations.createUserForEmployee, {
        organizationId,
        employeeId,
        role: "employee",
      }),
    ).rejects.toThrow("Only active employees can be invited");
  });

  it("does not offer separated employees as invitation candidates", async () => {
    const { actor, t, organizationId, employeeId } = await setupActor("active");
    await t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee) throw new Error("Employee fixture was not found");
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee.employment,
          separationDate: 2,
          status: "terminated",
        },
      });
    });

    await expect(
      actor.query(api.employees.listEmployeesAvailableForOrgInvite, {
        organizationId,
      }),
    ).resolves.toEqual([]);
  });

  it("blocks inactive organization members from both invitation paths", async () => {
    const { t, actor, organizationId, employeeId } = await setupActor("alumni");

    await expect(
      actor.mutation(api.invitations.createInvitation, {
        organizationId,
        email: "blocked@example.com",
        role: "employee",
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      actor.mutation(api.invitations.createUserForEmployee, {
        organizationId,
        employeeId,
        role: "employee",
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      t.run((ctx) => ctx.db.query("invitations").collect()),
    ).resolves.toEqual([]);
  });

  it("blocks inactive HR from previewing, listing, or cancelling invitations", async () => {
    const { t, actor, organizationId } = await setupActor("alumni");
    const invitationId = await t.run(async (ctx) => {
      const inviter = await ctx.db
        .query("users")
        .withIndex("by_email", (query) =>
          query.eq("email", "alumni-hr@example.com"),
        )
        .unique();
      return ctx.db.insert("invitations", {
        organizationId,
        email: "protected-invite@example.com",
        role: "employee",
        invitedBy: inviter!._id,
        tokenHash: hashInvitationToken("protected-token"),
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
    });

    await expect(
      actor.query(api.invitations.getInviteRecipientPreview, {
        organizationId,
        email: "protected-invite@example.com",
      }),
    ).rejects.toThrow("Not authorized");
    await expect(
      actor.query(api.invitations.getInvitations, { organizationId }),
    ).rejects.toThrow("Not authorized");
    await expect(
      actor.mutation(api.invitations.cancelInvitation, { invitationId }),
    ).rejects.toThrow("Not authorized");
    await expect(
      t.run((ctx) => ctx.db.get(invitationId)),
    ).resolves.toMatchObject({
      status: "pending",
    });
  });

  it("does not reactivate an alumni membership through an old invitation", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Past Employer",
        createdAt: 1,
        updatedAt: 1,
      });
      const employeeId = await insertEmployee(ctx, organizationId);
      const employee = await ctx.db.get(employeeId);
      await ctx.db.patch(employeeId, {
        employment: {
          ...employee!.employment,
          status: "resigned",
          separationDate: 2,
        },
      });
      const userId = await ctx.db.insert("users", {
        email: "employee-invite@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const membershipId = await ctx.db.insert("userOrganizations", {
        userId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "alumni",
        joinedAt: 1,
        updatedAt: 1,
      });
      const inviterId = await ctx.db.insert("users", {
        email: "inviter@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const token = "old-pending-token";
      const invitationId = await ctx.db.insert("invitations", {
        organizationId,
        employeeId,
        email: "employee-invite@example.com",
        role: "employee",
        invitedBy: inviterId,
        tokenHash: hashInvitationToken(token),
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return { invitationId, membershipId, token };
    });

    await expect(
      t
        .withIdentity({ email: "employee-invite@example.com" })
        .mutation(api.invitations.acceptInvitation, { token: fixture.token }),
    ).rejects.toThrow("Invitation is no longer eligible");
    await expect(
      t.run((ctx) => ctx.db.get(fixture.membershipId)),
    ).resolves.toMatchObject({
      accessStatus: "alumni",
    });
    await expect(
      t.run((ctx) => ctx.db.get(fixture.invitationId)),
    ).resolves.toMatchObject({
      status: "pending",
    });
  });

  it("rejects acceptance when the employee was linked after the invitation was issued", async () => {
    const { t, organizationId, employeeId } = await setupActor("active");
    const fixture = await t.run(async (ctx) => {
      const existingUserId = await ctx.db.insert("users", {
        email: "already-linked@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: existingUserId,
        organizationId,
        employeeId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      const inviter = await ctx.db.query("users").first();
      if (!inviter) throw new Error("Inviter fixture was not found");
      const token = "stale-employee-link-token";
      const invitationId = await ctx.db.insert("invitations", {
        organizationId,
        employeeId,
        email: "second-account@example.com",
        role: "employee",
        invitedBy: inviter._id,
        tokenHash: hashInvitationToken(token),
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return { invitationId, token };
    });

    await expect(
      t
        .withIdentity({ email: "second-account@example.com" })
        .mutation(api.invitations.acceptInvitation, { token: fixture.token }),
    ).rejects.toThrow("Invitation is no longer eligible");

    const state = await t.run(async (ctx) => ({
      invitation: await ctx.db.get(fixture.invitationId),
      employeeMemberships: await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization_employee", (query) =>
          query
            .eq("organizationId", organizationId)
            .eq("employeeId", employeeId),
        )
        .collect(),
    }));
    expect(state.invitation?.status).toBe("pending");
    expect(state.employeeMemberships).toHaveLength(1);
  });
});
