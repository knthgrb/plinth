import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { sendEmail } from "@/lib/email";
import { generateInvitationEmail } from "@/helpers/email-templates";
import type { OrganizationRole } from "@/utils/organization-roles";

export class InvitationsService {
  static async createInvitation(data: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    employeeId?: string;
    confirmInviteToExistingPlinthUser?: boolean;
  }) {
    const convex = await getAuthedConvexClient();

    // Create invitation in Convex
    const created = await convex.mutation(api.invitations.createInvitation, {
      organizationId: data.organizationId as Id<"organizations">,
      email: data.email,
      role: data.role,
      employeeId: data.employeeId as Id<"employees"> | undefined,
      confirmInviteToExistingPlinthUser:
        data.confirmInviteToExistingPlinthUser === true ? true : undefined,
    });

    // Get invitation details to send email
    const invitation = await convex.query(api.invitations.getInvitationById, {
      invitationId: created.invitationId,
    });

    if (invitation?.organization && invitation.inviter) {
      // Generate invitation link
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const invitationLink = `${baseUrl}/invite/accept?token=${created.token}`;

      // Send email
      const emailContent = generateInvitationEmail(
        invitation.organization.name,
        invitation.inviter.name || invitation.inviter.email,
        invitation.role,
        invitationLink,
      );

      try {
        await sendEmail({
          to: data.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } catch (error: unknown) {
        console.error("Failed to send invitation email:", error);
        // Don't throw - invitation is created, email failure is logged
      }
    }

    return created.invitationId;
  }

  static async batchCreateInvitations(data: {
    organizationId: string;
    role: OrganizationRole;
    confirmInviteToExistingPlinthUser?: boolean;
    items: { email: string; employeeId?: string }[];
  }): Promise<{
    createdInvitationIds: string[];
    skipped: { email: string; reason: string }[];
    needsConfirmForEmails: string[];
  }> {
    const convex = await getAuthedConvexClient();

    const result = await convex.mutation(
      api.invitations.batchCreateInvitations,
      {
        organizationId: data.organizationId as Id<"organizations">,
        role: data.role,
        confirmInviteToExistingPlinthUser:
          data.confirmInviteToExistingPlinthUser === true ? true : undefined,
        items: data.items.map((i) => ({
          email: i.email.trim(),
          employeeId: i.employeeId
            ? (i.employeeId as Id<"employees">)
            : undefined,
        })),
      },
    );

    const sendOne = async (
      invitationId: Id<"invitations">,
      toEmail: string,
      token: string,
    ) => {
      const invitation = await convex.query(
        api.invitations.getInvitationById,
        { invitationId },
      );
      if (!invitation?.organization || !invitation.inviter) return;
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const invitationLink = `${baseUrl}/invite/accept?token=${token}`;
      const emailContent = generateInvitationEmail(
        invitation.organization.name,
        invitation.inviter.name || invitation.inviter.email,
        invitation.role,
        invitationLink,
      );
      try {
        await sendEmail({
          to: toEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } catch (error: unknown) {
        console.error("Failed to send invitation email:", error);
      }
    };

    await Promise.all(
      result.created.map((c) => sendOne(c.invitationId, c.email, c.token)),
    );

    return {
      createdInvitationIds: result.created.map((c) => String(c.invitationId)),
      skipped: result.skipped,
      needsConfirmForEmails: result.needsConfirmForEmails,
    };
  }

  static async resendInvitation(invitationId: string) {
    const convex = await getAuthedConvexClient();

    const typedInvitationId = invitationId as Id<"invitations">;
    const rotated = await convex.mutation(api.invitations.resendInvitation, {
      invitationId: typedInvitationId,
    });
    const invitation = await convex.query(api.invitations.getInvitationById, {
      invitationId: typedInvitationId,
    });

    if (!invitation?.organization || !invitation.inviter) {
      throw new Error("Invitation not found");
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      "http://localhost:3000";
    const invitationLink = `${baseUrl}/invite/accept?token=${rotated.token}`;

    const emailContent = generateInvitationEmail(
      invitation.organization.name,
      invitation.inviter.name || invitation.inviter.email,
      invitation.role,
      invitationLink,
    );

    await sendEmail({
      to: invitation.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return { success: true };
  }
}
