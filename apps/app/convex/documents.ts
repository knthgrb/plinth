import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveMembership } from "./access";
import { runOrgQuery } from "./queryAuthGrace";
import {
  canUseAlumniPayslipAccess,
  canUseFullOrganizationAccess,
} from "@/utils/org-membership-lifecycle";

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

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr" | "accounting"
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Allow admin to access everything
  // For read operations, allow accounting role
  // For write operations (requiredRole specified), only allow specified role or admin
  if (requiredRole) {
    if (
      userRole !== requiredRole &&
      userRole !== "owner" &&
      userRole !== "admin"
    ) {
      throw new Error("Not authorized");
    }
  } else {
    // No required role means read access - allow accounting
    if (
      userRole !== "owner" &&
      userRole !== "admin" &&
      userRole !== "hr" &&
      userRole !== "accounting" &&
      userRole !== "employee"
    ) {
      throw new Error("Not authorized");
    }
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
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

function assertDocumentWriteAccess(userRecord: any) {
  if (!canUseFullOrganizationAccess(userRecord.accessStatus)) {
    throw new Error("Document write access is not available for past organizations");
  }
}

function idsInclude(ids: unknown[] | undefined, id: unknown) {
  return Array.isArray(ids) && ids.some((item) => String(item) === String(id));
}

function resolveDocumentVisibilityScope(doc: any): DocumentVisibilityScope {
  const scope = doc.visibilityScope ?? undefined;
  if (scope) return scope;
  if (doc.isShared) return "all_employees";
  if (doc.employeeId || doc.visibleEmployeeIds?.length) {
    return "specific_employee";
  }
  return "admins_only";
}

async function getUserEmployeeForDocumentAccess(ctx: any, userRecord: any) {
  if (!userRecord.employeeId) return null;
  return await ctx.db.get(userRecord.employeeId);
}

function canViewDocument(doc: any, userRecord: any, userEmployee: any) {
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
      const userRecord = await checkAuth(ctx, args.organizationId);

      let documents = await (ctx.db.query("documents") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId),
        )
        .collect();

      const userEmployee = await getUserEmployeeForDocumentAccess(
        ctx,
        userRecord,
      );
      documents = documents.filter((doc: any) =>
        canViewDocument(doc, userRecord, userEmployee),
      );

      if (args.type) {
        documents = documents.filter((doc: any) => doc.type === args.type);
      }

      documents.sort((a: any, b: any) => b.updatedAt - a.updatedAt);

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

      const userRecord = await checkAuth(ctx, document.organizationId);

      const userEmployee = await getUserEmployeeForDocumentAccess(
        ctx,
        userRecord,
      );
      if (!canViewDocument(document, userRecord, userEmployee)) {
        throw new Error("Not authorized to view this document");
      }

      return document;
    }, null);
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
    const userRecord = await checkAuth(ctx, args.organizationId);
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
      attachments: args.attachments,
      isShared: args.isShared || false,
      sharedWith: args.sharedWith || [],
      visibilityScope: args.visibilityScope,
      visibleDepartments: args.visibleDepartments,
      visibleEmployeeIds: args.visibleEmployeeIds,
      contentVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

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

    const userRecord = await checkAuth(ctx, document.organizationId);
    assertDocumentWriteAccess(userRecord);

    const canMutate =
      canViewAllDocumentsInOrg(userRecord.role) ||
      document.createdBy === userRecord._id;
    if (!canMutate) {
      throw new Error("Not authorized to update this document");
    }

    if (isUploadedFileOnlyRecord(document as any)) {
      throw new Error(
        "Uploaded files cannot be edited in the document editor. Re-upload the file to replace it, or create a new Plinth document for rich text.",
      );
    }

    const now = Date.now();
    const updates: any = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.type !== undefined) updates.type = args.type;
    if (args.category !== undefined) updates.category = args.category;
    if (args.attachments !== undefined) updates.attachments = args.attachments;
    if (args.isShared !== undefined) updates.isShared = args.isShared;
    if (args.sharedWith !== undefined) updates.sharedWith = args.sharedWith;
    if (args.visibilityScope !== undefined) {
      updates.visibilityScope = args.visibilityScope;
    }
    if (args.visibleDepartments !== undefined) {
      updates.visibleDepartments = args.visibleDepartments;
    }
    if (args.visibleEmployeeIds !== undefined) {
      updates.visibleEmployeeIds = args.visibleEmployeeIds;
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

    const userRecord = await checkAuth(ctx, document.organizationId);
    assertDocumentWriteAccess(userRecord);

    const canMutate =
      canViewAllDocumentsInOrg(userRecord.role) ||
      document.createdBy === userRecord._id;
    if (!canMutate) {
      throw new Error("Not authorized to delete this document");
    }

    const versionRows = await (ctx.db.query("documentVersions") as any)
      .withIndex("by_document", (q: any) => q.eq("documentId", args.documentId))
      .collect();
    for (const row of versionRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.delete(args.documentId);
    return { success: true };
  },
});
