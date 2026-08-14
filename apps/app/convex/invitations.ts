import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { randomBytes } from "@noble/ciphers/utils.js";
import { authComponent } from "./auth";
import { getAssignableOrganizationRoleOptions } from "@/utils/organization-roles";
import { requireActiveMembership, requireIdentity } from "./access";
import { bytesToBase64 } from "./binaryBase64";
import { hashInvitationToken } from "./invitationTokenHash";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeOrgMembershipAccessStatus } from "@/utils/org-membership-lifecycle";
import { findUserByEmail, normalizeUserEmail } from "./userEmail";

function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

function createInvitationToken(): string {
  return bytesToBase64(randomBytes(32))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function assertCanInviteRole(actorRole: string | null, nextRole: string) {
  const canAssign = getAssignableOrganizationRoleOptions(actorRole).some(
    (option) => option.value === nextRole,
  );
  if (!canAssign) {
    throw new Error("Not authorized to assign this organization role");
  }
}

/**
 * When linking an employee to an existing Plinth account, align employee record names
 * with the account display name (split into first / middle / last).
 */
function employeePersonalFromAccountDisplayName(
  displayName: string,
  fallbackEmail: string,
): { firstName: string; lastName: string; middleName?: string } {
  const trimmed = displayName.trim();
  const localPart = (fallbackEmail.split("@")[0] || "user").trim() || "user";
  if (!trimmed) {
    return { firstName: localPart, lastName: localPart };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }
  if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1] };
  }
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function normalizeDisplayNameForCompare(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * When inviting an existing Plinth user linked to an employee record, we only
 * rewrite the employee's first/middle/last if the account profile name and the
 * employee record name are not the same (ignoring case and extra spaces).
 * Empty account display name never triggers a rename.
 */
function accountDisplayNameDiffersFromEmployeeRecord(
  accountDisplayName: string,
  employeePersonal: {
    firstName: string;
    lastName: string;
    middleName?: string;
  },
): boolean {
  const accountNorm = normalizeDisplayNameForCompare(accountDisplayName);
  if (!accountNorm) return false;
  const employeeFull = [
    employeePersonal.firstName,
    employeePersonal.middleName,
    employeePersonal.lastName,
  ]
    .filter(Boolean)
    .join(" ");
  const employeeNorm = normalizeDisplayNameForCompare(employeeFull);
  return accountNorm !== employeeNorm;
}

/** Thrown when UI must show confirm for inviting an email that already has a Convex user. */
const CONFIRM_EXISTING_PLINTH_USER = "CONFIRM_EXISTING_PLINTH_USER";

type SoftInviteResult =
  | {
      kind: "created";
      invitationId: Id<"invitations">;
      email: string;
      token: string;
    }
  | { kind: "skipped"; email: string; reason: string }
  | { kind: "needs_confirm"; email: string };

async function tryCreateOrgInvitationSoft(
  ctx: MutationCtx,
  params: {
    organizationId: Id<"organizations">;
    role: Doc<"invitations">["role"];
    userRecord: Doc<"users">;
    email: string;
    employeeId?: Id<"employees">;
    confirmInviteToExistingPlinthUser?: boolean;
    existingInvitations: Doc<"invitations">[];
    pendingEmailsThisBatch: Set<string>;
  },
): Promise<SoftInviteResult> {
  const {
    organizationId,
    role,
    userRecord,
    email: emailInput,
    employeeId,
    confirmInviteToExistingPlinthUser,
    existingInvitations,
    pendingEmailsThisBatch,
  } = params;

  const now = Date.now();
  let email = emailInput.trim();
  let inviteeName: string | undefined;
  const resolvedEmployeeId = employeeId;

  if (employeeId) {
    const employee = await ctx.db.get(employeeId);
    if (!employee || employee.organizationId !== organizationId) {
      return {
        kind: "skipped",
        email: emailInput,
        reason: "Employee not found",
      };
    }
    if (
      employee.archivedAt !== undefined ||
      employee.employment.status !== "active"
    ) {
      return {
        kind: "skipped",
        email: emailInput,
        reason: "Only active employees can be invited",
      };
    }
    const empEmail = employee.personalInfo.email.trim();
    if (!empEmail) {
      return {
        kind: "skipped",
        email: emailInput,
        reason: "Employee has no email on file",
      };
    }
    if (normalizeInviteEmail(empEmail) !== normalizeInviteEmail(email)) {
      return {
        kind: "skipped",
        email: emailInput,
        reason: "Email does not match selected employee",
      };
    }
    email = empEmail;

    const existingUserOrgForEmployee = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .filter((q) => q.eq(q.field("employeeId"), employeeId))
      .first();

    if (existingUserOrgForEmployee) {
      const linkedUser = await ctx.db.get(existingUserOrgForEmployee.userId);
      const isMatchingRemovedMembership =
        normalizeOrgMembershipAccessStatus(
          existingUserOrgForEmployee.accessStatus,
        ) === "removed" &&
        !!linkedUser?.email &&
        normalizeInviteEmail(linkedUser.email) === normalizeInviteEmail(email);
      if (!isMatchingRemovedMembership) {
        return {
          kind: "skipped",
          email,
          reason: "Employee is already a member of this organization",
        };
      }
    }

    const inviterEmail = userRecord.email;
    if (
      inviterEmail &&
      normalizeInviteEmail(email) === normalizeInviteEmail(inviterEmail)
    ) {
      return {
        kind: "skipped",
        email,
        reason: "You cannot send an invitation to your own email address.",
      };
    }
  } else {
    if (!email) {
      return {
        kind: "skipped",
        email: emailInput,
        reason: "Email is required",
      };
    }
    const inviterEmail = userRecord.email;
    if (
      inviterEmail &&
      normalizeInviteEmail(email) === normalizeInviteEmail(inviterEmail)
    ) {
      return {
        kind: "skipped",
        email,
        reason: "You cannot send an invitation to your own email address.",
      };
    }
  }

  const inviteNorm = normalizeInviteEmail(email);

  if (pendingEmailsThisBatch.has(inviteNorm)) {
    return {
      kind: "skipped",
      email,
      reason: "Duplicate in this invite list",
    };
  }

  const existingUser = await findUserByEmail(ctx, email);

  if (existingUser) {
    const existingUserOrg = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (q) =>
        q.eq("userId", existingUser._id).eq("organizationId", organizationId),
      )
      .first();

    if (existingUserOrg) {
      if (
        normalizeOrgMembershipAccessStatus(existingUserOrg.accessStatus) !==
        "removed"
      ) {
        return {
          kind: "skipped",
          email,
          reason: "User is already a member of this organization",
        };
      }
    }

    if (!confirmInviteToExistingPlinthUser) {
      return { kind: "needs_confirm", email };
    }

    if (resolvedEmployeeId) {
      const employeeDoc = await ctx.db.get(resolvedEmployeeId);
      if (!employeeDoc) {
        return { kind: "skipped", email, reason: "Employee not found" };
      }
      const pi = employeeDoc.personalInfo;

      const accountNameRaw = String(existingUser.name ?? "");
      if (
        accountDisplayNameDiffersFromEmployeeRecord(accountNameRaw, {
          firstName: pi.firstName,
          lastName: pi.lastName,
          middleName: pi.middleName,
        })
      ) {
        const parts = employeePersonalFromAccountDisplayName(
          accountNameRaw,
          existingUser.email,
        );
        const piRest = { ...pi };
        delete (piRest as { middleName?: string }).middleName;
        const updatedPersonal = {
          ...piRest,
          firstName: parts.firstName,
          lastName: parts.lastName,
          ...(parts.middleName ? { middleName: parts.middleName } : {}),
        };
        await ctx.db.patch(resolvedEmployeeId, {
          personalInfo: updatedPersonal,
          updatedAt: now,
        });
      }

      const employeeAfter = await ctx.db.get(resolvedEmployeeId);
      if (!employeeAfter) {
        return { kind: "skipped", email, reason: "Employee not found" };
      }
      const p = employeeAfter.personalInfo;
      const inviteeNameFromEmployee = [p.firstName, p.middleName, p.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const accountDisplay = accountNameRaw.trim();
      inviteeName =
        (accountDisplay.length > 0
          ? accountDisplay
          : inviteeNameFromEmployee) || undefined;
    }
  } else if (resolvedEmployeeId) {
    const employeeDoc = await ctx.db.get(resolvedEmployeeId);
    if (employeeDoc) {
      const p = employeeDoc.personalInfo;
      inviteeName =
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || undefined;
    }
  }

  const existingInvitation = existingInvitations.find(
    (inv) =>
      normalizeInviteEmail(inv.email) === inviteNorm &&
      inv.status === "pending" &&
      inv.organizationId === organizationId,
  );

  if (existingInvitation) {
    return {
      kind: "skipped",
      email,
      reason: "An invitation has already been sent to this email",
    };
  }

  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  const invitationId = await ctx.db.insert("invitations", {
    organizationId,
    email,
    role,
    invitedBy: userRecord._id,
    tokenHash,
    status: "pending",
    expiresAt,
    createdAt: now,
    ...(resolvedEmployeeId ? { employeeId: resolvedEmployeeId } : {}),
    ...(inviteeName ? { inviteeName } : {}),
  });

  pendingEmailsThisBatch.add(inviteNorm);
  return { kind: "created", invitationId, email, token };
}

// Create invitation (mutation - email will be sent from server action)
export const createInvitation = mutation({
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
    confirmInviteToExistingPlinthUser: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user: userRecord, membership: userOrg } =
      await requireActiveMembership(ctx, args.organizationId);

    const actorRole = userOrg.role;

    const isAuthorized =
      actorRole === "owner" || actorRole === "admin" || actorRole === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to invite users to organization");
    }
    assertCanInviteRole(actorRole, args.role);

    const existingInvitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const pendingEmailsThisBatch = new Set<string>();
    const result = await tryCreateOrgInvitationSoft(ctx, {
      organizationId: args.organizationId,
      role: args.role,
      userRecord,
      email: args.email,
      employeeId: args.employeeId,
      confirmInviteToExistingPlinthUser:
        args.confirmInviteToExistingPlinthUser === true ? true : undefined,
      existingInvitations,
      pendingEmailsThisBatch,
    });

    if (result.kind === "needs_confirm") {
      throw new Error(CONFIRM_EXISTING_PLINTH_USER);
    }
    if (result.kind === "skipped") {
      throw new Error(result.reason);
    }
    return {
      invitationId: result.invitationId,
      email: result.email,
      token: result.token,
    };
  },
});

export const batchCreateInvitations = mutation({
  args: {
    organizationId: v.id("organizations"),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    confirmInviteToExistingPlinthUser: v.optional(v.boolean()),
    items: v.array(
      v.object({
        email: v.string(),
        employeeId: v.optional(v.id("employees")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { user: userRecord, membership: userOrg } =
      await requireActiveMembership(ctx, args.organizationId);

    const actorRole = userOrg.role;

    const isAuthorized =
      actorRole === "owner" || actorRole === "admin" || actorRole === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to invite users to organization");
    }
    assertCanInviteRole(actorRole, args.role);

    const existingInvitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const pendingEmailsThisBatch = new Set<string>();
    const created: {
      invitationId: Id<"invitations">;
      email: string;
      token: string;
    }[] = [];
    const skipped: { email: string; reason: string }[] = [];
    const needsConfirmForEmails: string[] = [];

    const confirm =
      args.confirmInviteToExistingPlinthUser === true ? true : undefined;

    for (const item of args.items) {
      const result = await tryCreateOrgInvitationSoft(ctx, {
        organizationId: args.organizationId,
        role: args.role,
        userRecord,
        email: item.email,
        employeeId: item.employeeId,
        confirmInviteToExistingPlinthUser: confirm,
        existingInvitations,
        pendingEmailsThisBatch,
      });

      if (result.kind === "created") {
        created.push({
          invitationId: result.invitationId,
          email: result.email,
          token: result.token,
        });
      } else if (result.kind === "skipped") {
        skipped.push({ email: result.email, reason: result.reason });
      } else {
        needsConfirmForEmails.push(result.email);
      }
    }

    return { created, skipped, needsConfirmForEmails };
  },
});

async function findInvitationByRawToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"invitations"> | null> {
  const hashedMatches = await ctx.db
    .query("invitations")
    .withIndex("by_token_hash", (q) =>
      q.eq("tokenHash", hashInvitationToken(token)),
    )
    .take(2);
  if (hashedMatches.length > 1) {
    throw new Error("Invalid invitation token");
  }
  if (hashedMatches[0]) return hashedMatches[0];

  return null;
}

function redactInvitationToken(
  invitation: Doc<"invitations">,
): Omit<Doc<"invitations">, "tokenHash"> {
  const { tokenHash: _tokenHash, ...redacted } = invitation;
  void _tokenHash;
  return redacted;
}

// Get invitation by ID (for server action to send email)
export const getInvitationById = query({
  args: {
    invitationId: v.id("invitations"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;

    const { membership } = await requireActiveMembership(
      ctx,
      invitation.organizationId,
    );
    if (
      membership.role !== "owner" &&
      membership.role !== "admin" &&
      membership.role !== "hr"
    ) {
      throw new Error("Not authorized");
    }

    const organization = await ctx.db.get(
      invitation.organizationId as import("./_generated/dataModel").Id<"organizations">,
    );
    const inviter = await ctx.db.get(invitation.invitedBy);

    return {
      ...redactInvitationToken(invitation),
      organization,
      inviter:
        inviter && "email" in inviter
          ? {
              name: inviter.name || inviter.email,
              email: inviter.email,
            }
          : null,
    };
  },
});

export const resendInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    const { membership } = await requireActiveMembership(
      ctx,
      invitation.organizationId,
    );
    if (!["owner", "admin", "hr"].includes(membership.role)) {
      throw new Error("Not authorized");
    }
    if (invitation.status !== "pending") {
      throw new Error("Can only resend pending invitations");
    }

    const token = createInvitationToken();
    const now = Date.now();
    await ctx.db.patch(invitation._id, {
      tokenHash: hashInvitationToken(token),
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });
    return { token, email: invitation.email };
  },
});

// Get invitation by token
export const getInvitationByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const invitation = await findInvitationByRawToken(ctx, args.token);

    if (!invitation) {
      return null;
    }

    // Check if expired
    if (invitation.expiresAt < Date.now() && invitation.status === "pending") {
      // Note: Cannot patch in query - this should be handled by a mutation or scheduled function
      // For now, just return null without updating status
      return null;
    }

    // Get organization and inviter details
    const organization = await ctx.db.get(invitation.organizationId);
    const inviter = await ctx.db.get(invitation.invitedBy);

    return {
      ...redactInvitationToken(invitation),
      organization,
      inviter:
        inviter && "email" in inviter
          ? {
              name: inviter.name || inviter.email,
              email: inviter.email,
            }
          : null,
    };
  },
});

// Check if user exists by email
export const checkUserExists = query({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (
      !identity.email ||
      normalizeInviteEmail(identity.email) !== normalizeInviteEmail(args.email)
    ) {
      throw new Error("Not authorized");
    }
    const user = await findUserByEmail(ctx, args.email);
    return !!user;
  },
});

export const getInviteRecipientPreview = query({
  args: {
    organizationId: v.id("organizations"),
    email: v.optional(v.string()),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    if (!args.employeeId && !(args.email && String(args.email).trim())) {
      throw new Error("Provide an email or employeeId");
    }

    const { membership: userOrg } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );

    const isAuthorized =
      userOrg.role === "owner" ||
      userOrg.role === "admin" ||
      userOrg.role === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to preview invitations");
    }

    let inviteEmail = args.email?.trim() ?? "";
    let employeeCurrentDisplayName: string | undefined;

    if (args.employeeId) {
      const employee = await ctx.db.get(args.employeeId);
      if (!employee || employee.organizationId !== args.organizationId) {
        throw new Error("Employee not found");
      }
      const p = employee.personalInfo as {
        firstName: string;
        lastName: string;
        middleName?: string;
        email: string;
      };
      inviteEmail = (p.email ?? "").trim();
      employeeCurrentDisplayName = [p.firstName, p.middleName, p.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    if (!inviteEmail) {
      throw new Error("Email is required");
    }

    const existingConvexUser = await findUserByEmail(ctx, inviteEmail);

    let alreadyInOrg = false;
    if (existingConvexUser) {
      const link = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (q) =>
          q
            .eq("userId", existingConvexUser._id)
            .eq("organizationId", args.organizationId),
        )
        .first();
      alreadyInOrg = !!link;
    }

    const needsConfirmForExistingUser = !!(existingConvexUser && !alreadyInOrg);

    let employeeWillBeRenamedToMatchAccount = false;
    if (args.employeeId && existingConvexUser && !alreadyInOrg) {
      const emp = await ctx.db.get(args.employeeId);
      if (emp) {
        const ep = emp.personalInfo as {
          firstName: string;
          lastName: string;
          middleName?: string;
        };
        employeeWillBeRenamedToMatchAccount =
          accountDisplayNameDiffersFromEmployeeRecord(
            String(existingConvexUser.name ?? ""),
            ep,
          );
      }
    }

    return {
      inviteEmail,
      existingConvexUser: existingConvexUser
        ? {
            name: existingConvexUser.name ?? null,
            email: existingConvexUser.email,
          }
        : null,
      alreadyInOrg,
      needsConfirmForExistingUser,
      employeeWillBeRenamedToMatchAccount,
      employeeCurrentDisplayName,
    };
  },
});

// Accept invitation
export const acceptInvitation = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await findInvitationByRawToken(ctx, args.token);

    if (!invitation) {
      throw new Error("Invalid invitation token");
    }

    if (invitation.status !== "pending") {
      throw new Error("Invitation has already been used or expired");
    }

    if (invitation.expiresAt < Date.now()) {
      await ctx.db.patch(invitation._id, { status: "expired" });
      throw new Error("Invitation has expired");
    }

    const organization = await ctx.db.get(
      invitation.organizationId as Id<"organizations">,
    );
    if (!organization || organization.status === "archived") {
      throw new Error("Invitation is no longer eligible");
    }
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);
    if (!authUser?.email) {
      throw new Error("Not authenticated");
    }
    if (
      normalizeInviteEmail(authUser.email) !==
      normalizeInviteEmail(invitation.email)
    ) {
      throw new Error("Invitation email does not match your account");
    }

    const now = Date.now();

    const nameToSet = invitation.inviteeName ?? args.name ?? undefined;

    const authenticatedEmail = authUser.email.trim();
    let existingConvexUser = await findUserByEmail(ctx, authenticatedEmail);
    if (!existingConvexUser) {
      existingConvexUser = await findUserByEmail(ctx, invitation.email);
    }

    let userId: Id<"users">;

    if (!existingConvexUser) {
      userId = await ctx.db.insert("users", {
        email: authenticatedEmail,
        normalizedEmail: normalizeUserEmail(authenticatedEmail),
        name: nameToSet,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      userId = existingConvexUser._id;
      if (existingConvexUser.email !== authenticatedEmail) {
        await ctx.db.patch(userId, {
          email: authenticatedEmail,
          normalizedEmail: normalizeUserEmail(authenticatedEmail),
          updatedAt: now,
        });
      } else if (
        existingConvexUser.normalizedEmail !==
        normalizeUserEmail(authenticatedEmail)
      ) {
        await ctx.db.patch(userId, {
          normalizedEmail: normalizeUserEmail(authenticatedEmail),
          updatedAt: now,
        });
      }
      // Keep existing Plinth account name; do not overwrite from employee invitee name.
    }

    // Add user to organization
    const existingUserOrg = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (q) =>
        q.eq("userId", userId).eq("organizationId", invitation.organizationId),
      )
      .first();

    if (
      existingUserOrg &&
      normalizeOrgMembershipAccessStatus(existingUserOrg.accessStatus) !==
        "removed"
    ) {
      throw new Error("Invitation is no longer eligible");
    }
    const effectiveEmployeeId =
      invitation.employeeId ?? existingUserOrg?.employeeId;
    if (effectiveEmployeeId) {
      const employee = await ctx.db.get(effectiveEmployeeId);
      if (
        !employee ||
        employee.organizationId !== invitation.organizationId ||
        employee.archivedAt !== undefined ||
        employee.employment.status !== "active"
      ) {
        throw new Error("Invitation is no longer eligible");
      }
      const linkedMembership = await ctx.db
        .query("userOrganizations")
        .withIndex("by_organization_employee", (query) =>
          query
            .eq("organizationId", invitation.organizationId)
            .eq("employeeId", effectiveEmployeeId),
        )
        .first();
      if (
        linkedMembership &&
        (linkedMembership._id !== existingUserOrg?._id ||
          normalizeOrgMembershipAccessStatus(linkedMembership.accessStatus) !==
            "removed")
      ) {
        throw new Error("Invitation is no longer eligible");
      }
    }
    if (existingUserOrg) {
      await ctx.db.patch(existingUserOrg._id, {
        role: invitation.role,
        employeeId: effectiveEmployeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: userId,
        joinedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userOrganizations", {
        userId: userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        employeeId: effectiveEmployeeId,
        accessStatus: "active",
        accessUpdatedAt: now,
        accessUpdatedBy: userId,
        joinedAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(userId, {
      lastActiveOrganizationId: invitation.organizationId,
      updatedAt: now,
    });

    // Mark invitation as accepted
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: now,
    });

    return {
      success: true,
      userId: userId,
      email: invitation.email,
      organizationId: invitation.organizationId,
    };
  },
});

// Get invitations for organization
export const getInvitations = query({
  args: {
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const { membership: userOrg } = await requireActiveMembership(
      ctx,
      args.organizationId,
    );

    const isAuthorized =
      userOrg?.role === "owner" ||
      userOrg?.role === "admin" ||
      userOrg.role === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized");
    }

    const memberLinks = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const memberEmailsLower = new Set<string>();
    for (const link of memberLinks) {
      const member = await ctx.db.get(link.userId);
      if (member?.email) {
        memberEmailsLower.add(normalizeInviteEmail(member.email));
      }
    }

    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    const sorted = invitations.sort((a, b) => b.createdAt - a.createdAt);

    return sorted.map((inv) => ({
      ...redactInvitationToken(inv),
      pendingNeedsAction:
        inv.status === "pending" &&
        !memberEmailsLower.has(normalizeInviteEmail(inv.email)),
    }));
  },
});

// Create user account for employee and send invitation
export const createUserForEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
    organizationId: v.id("organizations"),
    role: v.union(
      v.literal("admin"),
      v.literal("owner"),
      v.literal("hr"),
      v.literal("manager"),
      v.literal("employee"),
      v.literal("accounting"),
    ),
    confirmInviteToExistingPlinthUser: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user: userRecord, membership: userOrg } =
      await requireActiveMembership(ctx, args.organizationId);

    const userRole = userOrg.role;

    // Owner has all admin privileges - treat owner the same as admin
    const isOwnerOrAdmin = userRole === "admin" || userRole === "owner";
    const isAuthorized = isOwnerOrAdmin || userRole === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized to create user accounts");
    }
    assertCanInviteRole(userRole, args.role);

    // Get employee
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.organizationId !== args.organizationId) {
      throw new Error("Employee not found");
    }
    if (
      employee.archivedAt !== undefined ||
      employee.employment.status !== "active"
    ) {
      throw new Error("Only active employees can be invited");
    }

    const now = Date.now();

    // Cannot invite yourself (employee email matches current user)
    const inviterEmail = userRecord.email;
    if (
      inviterEmail &&
      employee.personalInfo.email.toLowerCase() ===
        inviterEmail.toLowerCase()
    ) {
      throw new Error(
        "You cannot send an invitation to your own email address.",
      );
    }

    // Check if employee already has a user account
    const existingUserOrg = await ctx.db
      .query("userOrganizations")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("employeeId"), args.employeeId))
      .first();

    if (existingUserOrg) {
      throw new Error("Employee already has a user account");
    }

    // Check if user with this email already exists
    const existingUser = await findUserByEmail(
      ctx,
      employee.personalInfo.email,
    );

    if (existingUser) {
      // Check if this user is already in the organization
      const existingUserOrgCheck = await ctx.db
        .query("userOrganizations")
        .withIndex("by_user_organization", (q) =>
          q
            .eq("userId", existingUser._id)
            .eq("organizationId", args.organizationId),
        )
        .first();

      if (existingUserOrgCheck) {
        throw new Error(
          "A user with this email is already in the organization",
        );
      }

      if (!args.confirmInviteToExistingPlinthUser) {
        throw new Error(CONFIRM_EXISTING_PLINTH_USER);
      }

      const pi = employee.personalInfo as {
        firstName: string;
        lastName: string;
        middleName?: string;
        email: string;
        phone?: string;
        address?: string;
        province?: string;
        dateOfBirth?: number;
        civilStatus?: string;
        emergencyContact?: {
          name: string;
          relationship: string;
          phone: string;
        };
      };

      const accountNameRaw = String(existingUser.name ?? "");
      if (
        accountDisplayNameDiffersFromEmployeeRecord(accountNameRaw, {
          firstName: pi.firstName,
          lastName: pi.lastName,
          middleName: pi.middleName,
        })
      ) {
        const parts = employeePersonalFromAccountDisplayName(
          accountNameRaw,
          existingUser.email,
        );
        const piRest = { ...pi };
        delete (piRest as { middleName?: string }).middleName;
        const updatedPersonal = {
          ...piRest,
          firstName: parts.firstName,
          lastName: parts.lastName,
          ...(parts.middleName ? { middleName: parts.middleName } : {}),
        };
        await ctx.db.patch(args.employeeId, {
          personalInfo: updatedPersonal,
          updatedAt: now,
        });
      }
    }

    const employeeAfter = await ctx.db.get(args.employeeId);
    if (!employeeAfter) throw new Error("Employee not found");

    // Build invitee name from employee record so we can set it on accept without asking
    const p = employeeAfter.personalInfo as {
      firstName: string;
      lastName: string;
      middleName?: string;
    };
    const inviteeNameFromEmployee = [p.firstName, p.middleName, p.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const accountDisplay =
      existingUser && args.confirmInviteToExistingPlinthUser
        ? String(existingUser.name ?? "").trim()
        : "";
    const inviteeName =
      (accountDisplay.length > 0 ? accountDisplay : inviteeNameFromEmployee) ||
      undefined;

    // Create invitation for the employee
    const token = createInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    const invitationId = await ctx.db.insert("invitations", {
      organizationId: args.organizationId,
      email: employee.personalInfo.email,
      role: args.role,
      invitedBy: userRecord._id,
      tokenHash,
      status: "pending",
      expiresAt,
      employeeId: args.employeeId,
      inviteeName: inviteeName || undefined,
      createdAt: now,
    });

    return { invitationId, email: employee.personalInfo.email, token };
  },
});

// Cancel invitation
export const cancelInvitation = mutation({
  args: {
    invitationId: v.id("invitations"),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    const { membership } = await requireActiveMembership(
      ctx,
      invitation.organizationId,
    );
    const userRole = membership.role;

    // Owner has all admin privileges - treat owner the same as admin
    const isOwnerOrAdmin = userRole === "admin" || userRole === "owner";
    const isAuthorized = isOwnerOrAdmin || userRole === "hr";

    if (!isAuthorized) {
      throw new Error("Not authorized");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only cancel pending invitations");
    }

    await ctx.db.patch(args.invitationId, {
      status: "cancelled",
    });

    return { success: true };
  },
});
