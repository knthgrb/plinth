"use server";

import { InvitationsService } from "@/services/invitations-service";

export async function createInvitation(data: {
  organizationId: string;
  email: string;
  role: "admin" | "hr" | "accounting" | "employee";
  employeeId?: string;
}) {
  return InvitationsService.createInvitation(data);
}

export async function resendInvitation(invitationId: string) {
  return InvitationsService.resendInvitation(invitationId);
}
