import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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

const legacySyncUser = makeFunctionReference<
  "mutation",
  {
    email: string;
    organizationId?: Id<"organizations">;
    role?: "owner" | "admin" | "hr" | "manager" | "employee" | "accounting";
  },
  Id<"users">
>("users:syncUser");

describe("public Convex security boundaries", () => {
  it("does not expose the legacy user-role synchronization mutation", async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Protected organization",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      t.mutation(legacySyncUser, {
        email: "attacker@example.com",
        organizationId,
        role: "owner",
      }),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated super-admin elevation", async () => {
    const t = convexTest(schema, modules);
    const email = "target@example.com";

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      t.mutation(api.demoRequests.setSuperAdmin, { email }),
    ).rejects.toThrow("Not authenticated");

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique(),
    );
    expect(user?.masterRole).toBeUndefined();
  });

  it("rejects unauthenticated upload URL generation", async () => {
    const t = convexTest(schema, modules);
    const organizationId = await t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Private Org",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      t.mutation(api.files.createUploadIntent, {
        organizationId,
        purpose: "document_attachment",
      }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects unauthenticated storage URL lookup", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storageId } = await t.run(async (ctx) => ({
      organizationId: await ctx.db.insert("organizations", {
        name: "Private Org",
        createdAt: 1,
        updatedAt: 1,
      }),
      storageId: await ctx.storage.store(new Blob(["private document"])),
    }));

    await expect(
      t.query(api.files.getFileUrl, { organizationId, storageId }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects unauthenticated storage metadata lookup", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storageId } = await t.run(async (ctx) => ({
      organizationId: await ctx.db.insert("organizations", {
        name: "Private Org",
        createdAt: 1,
        updatedAt: 1,
      }),
      storageId: await ctx.storage.store(new Blob(["private document"])),
    }));

    await expect(
      t.query(api.files.getFileUrlAndType, { organizationId, storageId }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects unauthenticated user lookup", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, userId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Private Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "private@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, userId };
    });

    await expect(
      t.query(api.organizations.getUserById, { userId, organizationId }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects unauthenticated invitation lookup by database ID", async () => {
    const t = convexTest(schema, modules);
    const invitationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Private Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const inviterId = await ctx.db.insert("users", {
        email: "inviter@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("invitations", {
        organizationId,
        email: "invitee@example.com",
        role: "employee",
        invitedBy: inviterId,
        token: "private-token",
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
    });

    await expect(
      t.query(api.invitations.getInvitationById, { invitationId }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects super-admin elevation by a normal authenticated user", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "actor@example.com";
    const targetEmail = "target@example.com";

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: actorEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", {
        email: targetEmail,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const asActor = t.withIdentity({ email: actorEmail });
    await expect(
      asActor.mutation(api.demoRequests.setSuperAdmin, { email: targetEmail }),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects user lookup across organization boundaries", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "actor@example.com";

    const { otherOrganizationId, targetUserId } = await t.run(async (ctx) => {
      const actorOrganizationId = await ctx.db.insert("organizations", {
        name: "Actor Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherOrganizationId = await ctx.db.insert("organizations", {
        name: "Other Org",
        createdAt: 1,
        updatedAt: 1,
      });
      const actorUserId = await ctx.db.insert("users", {
        email: actorEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      const targetUserId = await ctx.db.insert("users", {
        email: "target@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: actorUserId,
        organizationId: actorOrganizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userOrganizations", {
        userId: targetUserId,
        organizationId: otherOrganizationId,
        role: "employee",
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });

      return { otherOrganizationId, targetUserId };
    });

    const asActor = t.withIdentity({ email: actorEmail });
    await expect(
      asActor.query(api.organizations.getUserById, {
        userId: targetUserId,
        organizationId: otherOrganizationId,
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("does not expose whether an account exists", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(api.invitations.checkUserExists, {
        email: "private@example.com",
      }),
    ).rejects.toThrow("Not authenticated");
  });

  it("does not let an authenticated user enumerate another email", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "target@example.com",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      t.withIdentity({ email: "actor@example.com" }).query(
        api.invitations.checkUserExists,
        { email: "target@example.com" },
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("creates invitation tokens with at least 256 bits of encoded entropy", async () => {
    const t = convexTest(schema, modules);
    const actorEmail = "hr@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Secure Invites Org",
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
        accessStatus: "active",
        joinedAt: 1,
        updatedAt: 1,
      });
      return organizationId;
    });

    const asActor = t.withIdentity({ email: actorEmail });
    const invitationId = await asActor.mutation(
      api.invitations.createInvitation,
      {
        organizationId,
        email: "invitee@example.com",
        role: "employee",
      },
    );
    const invitation = await asActor.query(
      api.invitations.getInvitationById,
      { invitationId },
    );

    expect(invitation?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
