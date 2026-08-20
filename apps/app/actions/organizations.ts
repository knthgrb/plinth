"use server";

import { OrganizationsService } from "@/services/organizations-service";
import type { OrganizationRole } from "@/utils/organization-roles";
import type { SeparationType } from "@/utils/employment-lifecycle";

type DefaultRequirementPolicy = {
  type: string;
  isRequired?: boolean;
  appliesToDepartments?: string[];
  appliesToEmploymentTypes?: string[];
  reminderDaysBeforeDue?: number;
  requiresVerification?: boolean;
  expiryDaysAfterSubmission?: number;
};

export async function getDefaultRequirements(organizationId: string) {
  return OrganizationsService.getDefaultRequirements(organizationId);
}

export async function updateDefaultRequirements(
  organizationId: string,
  requirements: DefaultRequirementPolicy[],
) {
  return OrganizationsService.updateDefaultRequirements(
    organizationId,
    requirements,
  );
}

export async function createOrganization(data: {
  name: string;
  address?: string;
  phone?: string;
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
    taxId?: string;
  },
) {
  return OrganizationsService.updateOrganization(organizationId, data);
}

export async function removeUserFromOrganization(
  organizationId: string,
  userId: string,
  separation?: {
    type: SeparationType;
    effectiveAt: number;
    reason?: string;
    notes?: string;
  },
) {
  return OrganizationsService.removeUserFromOrganization(
    organizationId,
    userId,
    separation,
  );
}

export async function suspendOrganizationMember(data: {
  organizationId: string;
  userId: string;
  reason: string;
}) {
  return OrganizationsService.suspendOrganizationMember(data);
}

export async function restoreOrganizationMemberAccess(data: {
  organizationId: string;
  userId: string;
  role?: OrganizationRole;
}) {
  return OrganizationsService.restoreOrganizationMemberAccess(data);
}

export async function updateUserRoleInOrganization(data: {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}) {
  return OrganizationsService.updateUserRoleInOrganization(data);
}

export async function deleteOrganization(organizationId: string) {
  return OrganizationsService.deleteOrganization(organizationId);
}
