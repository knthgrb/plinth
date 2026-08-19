import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
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

const createOrganizationWithLegacyEmail = makeFunctionReference<
  "mutation",
  { name: string; email: string },
  Id<"organizations">
>("organizations:createOrganization");

const updateOrganizationWithLegacyEmail = makeFunctionReference<
  "mutation",
  { organizationId: Id<"organizations">; email: string },
  { success: true }
>("organizations:updateOrganization");

describe("organization email removal", () => {
  it("rejects the obsolete email field when creating an organization", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t
        .withIdentity({ email: "owner@example.com" })
        .mutation(createOrganizationWithLegacyEmail, {
          name: "No Creator Email",
          email: "owner@example.com",
        }),
    ).rejects.toThrow(/email/i);

    await expect(
      t.run((ctx) => ctx.db.query("organizations").collect()),
    ).resolves.toEqual([]);
  });

  it("rejects the obsolete email field when updating an organization", async () => {
    const t = convexTest(schema, modules);
    const ownerEmail = "owner@example.com";
    const organizationId = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Existing Organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: ownerEmail,
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

    await expect(
      t.withIdentity({ email: ownerEmail }).mutation(
        updateOrganizationWithLegacyEmail,
        {
          organizationId,
          email: "obsolete@example.com",
        },
      ),
    ).rejects.toThrow(/email/i);

    const organization = await t.run((ctx) => ctx.db.get(organizationId));
    expect(organization).not.toHaveProperty("email");
  });

  it("rejects the obsolete email field at the database boundary", async () => {
    const t = convexTest(schema, modules);
    const legacyOrganization = {
      name: "Invalid Legacy Organization",
      email: "former-owner@example.com",
      createdAt: 1,
      updatedAt: 1,
    };

    await expect(
      t.run((ctx) => ctx.db.insert("organizations", legacyOrganization)),
    ).rejects.toThrow(/email/i);
  });
});
