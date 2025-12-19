"use server";

import { OrganizationsService } from "@/services/organizations-service";

export async function getDefaultRequirements(organizationId: string) {
  return OrganizationsService.getDefaultRequirements(organizationId);
}

export async function updateDefaultRequirements(
  organizationId: string,
  requirements: Array<{ type: string; isRequired?: boolean }>
) {
  return OrganizationsService.updateDefaultRequirements(organizationId, requirements);
}

export async function syncDefaultRequirementsToEmployees(
  organizationId: string
) {
  return OrganizationsService.syncDefaultRequirementsToEmployees(organizationId);
}

export async function createOrganization(data: {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  taxId?: string;
}) {
  return OrganizationsService.createOrganization(data);
}

export async function updateOrganization(
  organizationId: string,
  data: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    taxId?: string;
  }
) {
  return OrganizationsService.updateOrganization(organizationId, data);
}

export async function addUserToOrganization(data: {
  organizationId: string;
  email: string;
  role: "admin" | "hr" | "accounting" | "employee";
  employeeId?: string;
}) {
  // Use server action that handles both invitation creation and email sending
  const { createInvitation } = await import("./invitations");
  return await createInvitation(data);
}

export async function removeUserFromOrganization(
  organizationId: string,
  userId: string
) {
  return OrganizationsService.removeUserFromOrganization(organizationId, userId);
}

export async function updateUserRoleInOrganization(data: {
  organizationId: string;
  userId: string;
  role: "admin" | "hr" | "employee";
}) {
  return OrganizationsService.updateUserRoleInOrganization(data);
}
