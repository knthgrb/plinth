import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
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

type BackfillResult = {
  continueCursor: string;
  isDone: boolean;
  updatedCount: number;
  conflicts: Array<{ normalizedEmail: string; userIds: string[] }>;
};

describe("normalized user email migration", () => {
  it("backfills unique emails and reports case-insensitive duplicates", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const uniqueUserId = await ctx.db.insert("users", {
        email: " Unique.User@Example.com ",
        createdAt: 1,
        updatedAt: 1,
      });
      const duplicateUserIds = await Promise.all([
        ctx.db.insert("users", {
          email: "Duplicate@Example.com",
          createdAt: 1,
          updatedAt: 1,
        }),
        ctx.db.insert("users", {
          email: "duplicate@example.com",
          createdAt: 1,
          updatedAt: 1,
        }),
      ]);
      return { uniqueUserId, duplicateUserIds };
    });

    let cursor: string | null = null;
    let updatedCount = 0;
    const conflicts: Array<{
      normalizedEmail: string;
      userIds: string[];
    }> = [];
    do {
      const result: BackfillResult = await t.mutation(
        internal.maintenance.backfillNormalizedUserEmails,
        { cursor, numItems: 1 },
      );
      updatedCount += result.updatedCount;
      conflicts.push(...result.conflicts);
      cursor = result.isDone ? null : result.continueCursor;
      if (result.isDone) break;
    } while (cursor);

    expect(updatedCount).toBe(3);
    expect(conflicts).toContainEqual({
      normalizedEmail: "duplicate@example.com",
      userIds: expect.arrayContaining(fixture.duplicateUserIds),
    });

    const state = await t.run(async (ctx) => ({
      uniqueUser: await ctx.db.get(fixture.uniqueUserId),
      duplicateUsers: await Promise.all(
        fixture.duplicateUserIds.map((userId) => ctx.db.get(userId)),
      ),
    }));
    expect(state.uniqueUser?.normalizedEmail).toBe("unique.user@example.com");
    expect(
      state.duplicateUsers.every(
        (user) => user?.normalizedEmail === "duplicate@example.com",
      ),
    ).toBe(true);
  });

  it("blocks new account creation instead of scanning an unbounded legacy set", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("users", {
          email: `legacy-${index}@example.com`,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });

    await expect(
      t
        .withIdentity({ email: "new-account@example.com" })
        .mutation(api.organizations.createOrganization, {
          name: "Must Wait For Migration",
        }),
    ).rejects.toThrow("User email migration is incomplete");
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("users")
          .withIndex("by_email", (query) =>
            query.eq("email", "new-account@example.com"),
          )
          .unique(),
      ),
    ).resolves.toBeNull();
  });

  it("rejects an early exact candidate when a hidden case duplicate may exist", async () => {
    const t = convexTest(schema, modules);
    const exactEmail = "Case.Sensitive@Example.com";
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: exactEmail,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("users", {
          email: `hidden-duplicate-filler-${index}@example.com`,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("users", {
        email: exactEmail.toLowerCase(),
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      t
        .withIdentity({ email: exactEmail })
        .mutation(api.organizations.createOrganization, {
          name: "Blocked Until Identity Migration",
        }),
    ).rejects.toThrow("User email migration is incomplete");
    await expect(
      t.run((ctx) => ctx.db.query("organizations").collect()),
    ).resolves.toEqual([]);
  });
});
