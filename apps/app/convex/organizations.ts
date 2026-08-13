import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { runOrgQuery } from "./queryAuthGrace";
import {
  canRemoveOrganizationMember,
  canUpdateOrganizationMemberRole,
  getAssignableOrganizationRoleOptions,
} from "@/utils/organization-roles";
import {
  canUseAlumniPayslipAccess,
  canUseFullOrganizationAccess,
  normalizeOrgMembershipAccessStatus,
} from "@/utils/org-membership-lifecycle";
import { requireActiveMembership, requirePayslipMembership } from "./access";
import {
  getEffectiveOrganization,
  getEffectiveRequirementDefinitions,
  replaceRequirementConfiguration,
  upsertPayrollConfiguration,
} from "./organizationConfiguration";
import { loadPayslipCredentialHash } from "./payslipPinResetDb";
import {
  loadEffectiveEmployeeRequirements,
  replaceEmployeeRequirements,
} from "./leaveEmployeeCompatibility";

const defaultRequirementValidator = v.object({
  type: v.string(),
  isRequired: v.optional(v.boolean()),
  appliesToDepartments: v.optional(v.array(v.string())),
  appliesToEmploymentTypes: v.optional(v.array(v.string())),
  reminderDaysBeforeDue: v.optional(v.number()),
  requiresVerification: v.optional(v.boolean()),
  expiryDaysAfterSubmission: v.optional(v.number()),
});

function buildEmployeeRequirementFromDefault(req: any) {
  return {
    type: req.type,
    status: "pending" as const,
    isRequired: req.isRequired ?? true,
    appliesToDepartments: req.appliesToDepartments,
    appliesToEmploymentTypes: req.appliesToEmploymentTypes,
    reminderDaysBeforeDue: req.reminderDaysBeforeDue,
    requiresVerification: req.requiresVerification ?? true,
    expiryDate: req.expiryDaysAfterSubmission
      ? Date.now() + req.expiryDaysAfterSubmission * 24 * 60 * 60 * 1000
      : undefined,
    isDefault: true,
    isCustom: false,
  };
}

function mergeDefaultRequirementPolicy(existing: any, defaultReq: any) {
  return {
    ...existing,
    isRequired: defaultReq.isRequired ?? existing.isRequired ?? true,
    appliesToDepartments: defaultReq.appliesToDepartments,
    appliesToEmploymentTypes: defaultReq.appliesToEmploymentTypes,
    reminderDaysBeforeDue: defaultReq.reminderDaysBeforeDue,
    requiresVerification:
      defaultReq.requiresVerification ?? existing.requiresVerification ?? true,
    expiryDate:
      existing.expiryDate ??
      (defaultReq.expiryDaysAfterSubmission
        ? Date.now() +
          defaultReq.expiryDaysAfterSubmission * 24 * 60 * 60 * 1000
        : undefined),
  };
}

// Mutation to ensure user record exists (can be called after signup/signin)
export const ensureUserRecord = mutation({
  args: {},
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

    let userRecord = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", user.email))
      .first();

    if (!userRecord) {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        email: user.email,
        name: user.name || undefined,
        createdAt: now,
        updatedAt: now,
      });
      userRecord = await ctx.db.get(userId);
    }

    return userRecord?._id;
  },
});

// Helper to get user record (queries only - cannot insert in queries)
async function getUserRecord(ctx: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  const userRecord = await (ctx.db.query("users") as any)
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) {
    throw new Error(
      "User record not found. Please complete your account setup.",
    );
  }

  if ((userRecord as any).isActive === false) {
    throw new Error("Account is inactive. Please contact your administrator.");
  }

  return userRecord;
}

// Helper for mutations only: get existing user record or create one (e.g. after signup before ensureUserRecord ran)
async function getOrCreateUserRecord(ctx: any) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not authenticated");

  let userRecord = await (ctx.db.query("users") as any)
    .withIndex("by_email", (q: any) => q.eq("email", user.email))
    .first();

  if (!userRecord) {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: user.email,
      name: user.name || undefined,
      createdAt: now,
      updatedAt: now,
    });
    userRecord = await ctx.db.get(userId);
  }

  return userRecord!;
}

// Helper for queries: get user record or null (never throws — avoids race after signup and prod auth differences)
async function getUserRecordOrNull(ctx: any) {
  try {
    const user = await authComponent.getAuthUser(ctx);
    if (!user?.email) return null;

    const userRecord = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", user.email))
      .first();

    // Inactive accounts (e.g. archived employee) cannot use the app
    if (userRecord && (userRecord as any).isActive === false) return null;
    return userRecord ?? null;
  } catch {
    return null;
  }
}

// Helper to check authorization with organization context
async function checkAuth(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
  requiredRole?: "owner" | "admin" | "hr",
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  const userRole = membership.role;

  // Owner has all admin privileges
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";
  if (requiredRole && userRole !== requiredRole && !isOwnerOrAdmin) {
    throw new Error("Not authorized");
  }

  return {
    ...user,
    role: userRole,
    organizationId,
    employeeId: membership.employeeId,
    accessStatus: membership.accessStatus,
  };
}

async function countOrganizationOwners(ctx: any, organizationId: any) {
  const userOrgs = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .collect();

  return userOrgs.filter(
    (userOrg: any) =>
      userOrg.role === "owner" &&
      canUseFullOrganizationAccess(userOrg.accessStatus),
  ).length;
}

function isVisibleMembership(
  userOrg: Pick<Doc<"userOrganizations">, "accessStatus">,
): boolean {
  const status = normalizeOrgMembershipAccessStatus(userOrg?.accessStatus);
  return status === "active" || status === "alumni";
}

async function getPreferredVisibleMembership(
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
): Promise<Doc<"userOrganizations"> | null> {
  const memberships = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user", (query) => query.eq("userId", user._id))
    .collect();
  const visible = memberships.filter(isVisibleMembership);
  return (
    visible.find(
      (membership) =>
        membership.organizationId === user.lastActiveOrganizationId,
    ) ??
    visible.find(
      (membership) =>
        normalizeOrgMembershipAccessStatus(membership.accessStatus) ===
        "active",
    ) ??
    visible[0] ??
    null
  );
}

function canAssignRole(actorRole: string | null | undefined, nextRole: string) {
  return getAssignableOrganizationRoleOptions(actorRole).some(
    (option) => option.value === nextRole,
  );
}

// Get all organizations for current user (never throws in prod — returns [] on any error so signup never shows "Server Error")
export const getUserOrganizations = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userRecord = await getUserRecordOrNull(ctx);
      if (!userRecord) return [];

      // Get all user-organization relationships
      const userOrgs = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user", (q: any) => q.eq("userId", userRecord._id))
        .collect();

      // Fetch organization details
      const organizations = await Promise.all(
        userOrgs.map(async (userOrg: any) => {
          if (!isVisibleMembership(userOrg)) return null;
          const org = await getEffectiveOrganization(
            ctx,
            userOrg.organizationId,
          );
          if (!org) return null;
          if ((org as any).status === "archived") return null;
          return {
            ...org,
            role: userOrg.role,
            accessStatus: normalizeOrgMembershipAccessStatus(
              userOrg.accessStatus,
            ),
            employeeId: userOrg.employeeId,
            joinedAt: userOrg.joinedAt,
          };
        }),
      );

      // Filter out nulls
      const validOrgs = organizations.filter((org) => org !== null);

      // Sort organizations: last active organization first, then by joinedAt
      if (userRecord.lastActiveOrganizationId && validOrgs.length > 0) {
        const lastActiveIndex = validOrgs.findIndex(
          (org) => org._id === userRecord.lastActiveOrganizationId,
        );
        if (lastActiveIndex > 0) {
          const lastActiveOrg = validOrgs[lastActiveIndex];
          validOrgs.splice(lastActiveIndex, 1);
          validOrgs.unshift(lastActiveOrg);
        }
      }

      return validOrgs;
    } catch {
      // In prod, auth/replication can differ; never surface server error on signup — return [] so user sees step 2
      return [];
    }
  },
});

// Get current user with current organization context
export const getCurrentUser = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecordOrNull(ctx);
    if (!userRecord) return null;
    if ((userRecord as any).isActive === false) return null;

    const requestedOrganizationId = args.organizationId;
    const userOrg = requestedOrganizationId
      ? await ctx.db
          .query("userOrganizations")
          .withIndex("by_user_organization", (query) =>
            query
              .eq("userId", userRecord._id)
              .eq("organizationId", requestedOrganizationId),
          )
          .unique()
      : await getPreferredVisibleMembership(ctx, userRecord);

    if (!userOrg || !canUseAlumniPayslipAccess(userOrg.accessStatus)) {
      return null;
    }
    const currentOrg = await getEffectiveOrganization(
      ctx,
      userOrg.organizationId,
    );
    if (!currentOrg || currentOrg.status === "archived") return null;

    return {
      ...userRecord,
      organization: currentOrg,
      role: userOrg.role,
      accessStatus: normalizeOrgMembershipAccessStatus(
        userOrg.accessStatus,
      ),
      employeeId: userOrg.employeeId,
    };
  },
});

// Update last active organization for user (no-op when unauthenticated, e.g. during logout)
export const updateLastActiveOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await authComponent.getAuthUser(ctx);
    } catch {
      // getAuthUser throws when unauthenticated (e.g. during logout); no-op instead of surfacing error
      return { success: false };
    }
    if (!user) return { success: false };

    const userRecord = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", user.email))
      .first();
    if (!userRecord) return { success: false };

    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", args.organizationId),
      )
      .first();

    if (!userOrg || !canUseAlumniPayslipAccess(userOrg.accessStatus)) {
      return { success: false };
    }

    await ctx.db.patch(userRecord._id, {
      lastActiveOrganizationId: args.organizationId,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// Get user by ID
export const getUserById = query({
  args: {
    userId: v.id("users"),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    const userOrg = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (query) =>
        query
          .eq("userId", args.userId)
          .eq("organizationId", args.organizationId),
      )
      .unique();
    if (!userOrg || (userOrg.accessStatus ?? "active") !== "active") {
      throw new Error("Not authorized");
    }

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: userOrg.role,
    };
  },
});

// Create organization (user becomes admin)
export const createOrganization = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    taxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Use getOrCreate so signup step 2 works even if ensureUserRecord didn't run (e.g. prod timing)
    const userRecord = await getOrCreateUserRecord(ctx);

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: args.name,
      address: args.address,
      phone: args.phone,
      email: args.email,
      taxId: args.taxId,
      status: "active",
      firstPayDate: 15, // Default: 15th of the month
      secondPayDate: 30, // Default: 30th of the month
      createdAt: now,
      updatedAt: now,
    });

    await upsertPayrollConfiguration(ctx, organizationId, {
      salaryPaymentFrequency: "bimonthly",
      firstPayDate: 15,
      secondPayDate: 30,
    });

    // Create user-organization relationship with owner role
    await ctx.db.insert("userOrganizations", {
      userId: userRecord._id,
      organizationId,
      role: "owner",
      accessStatus: "active",
      accessUpdatedAt: now,
      accessUpdatedBy: userRecord._id,
      joinedAt: now,
      updatedAt: now,
    });

    // Also update legacy fields for backward compatibility
    if (!userRecord.organizationId) {
      await ctx.db.patch(userRecord._id, {
        organizationId,
        role: "owner",
        updatedAt: now,
      });
    }

    return organizationId;
  },
});

// Update organization
export const updateOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    taxId: v.optional(v.string()),
    firstPayDate: v.optional(v.number()),
    secondPayDate: v.optional(v.number()),
    salaryPaymentFrequency: v.optional(
      v.union(v.literal("monthly"), v.literal("bimonthly")),
    ),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const allowedRoles = ["admin", "owner", "accounting"];
    if (!allowedRoles.includes(membership.role)) {
      throw new Error("Only admins or accounting can update organization");
    }

    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.status === "archived") {
      throw new Error("Only active organizations can be updated");
    }

    const updates: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.address !== undefined) updates.address = args.address;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.email !== undefined) updates.email = args.email;
    if (args.taxId !== undefined) updates.taxId = args.taxId;
    if (args.firstPayDate !== undefined)
      updates.firstPayDate = args.firstPayDate;
    if (args.secondPayDate !== undefined)
      updates.secondPayDate = args.secondPayDate;
    if (args.salaryPaymentFrequency !== undefined)
      updates.salaryPaymentFrequency = args.salaryPaymentFrequency;

    await ctx.db.patch(args.organizationId, updates);
    if (
      args.salaryPaymentFrequency !== undefined ||
      args.firstPayDate !== undefined ||
      args.secondPayDate !== undefined
    ) {
      await upsertPayrollConfiguration(ctx, args.organizationId, {
        salaryPaymentFrequency: args.salaryPaymentFrequency,
        firstPayDate: args.firstPayDate,
        secondPayDate: args.secondPayDate,
      });
    }
    return { success: true };
  },
});

// Delete organization (only owner can delete)
export const deleteOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    if (membership.role !== "owner") {
      throw new Error("Only organization owners can delete organizations");
    }

    // Get all related data to delete
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Archive memberships so the org disappears from switchers without
    // destroying account or employee history.
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    for (const userOrg of userOrgs) {
      await ctx.db.patch(userOrg._id, {
        accessStatus: "removed",
        accessUpdatedAt: Date.now(),
        accessUpdatedBy: user._id,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.patch(args.organizationId, {
      status: "archived",
      archivedAt: Date.now(),
      archivedBy: user._id,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Get organization details (returns null when unauthenticated, unauthorized, or missing —
// never throws so hard refresh + URL org id before client auth sync does not crash the app)
export const getOrganization = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecordOrNull(ctx);
    if (!userRecord) return null;

    // Check if user has access to this organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", args.organizationId),
      )
      .first();

    if (!userOrg || !canUseAlumniPayslipAccess(userOrg.accessStatus)) {
      return null;
    }

    const organization = await getEffectiveOrganization(
      ctx,
      args.organizationId,
    );
    if (!organization) {
      return null;
    }
    if ((organization as any).status === "archived") {
      return null;
    }

    return organization;
  },
});

// Get organization members
export const getOrganizationMembers = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);

    // Get all user-organization relationships for this org
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Fetch user details
    const members = await Promise.all(
      userOrgs.map(async (userOrg: any) => {
        if (
          normalizeOrgMembershipAccessStatus(userOrg.accessStatus) === "removed"
        ) {
          return null;
        }
        const user = await ctx.db.get(userOrg.userId);
        return {
          ...user,
          role: userOrg.role,
          accessStatus: normalizeOrgMembershipAccessStatus(
            userOrg.accessStatus,
          ),
          employeeId: userOrg.employeeId,
          joinedAt: userOrg.joinedAt,
        };
      }),
    );

    return members.filter(Boolean);
  },
});

// Add user to organization (invite)
export const addUserToOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const actorRole = membership.role;

    const isAuthorized =
      actorRole === "admin" || actorRole === "owner" || actorRole === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to add users to organization");
    }
    if (!canAssignRole(actorRole, args.role)) {
      throw new Error("Not authorized to assign this organization role");
    }

    // Find or create user
    let targetUser = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", args.email))
      .first();

    if (!targetUser) {
      // Create user record (Better Auth will handle actual user creation)
      const now = Date.now();
      targetUser = await ctx.db.insert("users", {
        email: args.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Check if user is already in this organization
    const existingUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", targetUser._id)
          .eq("organizationId", args.organizationId),
      )
      .first();

    const now = Date.now();

    if (existingUserOrg) {
      // Update existing relationship
      await ctx.db.patch(existingUserOrg._id, {
        role: args.role,
        employeeId: args.employeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: user._id,
        updatedAt: now,
      });
    } else {
      // Create new relationship
      await ctx.db.insert("userOrganizations", {
        userId: targetUser._id,
        organizationId: args.organizationId,
        role: args.role,
        employeeId: args.employeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: user._id,
        joinedAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

// Remove user from organization
export const removeUserFromOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const actorRole = membership.role;

    const isOwnerOrAdmin = actorRole === "admin" || actorRole === "owner";

    if (!isOwnerOrAdmin) {
      throw new Error(
        "Only organization owners or admins can remove users from organization",
      );
    }

    // Prevent removing yourself
    if (args.userId === user._id) {
      throw new Error("Cannot remove yourself from organization");
    }

    // Remove organization access without deleting the account or employee record.
    const targetUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .first();

    if (!targetUserOrg) {
      throw new Error("User is not a member of this organization");
    }

    const ownerCount = await countOrganizationOwners(ctx, args.organizationId);
    const removalDecision = canRemoveOrganizationMember({
      actorRole,
      targetRole: targetUserOrg.role,
      isSelf: args.userId === user._id,
      ownerCount,
    });
    if (!removalDecision.allowed) {
      throw new Error(removalDecision.reason);
    }

    await ctx.db.patch(targetUserOrg._id, {
      accessStatus: "removed",
      accessUpdatedAt: Date.now(),
      accessUpdatedBy: user._id,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update user role in organization
export const updateUserRoleInOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
  },
  handler: async (ctx, args) => {
    const { user, membership } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );
    const actorRole = membership.role;

    const canUpdateRoles =
      actorRole === "admin" || actorRole === "owner" || actorRole === "hr";

    if (!canUpdateRoles) {
      throw new Error(
        "Only organization owners, admins, or HR can update user roles",
      );
    }

    // Update user-organization relationship
    const targetUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId),
      )
      .first();

    if (!targetUserOrg) {
      throw new Error("User is not a member of this organization");
    }

    const ownerCount = await countOrganizationOwners(ctx, args.organizationId);
    const roleDecision = canUpdateOrganizationMemberRole({
      actorRole,
      targetRole: targetUserOrg.role,
      nextRole: args.role,
      isSelf: user._id === args.userId,
      ownerCount,
    });
    if (!roleDecision.allowed) {
      throw new Error(roleDecision.reason);
    }

    await ctx.db.patch(targetUserOrg._id, {
      role: args.role,
      accessStatus:
        normalizeOrgMembershipAccessStatus(
          (targetUserOrg as any).accessStatus,
        ) === "removed"
          ? "active"
          : (targetUserOrg as any).accessStatus,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Manage default requirements
export const getDefaultRequirements = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    return runOrgQuery(async () => {
      const userRecord = await checkAuth(ctx, args.organizationId);

      const result = await getEffectiveRequirementDefinitions(
        ctx,
        args.organizationId,
      );
      return result.requirements;
    }, []);
  },
});

export const updateDefaultRequirements = mutation({
  args: {
    organizationId: v.id("organizations"),
    requirements: v.array(defaultRequirementValidator),
  },
  handler: async (ctx, args) => {
    await checkAuth(ctx, args.organizationId, "hr");

    const now = Date.now();

    await ctx.db.patch(args.organizationId, {
      defaultRequirements: args.requirements,
      updatedAt: now,
    });
    await replaceRequirementConfiguration(
      ctx,
      args.organizationId,
      args.requirements,
    );

    // Sync default requirements to all employees
    // Get all employees
    const employees = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    // Update each employee's requirements
    for (const employee of employees) {
      const currentRequirements = await loadEffectiveEmployeeRequirements(
        ctx,
        employee,
      );
      const customRequirements = currentRequirements.filter(
        (r: any) => r.isCustom,
      );

      // Create default requirements that don't already exist
      const newDefaultRequirements = args.requirements
        .filter((defaultReq: any) => {
          // Check if this default requirement already exists for this employee
          return !currentRequirements.some(
            (existingReq: any) =>
              existingReq.type === defaultReq.type && existingReq.isDefault,
          );
        })
        .map(buildEmployeeRequirementFromDefault);

      // Remove default requirements that are no longer in the defaults list
      const updatedDefaults = currentRequirements
        .filter((r: any) => r.isDefault)
        .filter((r: any) =>
          args.requirements.some((dr: any) => dr.type === r.type),
        )
        .map((existing: any) => {
          const defaultReq = args.requirements.find(
            (dr: any) => dr.type === existing.type,
          );
          return defaultReq
            ? mergeDefaultRequirementPolicy(existing, defaultReq)
            : existing;
        });

      // Combine: keep existing defaults (with their status/files), add new defaults, keep custom
      const updatedRequirements = [
        ...updatedDefaults,
        ...newDefaultRequirements,
        ...customRequirements,
      ];

      await replaceEmployeeRequirements(
        ctx,
        employee,
        updatedRequirements,
        now,
      );
      await ctx.db.patch(employee._id, {
        requirements: updatedRequirements,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * For owner/admin/hr/accounting: employee row in this org whose work email matches
 * the user's login email. Used for "View as employee" (not returned when org role is employee).
 */
export const getEmployeeSelfMatchForElevatedRole = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    let access: Awaited<ReturnType<typeof requireActiveMembership>>;
    try {
      access = await requireActiveMembership(ctx, args.organizationId);
    } catch {
      return null;
    }
    const role = access.membership.role.toLowerCase();
    if (role === "employee") return null;

    const elevated = ["owner", "admin", "hr", "manager", "accounting"].includes(
      role,
    );
    if (!elevated) return null;

    return access.membership.employeeId
      ? { employeeId: access.membership.employeeId }
      : null;
  },
});

// Get employee ID and whether payslip PIN is required (for employee payslips page).
// Resolves employeeId from userOrg, user record, or by matching employee email in org.
export const getEmployeeIdForPayslips = query({
  args: {
    organizationId: v.id("organizations"),
    /** When true, owner/admin/hr/accounting can resolve self via email match (employee view). */
    employeeExperienceMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let access: Awaited<ReturnType<typeof requirePayslipMembership>>;
    try {
      access = await requirePayslipMembership(ctx, args.organizationId);
    } catch {
      return { employeeId: null, requiresPin: false };
    }
    const employeeId = access.membership.employeeId ?? null;
    const orgRole = access.membership.role.toLowerCase();
    const elevated = ["owner", "admin", "hr", "manager", "accounting"].includes(
      orgRole,
    );

    const mayUseEmployeeExperience =
      orgRole === "employee" ||
      (args.employeeExperienceMode === true && elevated);
    if (!employeeId || !mayUseEmployeeExperience) {
      return { employeeId: null, requiresPin: false };
    }

    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      return { employeeId: null, requiresPin: false };
    }
    const requiresPin = !!(await loadPayslipCredentialHash(ctx, employee));

    return { employeeId, requiresPin };
  },
});

// Legacy: Get current user's organization (for backward compatibility)
export const getCurrentUserOrganization = query({
  args: {},
  handler: async (ctx) => {
    const userRecord = await getUserRecordOrNull(ctx);
    if (!userRecord) return null;

    const userOrg = await getPreferredVisibleMembership(ctx, userRecord);

    if (userOrg) {
      return await getEffectiveOrganization(ctx, userOrg.organizationId);
    }

    return null;
  },
});

// Legacy: Invite user (for backward compatibility)
export const inviteUser = mutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    const userOrg = await getPreferredVisibleMembership(ctx, userRecord);
    if (!userOrg || !canUseFullOrganizationAccess(userOrg.accessStatus)) {
      throw new Error("User must be in an organization to invite others");
    }
    const organizationId = userOrg.organizationId;

    // Use the addUserToOrganization logic directly
    // Check if current user is admin, owner, or hr
    const currentUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", organizationId),
      )
      .first();

    const isAuthorized =
      currentUserOrg?.role === "admin" ||
      currentUserOrg?.role === "owner" ||
      currentUserOrg?.role === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to add users to organization");
    }

    // Find or create user
    let targetUser = await (ctx.db.query("users") as any)
      .withIndex("by_email", (q: any) => q.eq("email", args.email))
      .first();

    if (!targetUser) {
      const now = Date.now();
      targetUser = await ctx.db.insert("users", {
        email: args.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Check if user is already in this organization
    const existingUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", targetUser._id).eq("organizationId", organizationId),
      )
      .first();

    const now = Date.now();

    if (existingUserOrg) {
      await ctx.db.patch(existingUserOrg._id, {
        role: args.role,
        employeeId: args.employeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: userRecord._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userOrganizations", {
        userId: targetUser._id,
        organizationId: organizationId,
        role: args.role,
        employeeId: args.employeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: userRecord._id,
        joinedAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});
