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
    const invitationId = await actor.mutation(
      api.invitations.createInvitation,
      {
        organizationId,
        email: "general-invite@example.com",
        role: "employee",
      },
    );

    const invitation = await t.run((ctx) =>
      ctx.db.get(invitationId as Id<"invitations">),
    );
    expect(invitation?.tokenHash).toBe(hashInvitationToken(invitation!.token));
    expect(invitation?.tokenHash).not.toBe(invitation?.token);
  });

  it("atomically hashes tokens created for an employee", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupActor("active");
    const result = await actor.mutation(
      api.invitations.createUserForEmployee,
      { organizationId, employeeId, role: "employee" },
    );

    const invitation = await t.run((ctx) =>
      ctx.db.get(result.invitationId as Id<"invitations">),
    );
    expect(invitation?.tokenHash).toBe(hashInvitationToken(invitation!.token));
    expect(invitation?.tokenHash).not.toBe(invitation?.token);
  });

  it("blocks inactive organization members from both invitation paths", async () => {
    const { t, actor, organizationId, employeeId } =
      await setupActor("alumni");

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
});
