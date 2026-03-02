import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr" | "accounting"
) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await ctx.db
    .query("users")
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) throw new Error("User not found");

  if (!organizationId) {
    throw new Error("Organization ID is required");
  }

  // Check user's role in the specific organization
  const userOrg = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_user_organization", (q: any) =>
      q.eq("userId", userRecord._id).eq("organizationId", organizationId)
    )
    .first();

  // Fallback to legacy organizationId/role fields for backward compatibility
  let userRole: string | undefined = userOrg?.role;
  const hasAccess =
    userOrg ||
    (userRecord.organizationId === organizationId && userRecord.role);

  if (!hasAccess) {
    throw new Error("User is not a member of this organization");
  }

  // Use legacy role if userOrg doesn't exist
  if (!userRole && userRecord.organizationId === organizationId) {
    userRole = userRecord.role;
  }

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

  return { ...userRecord, role: userRole, organizationId };
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
        v.literal("other")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    let documents = await (ctx.db.query("documents") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Filter by type if specified
    if (args.type) {
      documents = documents.filter((doc: any) => doc.type === args.type);
    }

    // Sort by updated date
    documents.sort((a: any, b: any) => b.updatedAt - a.updatedAt);

    return documents;
  },
});

// Get single document
export const getDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");

    await checkAuth(ctx, document.organizationId);

    // All authenticated users in the organization can view documents
    return document;
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
      v.literal("other")
    ),
    category: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()),
    sharedWith: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

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
        v.literal("other")
      )
    ),
    category: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    isShared: v.optional(v.boolean()),
    sharedWith: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found");

    await checkAuth(ctx, document.organizationId);

    // All authenticated users in the organization can update documents

    const updates: any = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.type !== undefined) updates.type = args.type;
    if (args.category !== undefined) updates.category = args.category;
    if (args.attachments !== undefined) updates.attachments = args.attachments;
    if (args.isShared !== undefined) updates.isShared = args.isShared;
    if (args.sharedWith !== undefined) updates.sharedWith = args.sharedWith;

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

    await checkAuth(ctx, document.organizationId);

    // All authenticated users in the organization can delete documents

    await ctx.db.delete(args.documentId);
    return { success: true };
  },
});
