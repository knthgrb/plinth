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
    expect(invitation?.token).toBeUndefined();
    expect(invitation?.tokenHash).toBe(hashInvitationToken(created.token));
  });

  it("uses token hashes first and never falls back for a hashed row", async () => {
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
        token: legacyToken,
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

  it("does not use plaintext lookup for rows that have no token hash", async () => {
    const { t, organizationId } = await setupActor("active");
    const token = "legacy-only-token";
    await t.run(async (ctx) => {
      const inviter = await ctx.db.query("users").first();
      if (!inviter) throw new Error("Inviter fixture was not found");
      await ctx.db.insert("invitations", {
        organizationId,
        email: "legacy-only@example.com",
        role: "employee",
        invitedBy: inviter._id,
        token,
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
    });

    await expect(
      t.query(api.invitations.getInvitationByToken, { token }),
    ).resolves.toBeNull();
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
    expect(invitation?.token).toBeUndefined();
    expect(invitation?.tokenHash).toBe(hashInvitationToken(result.token));
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
        token: "protected-token",
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
        employeeId,
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
        token,
        tokenHash: hashInvitationToken(token),
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return { invitationId, membershipId, token };
    });

    await expect(
      t.mutation(api.invitations.acceptInvitation, { token: fixture.token }),
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
});
