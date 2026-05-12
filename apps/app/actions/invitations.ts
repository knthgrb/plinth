"use server";

import { InvitationsService } from "@/services/invitations-service";
import { getConvexUserFacingMessage } from "@/lib/convex-user-facing-error";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export type InviteRecipientPreview = {
  inviteEmail: string;
  existingConvexUser: { name: string | null; email: string } | null;
  alreadyInOrg: boolean;
  needsConfirmForExistingUser: boolean;
  employeeWillBeRenamedToMatchAccount: boolean;
  employeeCurrentDisplayName?: string;
};

export type PreviewInviteRecipientResult =
  | { ok: true; preview: InviteRecipientPreview }
  | { ok: false; error: string };

export async function previewInviteRecipient(data: {
  organizationId: string;
  email?: string;
  employeeId?: string;
}): Promise<PreviewInviteRecipientResult> {
  try {
    const convex = await getAuthedConvexClient();
    const preview = await convex.query(
      api.invitations.getInviteRecipientPreview,
      {
        organizationId: data.organizationId as Id<"organizations">,
        email: data.email?.trim() || undefined,
        employeeId: data.employeeId
          ? (data.employeeId as Id<"employees">)
          : undefined,
      },
    );
    return { ok: true, preview };
  } catch (e: unknown) {
    return { ok: false, error: getConvexUserFacingMessage(e) };
  }
}

export type CreateInvitationResult =
  | { ok: true; invitationId: string }
  | { ok: false; error: string };

export async function createInvitation(data: {
  organizationId: string;
  email: string;
  role: "admin" | "hr" | "accounting" | "employee";
  employeeId?: string;
  confirmInviteToExistingPlinthUser?: boolean;
}): Promise<CreateInvitationResult> {
  try {
    const invitationId = await InvitationsService.createInvitation(data);
    return { ok: true, invitationId: String(invitationId) };
  } catch (e: unknown) {
    return { ok: false, error: getConvexUserFacingMessage(e) };
  }
}

export type ResendInvitationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function resendInvitation(
  invitationId: string,
): Promise<ResendInvitationResult> {
  try {
    await InvitationsService.resendInvitation(invitationId);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: getConvexUserFacingMessage(e) };
  }
}
