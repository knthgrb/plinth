import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { sendEmail } from "@/lib/email";
import { generateInvitationEmail } from "@/helpers/email-templates";

export class InvitationsService {
  static async createInvitation(data: {
    organizationId: string;
    email: string;
    role: "admin" | "hr" | "accounting" | "employee";
    employeeId?: string;
    confirmInviteToExistingPlinthUser?: boolean;
  }) {
    const convex = await getAuthedConvexClient();

    // Create invitation in Convex
    const invitationId = await (convex.mutation as any)(
      (api as any).invitations.createInvitation,
      {
        organizationId: data.organizationId as Id<"organizations">,
        email: data.email,
        role: data.role,
        employeeId: data.employeeId as Id<"employees"> | undefined,
        confirmInviteToExistingPlinthUser:
          data.confirmInviteToExistingPlinthUser === true ? true : undefined,
      },
    );

    // Get invitation details to send email
    const invitation = await (convex.query as any)(
      (api as any).invitations.getInvitationById,
      { invitationId: invitationId as Id<"invitations"> },
    );

    if (invitation) {
      // Generate invitation link
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const invitationLink = `${baseUrl}/invite/accept?token=${invitation.token}`;

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
      } catch (error: any) {
        console.error("Failed to send invitation email:", error);
        // Don't throw - invitation is created, email failure is logged
      }
    }

    return invitationId;
  }

  static async batchCreateInvitations(data: {
    organizationId: string;
    role: "admin" | "hr" | "accounting" | "employee";
    confirmInviteToExistingPlinthUser?: boolean;
    items: { email: string; employeeId?: string }[];
  }): Promise<{
    createdInvitationIds: string[];
    skipped: { email: string; reason: string }[];
    needsConfirmForEmails: string[];
  }> {
    const convex = await getAuthedConvexClient();

    const result = (await (convex.mutation as any)(
      (api as any).invitations.batchCreateInvitations,
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
    )) as {
      created: { invitationId: Id<"invitations">; email: string }[];
      skipped: { email: string; reason: string }[];
      needsConfirmForEmails: string[];
    };

    const sendOne = async (invitationId: Id<"invitations">, toEmail: string) => {
      const invitation = await (convex.query as any)(
        api.invitations.getInvitationById,
        { invitationId },
      );
      if (!invitation) return;
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        "http://localhost:3000";
      const invitationLink = `${baseUrl}/invite/accept?token=${invitation.token}`;
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
      result.created.map((c) => sendOne(c.invitationId, c.email)),
    );

    return {
      createdInvitationIds: result.created.map((c) => String(c.invitationId)),
      skipped: result.skipped,
      needsConfirmForEmails: result.needsConfirmForEmails,
    };
  }

  static async resendInvitation(invitationId: string) {
    const convex = await getAuthedConvexClient();

    const invitation = await (convex.query as any)(
      (api as any).invitations.getInvitationById,
      { invitationId: invitationId as Id<"invitations"> },
    );

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only resend pending invitations");
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      "http://localhost:3000";
    const invitationLink = `${baseUrl}/invite/accept?token=${invitation.token}`;

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
