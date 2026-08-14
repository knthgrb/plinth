import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveMembership, requirePayslipMembership } from "./access";
import { runOrgQuery } from "./queryAuthGrace";
import {
  canUseAlumniPayslipAccess,
  canUseFullOrganizationAccess,
} from "@/utils/org-membership-lifecycle";
import {
  loadEffectiveDocument,
  replaceDocumentProjection,
  type EffectiveDocument,
} from "./communicationsCompatibility";

const documentVisibilityScopeValidator = v.optional(
  v.union(
    v.literal("admins_only"),
    v.literal("all_employees"),
    v.literal("department"),
    v.literal("specific_employee"),
    v.literal("alumni_visible"),
    v.literal("payroll_visible"),
  ),
);

type DocumentVisibilityScope =
  | "admins_only"
  | "all_employees"
  | "department"
  | "specific_employee"
  | "alumni_visible"
  | "payroll_visible";

type DocumentUserRecord = Doc<"users"> & {
  role: Doc<"userOrganizations">["role"];
  organizationId: Id<"organizations">;
  employeeId: Id<"employees"> | undefined;
  accessStatus: Doc<"userOrganizations">["accessStatus"];
};

function toDocumentUserRecord(
  access: Awaited<ReturnType<typeof requireActiveMembership>>,
): DocumentUserRecord {
  return {
    ...access.user,
    role: access.membership.role,
    organizationId: access.organization._id,
    employeeId: access.membership.employeeId,
    accessStatus: access.membership.accessStatus,
  };
}

async function getDocumentReadUser(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
): Promise<DocumentUserRecord> {
  const access = await requirePayslipMembership(ctx, organizationId);
  return toDocumentUserRecord(access);
}

async function getDocumentWriteUser(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
): Promise<DocumentUserRecord> {
  const access = await requireActiveMembership(ctx, organizationId);
  return toDocumentUserRecord(access);
}

function canViewAllDocumentsInOrg(role: string | undefined) {
  return role === "owner" || role === "admin";
}

function canViewAdminScopedDocuments(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "hr";
}

function canViewPayrollScopedDocuments(role: string | undefined) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "hr" ||
    role === "accounting"
  );
}

function assertDocumentWriteAccess(userRecord: DocumentUserRecord) {
  if (!canUseFullOrganizationAccess(userRecord.accessStatus)) {
    throw new Error("Document write access is not available for past organizations");
  }
}

function idsInclude(ids: unknown[] | undefined, id: unknown) {
  return Array.isArray(ids) && ids.some((item) => String(item) === String(id));
}

function resolveDocumentVisibilityScope(
  doc: EffectiveDocument,
): DocumentVisibilityScope {
  const scope = doc.visibilityScope ?? undefined;
  if (scope) return scope;
  if (doc.isShared) return "all_employees";
  if (doc.employeeId || doc.visibleEmployeeIds?.length) {
    return "specific_employee";
  }
  return "admins_only";
}

async function getUserEmployeeForDocumentAccess(
  ctx: QueryCtx,
  userRecord: DocumentUserRecord,
): Promise<Doc<"employees"> | null> {
  if (!userRecord.employeeId) return null;
  return await ctx.db.get(userRecord.employeeId);
}

function canViewDocument(
  doc: EffectiveDocument,
  userRecord: DocumentUserRecord,
  userEmployee: Doc<"employees"> | null,
) {
  const scope = doc.visibilityScope ?? resolveDocumentVisibilityScope(doc);

  if (!canUseFullOrganizationAccess(userRecord.accessStatus)) {
    return (
      scope === "alumni_visible" &&
      canUseAlumniPayslipAccess(userRecord.accessStatus)
    );
  }

  if (canViewAllDocumentsInOrg(userRecord.role)) return true;
  if (String(doc.createdBy) === String(userRecord._id)) return true;
  if (idsInclude(doc.sharedWith, userRecord._id)) return true;

  if (scope === "admins_only") {
    return canViewAdminScopedDocuments(userRecord.role);
  }

  if (scope === "all_employees") {
    return canUseFullOrganizationAccess(userRecord.accessStatus);
  }

  if (scope === "payroll_visible") {
    return (
      canUseFullOrganizationAccess(userRecord.accessStatus) &&
      canViewPayrollScopedDocuments(userRecord.role)
    );
  }

  if (scope === "alumni_visible") {
    return canUseAlumniPayslipAccess(userRecord.accessStatus);
  }

  if (scope === "department") {
    return (
      canUseFullOrganizationAccess(userRecord.accessStatus) &&
      !!userEmployee?.employment?.department &&
      idsInclude(doc.visibleDepartments, userEmployee.employment.department)
    );
  }

  if (scope === "specific_employee") {
    return (
      canUseFullOrganizationAccess(userRecord.accessStatus) &&
      (String(doc.employeeId) === String(userRecord.employeeId) ||
        idsInclude(doc.visibleEmployeeIds, userRecord.employeeId))
    );
  }

  return false;
}

function isEmptyTipTapBody(content: string | undefined) {
  if (!content) return true;
  try {
    const c = JSON.parse(content);
    return !c?.content || c.content.length === 0;
  } catch {
    return String(content).trim() === "";
  }
}

/** File upload: empty body + at least one attachment. */
function isUploadedFileOnlyRecord(doc: {
  content: string;
  attachments?: (string | null)[];
}) {
  return (
    isEmptyTipTapBody(doc.content) &&
    Array.isArray(doc.attachments) &&
    doc.attachments.length > 0
  );
}

// Get documents for organization (general storage)
export const getDocuments = query({
  args: {
    organizationId: v.id("organizations"),
    type: v.optional(
      v.union(
        v.literal("personal"),
        v.literal("employment"),
        v.literal("contract"),
        v.literal("certificate"),
        v.literal("leave_form"),
        v.literal("other")
      )
    ),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const userRecord = await getDocumentReadUser(ctx, args.organizationId);

      const documentRows = await ctx.db
        .query("documents")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();
      let documents = await Promise.all(
        documentRows.map((document) =>
          loadEffectiveDocument(ctx, document),
        ),
      );

      const userEmployee = await getUserEmployeeForDocumentAccess(
        ctx,
        userRecord,
      );
      documents = documents.filter((doc) =>
        canViewDocument(doc, userRecord, userEmployee),
      );

      if (args.type) {
        documents = documents.filter((doc) => doc.type === args.type);
      }

      documents.sort((a, b) => b.updatedAt - a.updatedAt);

      return documents;
    }, []);
  },
});

// Get single document
export const getDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const document = await ctx.db.get(args.documentId);
      if (!document) throw new Error("Document not found");

      const userRecord = await getDocumentReadUser(
        ctx,
        document.organizationId,
      );

      const userEmployee = await getUserEmployeeForDocumentAccess(
        ctx,
        userRecord,
      );
      const effectiveDocument = await loadEffectiveDocument(ctx, document);
      if (!canViewDocument(effectiveDocument, userRecord, userEmployee)) {
        throw new Error("Not authorized to view this document");
      }

      return effectiveDocument;
    }, null);
  },
});

export const getDocumentAttachmentUrl = query({
  args: {
    organizationId: v.id("organizations"),
    documentId: v.id("documents"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document || document.organizationId !== args.organizationId) {
      throw new Error("Document not found");
    }

    const userRecord = await getDocumentReadUser(ctx, args.organizationId);
    const userEmployee = await getUserEmployeeForDocumentAccess(
      ctx,
      userRecord,
    );
    const effectiveDocument = await loadEffectiveDocument(ctx, document);
    if (!canViewDocument(effectiveDocument, userRecord, userEmployee)) {
      throw new Error("Not authorized to view this document");
    }
    if (
      !effectiveDocument.attachments.some(
        (storageId) => storageId === args.storageId,
      )
    ) {
      throw new Error("Not authorized to access this attachment");
    }

    return await ctx.storage.getUrl(args.storageId);
  },
});

// Create document
export const createDocument = mutation({
  args: {
    organizationId: v.id("organizations"),
    employeeId: v.optional(v.id("employees")),
    title: v.string(),
    content: v.string(), // Rich text JSON from TipTap
    type: v.union(
      v.literal("personal"),
      v.literal("employment"),
      v.literal("contract"),
      v.literal("certificate"),
      v.literal("leave_form"),
      v.literal("other")
    ),
    category: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()),
    sharedWith: v.optional(v.array(v.id("users"))),
    visibilityScope: documentVisibilityScopeValidator,
    visibleDepartments: v.optional(v.array(v.string())),
    visibleEmployeeIds: v.optional(v.array(v.id("employees"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await getDocumentWriteUser(ctx, args.organizationId);
    assertDocumentWriteAccess(userRecord);

    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      organizationId: args.organizationId,
      employeeId: args.employeeId, // Optional, for backward compatibility
      createdBy: userRecord._id,
      title: args.title,
      content: args.content,
      type: args.type,
      category: args.category,
      isShared: args.isShared || false,
      visibilityScope: args.visibilityScope,
      contentVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const document = await ctx.db.get(documentId);
    if (!document) throw new Error("Document creation did not persist");
    await replaceDocumentProjection(
      ctx,
      document,
      {
        attachments: args.attachments ?? [],
        sharedWith: args.sharedWith ?? [],
        visibleDepartments: args.visibleDepartments ?? [],
        visibleEmployeeIds: args.visibleEmployeeIds ?? [],
      },
      now,
    );

    return documentId;
  },
});

// Update document
export const updateDocument = mutation({
  args: {
    documentId: v.id("documents"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("personal"),
        v.literal("employment"),
        v.literal("contract"),
        v.literal("certificate"),
        v.literal("leave_form"),
        v.literal("other")
      )
    ),
    category: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()),
    sharedWith: v.optional(v.array(v.id("users"))),
    visibilityScope: documentVisibilityScopeValidator,
    visibleDepartments: v.optional(v.array(v.string())),
    visibleEmployeeIds: v.optional(v.array(v.id("employees"))),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");

    const userRecord = await getDocumentWriteUser(ctx, document.organizationId);
    assertDocumentWriteAccess(userRecord);

    const canMutate =
      canViewAllDocumentsInOrg(userRecord.role) ||
      document.createdBy === userRecord._id;
    if (!canMutate) {
      throw new Error("Not authorized to update this document");
    }

    const effectiveDocument = await loadEffectiveDocument(ctx, document);
    if (isUploadedFileOnlyRecord(effectiveDocument)) {
      throw new Error(
        "Uploaded files cannot be edited in the document editor. Re-upload the file to replace it, or create a new Plinth document for rich text.",
      );
    }

    const now = Date.now();
    const updates: Partial<Doc<"documents">> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.type !== undefined) updates.type = args.type;
    if (args.category !== undefined) updates.category = args.category;
    if (args.isShared !== undefined) updates.isShared = args.isShared;
    if (args.visibilityScope !== undefined) {
      updates.visibilityScope = args.visibilityScope;
    }

    if (args.content !== undefined && args.content !== document.content) {
      const currentVersion = document.contentVersion ?? 1;
      await ctx.db.insert("documentVersions", {
        documentId: args.documentId,
        organizationId: document.organizationId,
        version: currentVersion,
        title: document.title,
        content: document.content,
        createdAt: now,
        createdBy: userRecord._id,
      });
      updates.content = args.content;
      updates.contentVersion = currentVersion + 1;
    }

    await replaceDocumentProjection(
      ctx,
      document,
      {
        attachments: args.attachments ?? effectiveDocument.attachments,
        sharedWith: args.sharedWith ?? effectiveDocument.sharedWith,
        visibleDepartments:
          args.visibleDepartments ?? effectiveDocument.visibleDepartments,
        visibleEmployeeIds:
          args.visibleEmployeeIds ?? effectiveDocument.visibleEmployeeIds,
      },
      now,
    );
    await ctx.db.patch(args.documentId, updates);
    return { success: true };
  },
});

// Delete document
export const deleteDocument = mutation({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");

    const userRecord = await getDocumentWriteUser(ctx, document.organizationId);
    assertDocumentWriteAccess(userRecord);

    const canMutate =
      canViewAllDocumentsInOrg(userRecord.role) ||
      document.createdBy === userRecord._id;
    if (!canMutate) {
      throw new Error("Not authorized to delete this document");
    }

    const versionRows = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    for (const row of versionRows) {
      await ctx.db.delete(row._id);
    }

    await replaceDocumentProjection(
      ctx,
      document,
      {
        sharedWith: [],
        visibleEmployeeIds: [],
        visibleDepartments: [],
        attachments: [],
      },
      Date.now(),
    );

    await ctx.db.delete(args.documentId);
    return { success: true };
  },
});
