import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveMembership } from "./access";
import type { Id } from "./_generated/dataModel";

const UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;

const storagePurpose = v.union(
  v.literal("accounting_receipt"),
  v.literal("announcement_attachment"),
  v.literal("applicant_resume"),
  v.literal("chat_attachment"),
  v.literal("document_attachment"),
  v.literal("employee_requirement"),
  v.literal("leave_attachment"),
  v.literal("memo_attachment"),
  v.literal("payslip_pdf"),
);

type StoragePurpose =
  | "accounting_receipt"
  | "announcement_attachment"
  | "applicant_resume"
  | "chat_attachment"
  | "document_attachment"
  | "employee_requirement"
  | "leave_attachment"
  | "memo_attachment"
  | "payslip_pdf";

const restrictedUploadRoles: Partial<
  Record<StoragePurpose, ReadonlySet<string>>
> = {
  accounting_receipt: new Set(["owner", "admin", "accounting"]),
  announcement_attachment: new Set(["owner", "admin", "hr"]),
  applicant_resume: new Set(["owner", "admin", "hr"]),
  memo_attachment: new Set(["owner", "admin", "hr"]),
  payslip_pdf: new Set(["owner", "admin", "hr", "accounting"]),
};

function containsStorageId(
  storageIds: Id<"_storage">[] | undefined,
  storageId: Id<"_storage">,
) {
  return storageIds?.some((id) => id === storageId) ?? false;
}

async function hasLegacyStorageReference(
  ctx: Parameters<typeof requireActiveMembership>[0],
  organizationId: Id<"organizations">,
  storageId: Id<"_storage">,
) {
  const [documents, memos, employees, leaveRequests, applicants, costItems, payslips] =
    await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("memos")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("employees")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("leaveRequests")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("applicants")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("accountingCostItems")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
      ctx.db
        .query("payslips")
        .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
        .collect(),
    ]);

  if (
    documents.some((document) =>
      containsStorageId(document.attachments, storageId),
    ) ||
    memos.some((memo) => containsStorageId(memo.attachments, storageId)) ||
    employees.some((employee) =>
      employee.requirements?.some((requirement) => requirement.file === storageId),
    ) ||
    leaveRequests.some((request) =>
      containsStorageId(request.supportingDocuments, storageId),
    ) ||
    applicants.some((applicant) => applicant.resume === storageId) ||
    costItems.some((item) => containsStorageId(item.receipts, storageId)) ||
    payslips.some((payslip) => payslip.pdfFile === storageId)
  ) {
    return true;
  }

  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
  for (const conversation of conversations) {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .collect();
    if (
      messages.some((message) =>
        containsStorageId(message.attachments, storageId),
      )
    ) {
      return true;
    }
  }

  return false;
}

export const createUploadIntent = mutation({
  args: {
    organizationId: v.id("organizations"),
    purpose: storagePurpose,
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const allowedRoles = restrictedUploadRoles[args.purpose];
    if (allowedRoles && !allowedRoles.has(membership.role)) {
      throw new Error("Not authorized");
    }
    const createdAt = Date.now();
    const intentId = await ctx.db.insert("storageUploadIntents", {
      organizationId: args.organizationId,
      ownerUserId: user._id,
      purpose: args.purpose,
      expiresAt: createdAt + UPLOAD_INTENT_TTL_MS,
      createdAt,
    });

    return {
      intentId,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});

export const registerUploadedFile = mutation({
  args: {
    intentId: v.id("storageUploadIntents"),
    storageId: v.id("_storage"),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent) throw new Error("Not authorized");

    const { user } = await requireActiveMembership(ctx, intent.organizationId);
    if (
      intent.ownerUserId !== user._id ||
      intent.consumedAt !== undefined ||
      intent.expiresAt <= Date.now()
    ) {
      throw new Error("Not authorized");
    }

    const [metadata, existingObject] = await Promise.all([
      ctx.db.system.get("_storage", args.storageId),
      ctx.db
        .query("storageObjects")
        .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
        .unique(),
    ]);
    if (!metadata || existingObject || metadata._creationTime < intent.createdAt) {
      throw new Error("Not authorized");
    }

    const now = Date.now();
    const storageObjectId = await ctx.db.insert("storageObjects", {
      storageId: args.storageId,
      organizationId: intent.organizationId,
      ownerUserId: user._id,
      purpose: intent.purpose,
      fileName: args.fileName,
      contentType: metadata.contentType,
      size: metadata.size,
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(intent._id, {
      storageId: args.storageId,
      consumedAt: now,
    });

    return storageObjectId;
  },
});

async function requireStorageObject(
  ctx: Parameters<typeof requireActiveMembership>[0],
  organizationId: Parameters<typeof requireActiveMembership>[1],
  storageId: Id<"_storage">,
) {
  await requireActiveMembership(ctx, organizationId);
  const storageObject = await ctx.db
    .query("storageObjects")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (!storageObject) {
    if (await hasLegacyStorageReference(ctx, organizationId, storageId)) {
      return null;
    }
    throw new Error("Not authorized");
  }
  if (
    storageObject.organizationId !== organizationId ||
    storageObject.state !== "active"
  ) {
    throw new Error("Not authorized");
  }

  return storageObject;
}

// Get file URL from storage ID
export const getFileUrl = query({
  args: {
    organizationId: v.id("organizations"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireStorageObject(ctx, args.organizationId, args.storageId);
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Get file URL and content type for chat (preview vs download)
export const getFileUrlAndType = query({
  args: {
    organizationId: v.id("organizations"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const storageObject = await requireStorageObject(
      ctx,
      args.organizationId,
      args.storageId,
    );
    const [url, meta] = await Promise.all([
      ctx.storage.getUrl(args.storageId),
      ctx.db.system.get("_storage", args.storageId),
    ]);
    return {
      url: url ?? null,
      contentType:
        storageObject?.contentType ??
        (meta as { contentType?: string } | null)?.contentType ??
        null,
    };
  },
});
