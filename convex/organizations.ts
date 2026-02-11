import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

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
      "User record not found. Please complete your account setup."
    );
  }

  return userRecord;
}

// Helper to check authorization with organization context
async function checkAuth(
  ctx: any,
  organizationId: any,
  requiredRole?: "owner" | "admin" | "hr"
) {
  const userRecord = await getUserRecord(ctx);

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

  // Owner has all admin privileges
  const isOwnerOrAdmin = userRole === "owner" || userRole === "admin";
  if (requiredRole && userRole !== requiredRole && !isOwnerOrAdmin) {
    throw new Error("Not authorized");
  }

  return { ...userRecord, role: userRole, organizationId };
}

// Get all organizations for current user
export const getUserOrganizations = query({
  args: {},
  handler: async (ctx) => {
    try {
      let userRecord;
      try {
        userRecord = await getUserRecord(ctx);
      } catch (error: any) {
        // If user record doesn't exist yet (e.g., during signup), return empty array
        if (error.message?.includes("User record not found")) {
          return [];
        }
        throw error;
      }

      // Get all user-organization relationships
      const userOrgs = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user", (q: any) => q.eq("userId", userRecord._id))
        .collect();

      // Fetch organization details
      const organizations = await Promise.all(
        userOrgs.map(async (userOrg: any) => {
          const org = await ctx.db.get(userOrg.organizationId);
          if (!org) return null;
          return {
            ...org,
            role: userOrg.role,
            employeeId: userOrg.employeeId,
            joinedAt: userOrg.joinedAt,
          };
        })
      );

      // Filter out nulls
      const validOrgs = organizations.filter((org) => org !== null);

      // If no organizations found in junction table, check legacy organizationId
      // Note: We can't migrate in a query (read-only), so we just return the legacy org
      if (validOrgs.length === 0 && userRecord.organizationId) {
        const legacyOrg = await ctx.db.get(userRecord.organizationId);
        if (legacyOrg) {
          return [
            {
              ...legacyOrg,
              role:
                (userRecord.role as
                  | "admin"
                  | "hr"
                  | "employee"
                  | "accounting") ||
                "owner" ||
                "admin",
              joinedAt: userRecord.createdAt || Date.now(),
            },
          ];
        }
      }

      // Sort organizations: last active organization first, then by joinedAt
      if (userRecord.lastActiveOrganizationId && validOrgs.length > 0) {
        const lastActiveIndex = validOrgs.findIndex(
          (org) => org._id === userRecord.lastActiveOrganizationId
        );
        if (lastActiveIndex > 0) {
          // Move last active org to the front
          const lastActiveOrg = validOrgs[lastActiveIndex];
          validOrgs.splice(lastActiveIndex, 1);
          validOrgs.unshift(lastActiveOrg);
        }
      }

      return validOrgs;
    } catch (error: any) {
      // If user is not authenticated (e.g., during logout), return empty array
      // This prevents errors from bubbling up during the logout process
      if (
        error?.message?.includes("Not authenticated") ||
        error?.message?.includes("Unauthenticated") ||
        error?.message?.includes("User record not found")
      ) {
        return [];
      }
      // Re-throw other errors
      throw error;
    }
  },
});

// Get current user with current organization context
export const getCurrentUser = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    let userRecord;
    try {
      userRecord = await getUserRecord(ctx);
    } catch (error: any) {
      // If user record doesn't exist yet (e.g., during signup), return null
      if (error.message?.includes("User record not found")) {
        return null;
      }
      // If user is not authenticated (e.g., after sign out), return null
      if (
        error.message?.includes("Not authenticated") ||
        error.message?.includes("Unauthenticated")
      ) {
        return null;
      }
      throw error;
    }

    let currentOrg = null;
    let userOrg = null;

    if (args.organizationId) {
      // Get user's relationship with specified organization
      userOrg = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user_organization", (q: any) =>
          q
            .eq("userId", userRecord._id)
            .eq("organizationId", args.organizationId)
        )
        .first();

      if (userOrg) {
        currentOrg = await ctx.db.get(args.organizationId);
      } else {
        // Fallback: if userOrg not found, check if userRecord has legacy organizationId
        // and it matches the requested organizationId
        if (
          userRecord.organizationId &&
          userRecord.organizationId === args.organizationId
        ) {
          currentOrg = await ctx.db.get(args.organizationId);
          userOrg = {
            role: userRecord.role || "admin", // Default to admin for legacy users
            employeeId: userRecord.employeeId,
          };
        }
      }
    } else {
      // Fallback to legacy organizationId field for backward compatibility
      if (userRecord.organizationId) {
        currentOrg = await ctx.db.get(userRecord.organizationId);
        userOrg = {
          role: userRecord.role || "admin", // Default to admin for legacy users
          employeeId: userRecord.employeeId,
        };
      }
    }

    return {
      ...userRecord,
      organization: currentOrg,
      role: userOrg?.role || userRecord.role || "admin", // Fallback chain
      employeeId: userOrg?.employeeId || userRecord.employeeId,
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
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const hasAccess =
      userOrg ||
      (userRecord.organizationId === args.organizationId && userRecord.role);
    if (!hasAccess) return { success: false };

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
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // If organizationId is provided, also get the user's role in that organization
    if (args.organizationId) {
      const userOrg = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user_organization", (q: any) =>
          q.eq("userId", args.userId).eq("organizationId", args.organizationId)
        )
        .first();

      let role: string | undefined = userOrg?.role;

      // Fallback to legacy role if userOrg doesn't exist
      if (!role && user.organizationId === args.organizationId) {
        role = user.role;
      }

      return { ...user, role };
    }

    return user;
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
    const userRecord = await getUserRecord(ctx);

    const now = Date.now();
    const organizationId = await ctx.db.insert("organizations", {
      name: args.name,
      address: args.address,
      phone: args.phone,
      email: args.email,
      taxId: args.taxId,
      firstPayDate: 15, // Default: 15th of the month
      secondPayDate: 30, // Default: 30th of the month
      createdAt: now,
      updatedAt: now,
    });

    // Create user-organization relationship with owner role
    await ctx.db.insert("userOrganizations", {
      userId: userRecord._id,
      organizationId,
      role: "owner",
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
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if user is admin or accounting in this organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    // Fallback to legacy check - owner has admin privileges
    const allowedRoles = ["admin", "owner", "accounting"];
    const isAuthorized =
      allowedRoles.includes(userOrg?.role || "") ||
      (userRecord.organizationId === args.organizationId &&
        allowedRoles.includes(userRecord.role || ""));

    if (!isAuthorized) {
      throw new Error("Only admins or accounting can update organization");
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

    await ctx.db.patch(args.organizationId, updates);
    return { success: true };
  },
});

// Delete organization (only owner can delete)
export const deleteOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if user is owner of this organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const isOwner =
      userOrg?.role === "owner" ||
      (userRecord.organizationId === args.organizationId &&
        userRecord.role === "owner");

    if (!isOwner) {
      throw new Error("Only organization owners can delete organizations");
    }

    // Get all related data to delete
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Delete all user-organization relationships
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    for (const userOrg of userOrgs) {
      await ctx.db.delete(userOrg._id);
    }

    // Note: We don't delete employees, payroll, etc. as they might be needed for records
    // The organization record itself will be deleted, but related data remains
    // This is a soft delete approach - you may want to add a "deleted" flag instead

    // Delete the organization
    await ctx.db.delete(args.organizationId);

    return { success: true };
  },
});

// Get organization details
export const getOrganization = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if user has access to this organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const hasAccess =
      userOrg || userRecord.organizationId === args.organizationId;

    if (!hasAccess) {
      throw new Error("Not authorized");
    }

    const organization = await ctx.db.get(args.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
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
    const userRecord = await getUserRecord(ctx);

    // Check if user has access to this organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    const hasAccess =
      userOrg || userRecord.organizationId === args.organizationId;

    if (!hasAccess) {
      throw new Error("Not authorized");
    }

    // Get all user-organization relationships for this org
    const userOrgs = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Fetch user details
    const members = await Promise.all(
      userOrgs.map(async (userOrg: any) => {
        const user = await ctx.db.get(userOrg.userId);
        return {
          ...user,
          role: userOrg.role,
          employeeId: userOrg.employeeId,
          joinedAt: userOrg.joinedAt,
        };
      })
    );

    return members;
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
      v.literal("employee"),
      v.literal("accounting")
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if current user is admin or hr in the organization
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    // Owner has all admin privileges
    const isAuthorized =
      userOrg?.role === "admin" ||
      userOrg?.role === "owner" ||
      userOrg?.role === "hr" ||
      (userRecord.organizationId === args.organizationId &&
        (userRecord.role === "admin" ||
          userRecord.role === "owner" ||
          userRecord.role === "hr"));

    if (!isAuthorized) {
      throw new Error("Not authorized to add users to organization");
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
        q.eq("userId", targetUser._id).eq("organizationId", args.organizationId)
      )
      .first();

    const now = Date.now();

    if (existingUserOrg) {
      // Update existing relationship
      await ctx.db.patch(existingUserOrg._id, {
        role: args.role,
        employeeId: args.employeeId,
        updatedAt: now,
      });
    } else {
      // Create new relationship
      await ctx.db.insert("userOrganizations", {
        userId: targetUser._id,
        organizationId: args.organizationId,
        role: args.role,
        employeeId: args.employeeId,
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
    const userRecord = await getUserRecord(ctx);

    // Check if current user is admin
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    // Owner has all admin privileges
    const isOwnerOrAdmin =
      userOrg?.role === "admin" ||
      userOrg?.role === "owner" ||
      (userRecord.organizationId === args.organizationId &&
        (userRecord.role === "admin" || userRecord.role === "owner"));

    if (!isOwnerOrAdmin) {
      throw new Error(
        "Only organization owners or admins can remove users from organization"
      );
    }

    // Prevent removing yourself
    if (args.userId === userRecord._id) {
      throw new Error("Cannot remove yourself from organization");
    }

    // Remove user-organization relationship
    const targetUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId)
      )
      .first();

    if (targetUserOrg) {
      await ctx.db.delete(targetUserOrg._id);
    }

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
      v.literal("employee"),
      v.literal("accounting")
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Check if current user is admin
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", args.organizationId)
      )
      .first();

    // Owner, admin, and HR can update member roles
    const canUpdateRoles =
      userOrg?.role === "admin" ||
      userOrg?.role === "owner" ||
      userOrg?.role === "hr" ||
      (userRecord.organizationId === args.organizationId &&
        (userRecord.role === "admin" ||
          userRecord.role === "owner" ||
          userRecord.role === "hr"));

    if (!canUpdateRoles) {
      throw new Error(
        "Only organization owners, admins, or HR can update user roles"
      );
    }

    if (userRecord._id === args.userId) {
      throw new Error("You cannot change your own role");
    }

    // Update user-organization relationship
    const targetUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", args.userId).eq("organizationId", args.organizationId)
      )
      .first();

    if (targetUserOrg) {
      await ctx.db.patch(targetUserOrg._id, {
        role: args.role,
        updatedAt: Date.now(),
      });
    } else {
      throw new Error("User is not a member of this organization");
    }

    return { success: true };
  },
});

// Manage default requirements
export const getDefaultRequirements = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId);

    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");

    return organization.defaultRequirements || [];
  },
});

export const updateDefaultRequirements = mutation({
  args: {
    organizationId: v.id("organizations"),
    requirements: v.array(
      v.object({
        type: v.string(),
        isRequired: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userRecord = await checkAuth(ctx, args.organizationId, "hr");

    await ctx.db.patch(args.organizationId, {
      defaultRequirements: args.requirements,
      updatedAt: Date.now(),
    });

    // Sync default requirements to all employees
    // Get all employees
    const employees = await (ctx.db.query("employees") as any)
      .withIndex("by_organization", (q: any) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    // Update each employee's requirements
    for (const employee of employees) {
      const currentRequirements = employee.requirements || [];
      const customRequirements = currentRequirements.filter(
        (r: any) => r.isCustom
      );

      // Create default requirements that don't already exist
      const newDefaultRequirements = args.requirements
        .filter((defaultReq: any) => {
          // Check if this default requirement already exists for this employee
          return !currentRequirements.some(
            (existingReq: any) =>
              existingReq.type === defaultReq.type && existingReq.isDefault
          );
        })
        .map((req: any) => ({
          type: req.type,
          status: "pending" as const,
          isDefault: true,
          isCustom: false,
        }));

      // Remove default requirements that are no longer in the defaults list
      const updatedDefaults = currentRequirements
        .filter((r: any) => r.isDefault)
        .filter((r: any) =>
          args.requirements.some((dr: any) => dr.type === r.type)
        );

      // Combine: keep existing defaults (with their status/files), add new defaults, keep custom
      const updatedRequirements = [
        ...updatedDefaults,
        ...newDefaultRequirements,
        ...customRequirements,
      ];

      await ctx.db.patch(employee._id, {
        requirements: updatedRequirements,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Get employee ID and whether payslip PIN is required (for employee payslips page).
// Resolves employeeId from userOrg, user record, or by matching employee email in org.
export const getEmployeeIdForPayslips = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    let userRecord;
    try {
      userRecord = await getUserRecord(ctx);
    } catch (error: any) {
      if (
        error?.message?.includes("Not authenticated") ||
        error?.message?.includes("Unauthenticated") ||
        error?.message?.includes("User record not found")
      ) {
        return { employeeId: null, requiresPin: false };
      }
      throw error;
    }

    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q
          .eq("userId", userRecord._id)
          .eq("organizationId", args.organizationId)
      )
      .first();

    let employeeId = userOrg?.employeeId ?? userRecord.employeeId ?? null;

    if (!employeeId && (userOrg?.role === "employee" || userRecord.role === "employee")) {
      const employees = await (ctx.db.query("employees") as any)
        .withIndex("by_organization", (q: any) =>
          q.eq("organizationId", args.organizationId)
        )
        .collect();
      const match = employees.find(
        (e: any) =>
          e.personalInfo?.email?.toLowerCase() === userRecord.email?.toLowerCase()
      );
      if (match) employeeId = match._id;
    }

    if (!employeeId) {
      return { employeeId: null, requiresPin: false };
    }

    const employee = await ctx.db.get(employeeId);
    const requiresPin = !!((employee as any)?.payslipPinHash);

    return { employeeId, requiresPin };
  },
});

// Legacy: Get current user's organization (for backward compatibility)
export const getCurrentUserOrganization = query({
  args: {},
  handler: async (ctx) => {
    const userRecord = await getUserRecord(ctx);

    if (userRecord.organizationId) {
      return await ctx.db.get(userRecord.organizationId);
    }

    // Try to get first organization from userOrganizations
    const userOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user", (q: any) => q.eq("userId", userRecord._id))
      .first();

    if (userOrg) {
      return await ctx.db.get(userOrg.organizationId);
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
      v.literal("employee")
    ),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const userRecord = await getUserRecord(ctx);

    // Get user's first organization (legacy support)
    let organizationId = userRecord.organizationId;

    if (!organizationId) {
      // Try to get first organization from userOrganizations
      const userOrg = await (ctx.db.query("userOrganizations") as any)
        .withIndex("by_user", (q: any) => q.eq("userId", userRecord._id))
        .first();

      if (!userOrg) {
        throw new Error("User must be in an organization to invite others");
      }

      organizationId = userOrg.organizationId;
    }

    // Use the addUserToOrganization logic directly
    // Check if current user is admin, owner, or hr
    const currentUserOrg = await (ctx.db.query("userOrganizations") as any)
      .withIndex("by_user_organization", (q: any) =>
        q.eq("userId", userRecord._id).eq("organizationId", organizationId)
      )
      .first();

    const isAuthorized =
      currentUserOrg?.role === "admin" ||
      currentUserOrg?.role === "owner" ||
      currentUserOrg?.role === "hr" ||
      (userRecord.organizationId === organizationId &&
        (userRecord.role === "admin" ||
          userRecord.role === "owner" ||
          userRecord.role === "hr"));

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
        q.eq("userId", targetUser._id).eq("organizationId", organizationId)
      )
      .first();

    const now = Date.now();

    if (existingUserOrg) {
      await ctx.db.patch(existingUserOrg._id, {
        role: args.role,
        employeeId: args.employeeId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userOrganizations", {
        userId: targetUser._id,
        organizationId: organizationId,
        role: args.role,
        employeeId: args.employeeId,
        joinedAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});
