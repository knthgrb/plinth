import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireActiveMembership } from "./access";
import type { Id } from "./_generated/dataModel";
import { loadEffectiveLeaveAttachments } from "./communicationsCompatibility";
import { requireSensitiveLeaveAccess } from "./leaveAccess";

const UPLOAD_INTENT_TTL_MS = 10 * 60 * 1000;

const storagePurpose = v.union(
  v.literal("accounting_receipt"),
  v.literal("announcement_attachment"),
  v.literal("applicant_resume"),
  v.literal("chat_attachment"),
  v.literal("document_attachment"),
  v.literal("employee_requirement"),
  v.literal("evaluation_attachment"),
  v.literal("leave_attachment"),
  v.literal("memo_attachment"),
  v.literal("payslip_pdf"),
);

export type StoragePurpose =
  | "accounting_receipt"
  | "announcement_attachment"
  | "applicant_resume"
  | "chat_attachment"
  | "document_attachment"
  | "employee_requirement"
  | "evaluation_attachment"
  | "leave_attachment"
  | "memo_attachment"
  | "payslip_pdf";

const restrictedUploadRoles: Partial<
  Record<StoragePurpose, ReadonlySet<string>>
> = {
  accounting_receipt: new Set(["owner", "admin", "accounting"]),
  announcement_attachment: new Set(["owner", "admin", "hr"]),
  applicant_resume: new Set(["owner", "admin", "hr"]),
  evaluation_attachment: new Set(["owner", "admin", "hr"]),
  memo_attachment: new Set(["owner", "admin", "hr"]),
  payslip_pdf: new Set(["owner", "admin", "hr", "accounting"]),
};

async function findStorageReferencePurpose(
  ctx: Parameters<typeof requireActiveMembership>[0],
  organizationId: Id<"organizations">,
  storageId: Id<"_storage">,
) {
  const [links, requirements, applicants, payslips] = await Promise.all([
    ctx.db
      .query("storageObjectLinks")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
    ctx.db
      .query("employeeRequirements")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
    ctx.db
      .query("applicants")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
    ctx.db
      .query("payslips")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .collect(),
  ]);

  const link = links.find((candidate) => candidate.storageId === storageId);
  if (link) return link.purpose;
  if (requirements.some((requirement) => requirement.file === storageId)) {
    return "employee_requirement" as const;
  }
  if (applicants.some((applicant) => applicant.resume === storageId)) {
    return "applicant_resume" as const;
  }
  if (payslips.some((payslip) => payslip.pdfFile === storageId)) {
    return "payslip_pdf" as const;
  }
  return null;
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
    if (
      !metadata ||
      existingObject ||
      metadata._creationTime < intent.createdAt
    ) {
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
  const leaveLink = await ctx.db
    .query("storageObjectLinks")
    .withIndex("by_storage_parent", (q) =>
      q.eq("storageId", storageId).eq("parentType", "leave_request"),
    )
    .first();
  if (leaveLink) throw new Error("Use the leave attachment access endpoint");
  const storageObject = await ctx.db
    .query("storageObjects")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .unique();
  if (!storageObject) {
    const referencePurpose = await findStorageReferencePurpose(
      ctx,
      organizationId,
      storageId,
    );
    if (referencePurpose === "chat_attachment") {
      throw new Error("Chat attachments require conversation access");
    }
    if (referencePurpose === "evaluation_attachment") {
      throw new Error("Evaluation attachments require evaluation access");
    }
    if (referencePurpose) {
      return null;
    }
    throw new Error("Not authorized");
  }
  if (
    storageObject.organizationId !== organizationId ||
    storageObject.state !== "active" ||
    storageObject.purpose === "leave_attachment"
  ) {
    throw new Error("Not authorized");
  }
  if (storageObject.purpose === "chat_attachment") {
    throw new Error("Chat attachments require conversation access");
  }
  if (storageObject.purpose === "evaluation_attachment") {
    throw new Error("Evaluation attachments require evaluation access");
  }

  return storageObject;
}

export async function requireRegisteredStorageObject(
  ctx: Parameters<typeof requireActiveMembership>[0],
  args: {
    organizationId: Id<"organizations">;
    storageId: Id<"_storage">;
    ownerUserId: Id<"users">;
    purpose: StoragePurpose;
  },
) {
  const storageObject = await ctx.db
    .query("storageObjects")
    .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
    .unique();
  if (
    !storageObject ||
    storageObject.organizationId !== args.organizationId ||
    storageObject.ownerUserId !== args.ownerUserId ||
    storageObject.purpose !== args.purpose ||
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

export const getLeaveAttachmentUrl = query({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.leaveRequestId);
    if (!request) {
      throw new Error("Not authorized");
    }
    await requireSensitiveLeaveAccess(
      ctx,
      request.organizationId,
      request.employeeId,
    );
    const attachments = await loadEffectiveLeaveAttachments(ctx, request);
    if (!attachments.includes(args.storageId)) {
      throw new Error("Not authorized");
    }

    const storageObject = await ctx.db
      .query("storageObjects")
      .withIndex("by_storage", (query) =>
        query.eq("storageId", args.storageId),
      )
      .unique();
    if (
      storageObject &&
      (storageObject.organizationId !== request.organizationId ||
        storageObject.purpose !== "leave_attachment" ||
        storageObject.state !== "active")
    ) {
      throw new Error("Not authorized");
    }

    return await ctx.storage.getUrl(args.storageId);
  },
});
