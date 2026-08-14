import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import type { OrganizationRole } from "@/utils/organization-roles";

type DefaultRequirementPolicy = {
  type: string;
  isRequired?: boolean;
  appliesToDepartments?: string[];
  appliesToEmploymentTypes?: string[];
  reminderDaysBeforeDue?: number;
  requiresVerification?: boolean;
  expiryDaysAfterSubmission?: number;
};

export class OrganizationsService {
  static async getDefaultRequirements(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await convex.query(api.organizations.getDefaultRequirements, {
        organizationId: organizationId as Id<"organizations">,
      });
  }

  static async updateDefaultRequirements(
    organizationId: string,
    requirements: DefaultRequirementPolicy[]
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.organizations.updateDefaultRequirements,
      {
        organizationId: organizationId as Id<"organizations">,
        requirements,
      },
    );
  }

  static async createOrganization(data: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    taxId?: string;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(api.organizations.createOrganization, data);
  }

  static async updateOrganization(
    organizationId: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      email?: string;
      taxId?: string;
    }
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.organizations.updateOrganization,
      {
        organizationId: organizationId as Id<"organizations">,
        ...data,
      },
    );
  }

  static async removeUserFromOrganization(
    organizationId: string,
    userId: string
  ) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.organizations.removeUserFromOrganization,
      {
        organizationId: organizationId as Id<"organizations">,
        userId: userId as Id<"users">,
      },
    );
  }

  static async updateUserRoleInOrganization(data: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
  }) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.organizations.updateUserRoleInOrganization,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        userId: data.userId as Id<"users">,
      },
    );
  }

  static async deleteOrganization(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await convex.mutation(
      api.organizations.deleteOrganization,
      {
        organizationId: organizationId as Id<"organizations">,
      },
    );
  }
}
