import { randomBytes } from "@noble/ciphers/utils.js";
import { bytesToBase64 } from "./binaryBase64";
import { hashInvitationToken } from "./invitationTokenHash";
import { findUserByEmail, normalizeUserEmail } from "./userEmail";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export function createInvitationToken(): string {
  return bytesToBase64(randomBytes(32))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function createEmployeeLinkedInvitation(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    email: string;
    invitedBy: Id<"users">;
    inviteeName: string;
  },
): Promise<{
  invitationId: Id<"invitations">;
  email: string;
  token: string;
}> {
  const email = args.email.trim();
  const normalizedEmail = normalizeUserEmail(email);
  if (!normalizedEmail || !email.includes("@")) {
    throw new Error("A valid invitation email is required");
  }

  const existingUser = await findUserByEmail(ctx, email);
  if (existingUser) {
    const existingMembership = await ctx.db
      .query("userOrganizations")
      .withIndex("by_user_organization", (query) =>
        query
          .eq("userId", existingUser._id)
          .eq("organizationId", args.organizationId),
      )
      .first();
    if (existingMembership) {
      throw new Error(
        "This account already belongs to the organization; link the existing member instead",
      );
    }
  }

  const organizationInvitations = await ctx.db
    .query("invitations")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", args.organizationId),
    )
    .collect();
  const hasPendingInvitation = organizationInvitations.some(
    (invitation) =>
      invitation.status === "pending" &&
      normalizeUserEmail(invitation.email) === normalizedEmail,
  );
  if (hasPendingInvitation) {
    throw new Error("A pending invitation already exists for this email");
  }

  const now = Date.now();
  const token = createInvitationToken();
  const invitationId = await ctx.db.insert("invitations", {
    organizationId: args.organizationId,
    employeeId: args.employeeId,
    email,
    role: "employee",
    invitedBy: args.invitedBy,
    inviteeName: args.inviteeName,
    tokenHash: hashInvitationToken(token),
    status: "pending",
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
  });

  return { invitationId, email, token };
}
