import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
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

async function setup() {
  const t = convexTest(schema, modules);
  const email = "assets-user@example.com";
  const fixture = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      name: "Asset Compatibility",
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
      role: "admin",
      accessStatus: "active",
      joinedAt: 1,
      updatedAt: 1,
    });
    const assetId = await ctx.db.insert("assets", {
      organizationId,
      name: "Laptop",
      quantity: 1,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("assetMaintenanceEvents", {
      organizationId,
      assetId,
      serviceDate: 2,
      description: "Normalized service",
      sourceIndex: 0,
      migrationVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return { organizationId, assetId };
  });
  return { t, actor: t.withIdentity({ email }), ...fixture };
}

describe("assets and payroll compatibility", () => {
  it("loads maintenance history from normalized events", async () => {
    const { actor, assetId } = await setup();
    const asset = await actor.query(api.assets.getAsset, { assetId });
    expect(asset?.maintenanceHistory).toEqual([
      expect.objectContaining({ date: 2, description: "Normalized service" }),
    ]);
  });

  it("writes maintenance history only to normalized rows", async () => {
    const { t, actor, assetId } = await setup();
    await actor.mutation(api.assets.updateAsset, {
      assetId,
      maintenanceHistory: [{ date: 3, description: "Replacement service" }],
    });
    const state = await t.run(async (ctx) => ({
      asset: await ctx.db.get(assetId),
      events: await ctx.db
        .query("assetMaintenanceEvents")
        .withIndex("by_asset_source", (q) => q.eq("assetId", assetId))
        .collect(),
    }));
    expect(state.asset).not.toHaveProperty("maintenanceHistory");
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      serviceDate: 3,
      description: "Replacement service",
    });
  });
});
