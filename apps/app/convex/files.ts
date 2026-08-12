import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireIdentity } from "./access";

// Generate upload URL for file uploads
export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    await requireIdentity(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Get file URL from storage ID
export const getFileUrl = query({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Get file URL and content type for chat (preview vs download)
export const getFileUrlAndType = query({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const [url, meta] = await Promise.all([
      ctx.storage.getUrl(args.storageId),
      ctx.db.system.get("_storage", args.storageId),
    ]);
    return {
      url: url ?? null,
      contentType: (meta as { contentType?: string } | null)?.contentType ?? null,
    };
  },
});
