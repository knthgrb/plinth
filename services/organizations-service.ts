import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class OrganizationsService {
  static async getDefaultRequirements(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.query as any)(
      (api as any).organizations.getDefaultRequirements,
      {
        organizationId: organizationId as Id<"organizations">,
      }
    );
  }

  static async updateDefaultRequirements(
    organizationId: string,
    requirements: Array<{ type: string; isRequired?: boolean }>
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).organizations.updateDefaultRequirements,
      {
        organizationId: organizationId as Id<"organizations">,
        requirements,
      }
    );
  }

  static async syncDefaultRequirementsToEmployees(organizationId: string) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).employees.syncDefaultRequirementsToEmployees,
      {
        organizationId: organizationId as Id<"organizations">,
      }
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
    return await (convex.mutation as any)(
      (api as any).organizations.createOrganization,
      data
    );
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
    return await (convex.mutation as any)(
      (api as any).organizations.updateOrganization,
      {
        organizationId: organizationId as Id<"organizations">,
        ...data,
      }
    );
  }

  static async removeUserFromOrganization(
    organizationId: string,
    userId: string
  ) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).organizations.removeUserFromOrganization,
      {
        organizationId: organizationId as Id<"organizations">,
        userId: userId as Id<"users">,
      }
    );
  }

  static async updateUserRoleInOrganization(data: {
    organizationId: string;
    userId: string;
    role: "admin" | "hr" | "employee";
  }) {
    const convex = await getAuthedConvexClient();
    return await (convex.mutation as any)(
      (api as any).organizations.updateUserRoleInOrganization,
      {
        ...data,
        organizationId: data.organizationId as Id<"organizations">,
        userId: data.userId as Id<"users">,
      }
    );
  }
}
