import { api } from "@/convex/_generated/api";
import { getAuthedConvexClient } from "@/lib/convex-client";

export class UserService {
  static async getUserRoleAndOrg() {
    const convex = await getAuthedConvexClient();

    // Ensure user record exists (best-effort)
    try {
      await (convex.mutation as any)(
        (api as any).organizations.ensureUserRecord,
        {
          // no args
        }
      );
    } catch (error) {
      // non-fatal; queries below will surface real errors if any
      console.log("User record sync attempt:", error);
    }

    const organizations = await (convex.query as any)(
      (api as any).organizations.getUserOrganizations,
      {}
    );

    if (!organizations || organizations.length === 0) {
      return { role: null, organizationId: null };
    }

    const orgId = organizations[0]?._id;
    if (!orgId) {
      return { role: null, organizationId: null };
    }

    const user = await (convex.query as any)(
      (api as any).organizations.getCurrentUser,
      {
        organizationId: orgId,
      }
    );

    if (!user) {
      return { role: null, organizationId: orgId };
    }

    return { role: user.role || null, organizationId: orgId };
  }
}
