import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthedConvexClient } from "@/lib/convex-client";
import { selectPreferredOrganizationForEntry } from "@/utils/org-membership-lifecycle";

export class UserService {
  static async getUserRoleAndOrg(
    organizationId?: string,
    incomingHeaders?: Headers,
  ): Promise<{
    role: string | null;
    organizationId: string | null;
    accessStatus: string | null;
  }> {
    const convex = await getAuthedConvexClient(incomingHeaders);
    const requestedOrganizationId =
      organizationId && /^[a-z0-9]{20,}$/.test(organizationId)
        ? (organizationId as Id<"organizations">)
        : undefined;

    if (!requestedOrganizationId) {
      const organizations = await convex.query(
        api.organizations.getUserOrganizations,
        {},
      );
      const organization = selectPreferredOrganizationForEntry(organizations);
      return {
        role: organization?.role ?? null,
        organizationId: organization?._id ?? null,
        accessStatus: organization?.accessStatus ?? null,
      };
    }

    const user = await convex.query(api.organizations.getCurrentUser, {
      organizationId: requestedOrganizationId,
    });

    if (!user) {
      return {
        role: null,
        organizationId: requestedOrganizationId ?? null,
        accessStatus: null,
      };
    }

    return {
      role: user.role ?? null,
      organizationId: user.organization._id,
      accessStatus: user.accessStatus ?? null,
    };
  }
}
