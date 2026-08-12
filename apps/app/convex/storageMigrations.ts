import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const backfillAuthoredStorageObjects = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    const [documents, memos, costItems] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect(),
      ctx.db
        .query("memos")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect(),
      ctx.db
        .query("accountingCostItems")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect(),
    ]);

    const references = new Map<
      Id<"_storage">,
      {
        ownerUserId?: Id<"users">;
        purpose:
          | "accounting_receipt"
          | "announcement_attachment"
          | "document_attachment";
        createdAt: number;
      }
    >();
    for (const document of documents) {
      for (const storageId of document.attachments ?? []) {
        references.set(storageId, {
          ownerUserId: document.createdBy,
          purpose: "document_attachment",
          createdAt: document.createdAt,
        });
      }
    }
    for (const memo of memos) {
      for (const storageId of memo.attachments ?? []) {
        references.set(storageId, {
          ownerUserId: memo.author,
          purpose: "announcement_attachment",
          createdAt: memo.createdAt,
        });
      }
    }
    for (const item of costItems) {
      for (const storageId of item.receipts ?? []) {
        references.set(storageId, {
          purpose: "accounting_receipt",
          createdAt: item.createdAt,
        });
      }
    }

    let inserted = 0;
    let existing = 0;
    let unresolved = 0;
    for (const [storageId, reference] of references) {
      const [storedObject, metadata, owner] = await Promise.all([
        ctx.db
          .query("storageObjects")
          .withIndex("by_storage", (q) => q.eq("storageId", storageId))
          .unique(),
        ctx.db.system.get("_storage", storageId),
        reference.ownerUserId
          ? ctx.db.get(reference.ownerUserId)
          : Promise.resolve(null),
      ]);

      if (storedObject) {
        if (storedObject.organizationId === args.organizationId) existing += 1;
        else unresolved += 1;
        continue;
      }
      if (!metadata || !owner || !reference.ownerUserId) {
        unresolved += 1;
        continue;
      }
      if (args.dryRun) continue;

      const now = Date.now();
      await ctx.db.insert("storageObjects", {
        storageId,
        organizationId: args.organizationId,
        ownerUserId: reference.ownerUserId,
        purpose: reference.purpose,
        contentType: metadata.contentType,
        size: metadata.size,
        state: "active",
        createdAt: reference.createdAt,
        updatedAt: now,
      });
      inserted += 1;
    }

    return {
      discovered: references.size,
      inserted,
      existing,
      unresolved,
      dryRun: args.dryRun,
    };
  },
});
