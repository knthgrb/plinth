import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const rawModules = import.meta.glob("../../convex/**/*.ts");
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader,
  ]),
);

const backfillAuthoredStorageObjects = makeFunctionReference<
  "mutation",
  {
    organizationId: Id<"organizations">;
    dryRun: boolean;
  },
  {
    discovered: number;
    inserted: number;
    existing: number;
    unresolved: number;
    dryRun: boolean;
  }
>("storageMigrations:backfillAuthoredStorageObjects");

describe("storage ownership migration", () => {
  it("dry-runs and idempotently backfills a legacy document attachment", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storageId, memoStorageId, userId } = await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        name: "Migration organization",
        createdAt: 1,
        updatedAt: 1,
      });
      const userId = await ctx.db.insert("users", {
        email: "owner@example.com",
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["legacy document"]));
      await ctx.db.insert("documents", {
        organizationId,
        createdBy: userId,
        title: "Legacy document",
        content: "{}",
        type: "other",
        attachments: [storageId],
        createdAt: 1,
        updatedAt: 1,
      });
      const memoStorageId = await ctx.storage.store(new Blob(["legacy memo"]));
      await ctx.db.insert("memos", {
        organizationId,
        title: "Legacy memo",
        content: "{}",
        type: "announcement",
        priority: "normal",
        author: userId,
        targetAudience: "all",
        publishedDate: 1,
        attachments: [memoStorageId],
        isPublished: true,
        acknowledgementRequired: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const unresolvedStorageId = await ctx.storage.store(
        new Blob(["legacy accounting receipt"]),
      );
      await ctx.db.insert("accountingCostItems", {
        organizationId,
        name: "Legacy expense",
        amount: 100,
        amountPaid: 0,
        frequency: "one-time",
        status: "pending",
        receipts: [unresolvedStorageId],
        createdAt: 1,
        updatedAt: 1,
      });
      return { organizationId, storageId, memoStorageId, userId };
    });

    const dryRun = await t.mutation(
      backfillAuthoredStorageObjects,
      { organizationId, dryRun: true },
    );
    expect(dryRun).toMatchObject({ discovered: 3, inserted: 0, unresolved: 1 });

    const firstRun = await t.mutation(
      backfillAuthoredStorageObjects,
      { organizationId, dryRun: false },
    );
    expect(firstRun).toMatchObject({ discovered: 3, inserted: 2, unresolved: 1 });

    const object = await t.run((ctx) =>
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique(),
    );
    expect(object).toMatchObject({
      organizationId,
      ownerUserId: userId,
      purpose: "document_attachment",
      state: "active",
    });
    const memoObject = await t.run((ctx) =>
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", memoStorageId))
        .unique(),
    );
    expect(memoObject).toMatchObject({
      ownerUserId: userId,
      purpose: "announcement_attachment",
    });

    const secondRun = await t.mutation(
      backfillAuthoredStorageObjects,
      { organizationId, dryRun: false },
    );
    expect(secondRun).toMatchObject({
      discovered: 3,
      inserted: 0,
      existing: 2,
      unresolved: 1,
    });
  });
});
