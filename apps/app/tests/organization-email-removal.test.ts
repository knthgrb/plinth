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

type OrganizationEmailCleanupResult = {
  continueCursor: string;
  isDone: boolean;
  scannedCount: number;
  removedCount: number;
};

const clearLegacyOrganizationEmails = makeFunctionReference<
  "mutation",
  { cursor?: string | null; numItems?: number },
  OrganizationEmailCleanupResult
>("maintenance:clearLegacyOrganizationEmails");

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

  it("removes legacy organization emails in bounded batches", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", {
        name: "Legacy One",
        email: "first-owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        name: "Already Clean",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizations", {
        name: "Legacy Two",
        email: "second-owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    let cursor: string | null = null;
    let scannedCount = 0;
    let removedCount = 0;
    do {
      const result: OrganizationEmailCleanupResult = await t.mutation(
        clearLegacyOrganizationEmails,
        {
          cursor,
          numItems: 1,
        },
      );
      scannedCount += result.scannedCount;
      removedCount += result.removedCount;
      cursor = result.isDone ? null : result.continueCursor;
      if (result.isDone) break;
    } while (cursor);

    expect(scannedCount).toBe(3);
    expect(removedCount).toBe(2);
    const organizations = await t.run((ctx) =>
      ctx.db.query("organizations").collect(),
    );
    expect(
      organizations.every((organization) => organization.email === undefined),
    ).toBe(true);
  });
});
