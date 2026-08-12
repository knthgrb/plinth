import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthenticatedContext = Pick<QueryCtx | MutationCtx, "auth">;
type DatabaseContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;

export async function requireIdentity(
  ctx: AuthenticatedContext,
): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  return identity;
}

export async function requireUserRecord(
  ctx: DatabaseContext,
): Promise<Doc<"users">> {
  const identity = await requireIdentity(ctx);
  if (!identity.email) {
    throw new Error("Authenticated identity is missing an email address");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (query) => query.eq("email", identity.email!))
    .unique();
  if (!user || user.isActive === false) {
    throw new Error("Not authorized");
  }

  return user;
}

export async function requireMasterAdmin(
  ctx: DatabaseContext,
): Promise<Doc<"users">> {
  const user = await requireUserRecord(ctx);
  if (user.masterRole !== "super_admin") {
    throw new Error("Not authorized");
  }

  return user;
}

export async function requireActiveMembership(
  ctx: DatabaseContext,
  organizationId: Id<"organizations">,
): Promise<{
  user: Doc<"users">;
  membership: Doc<"userOrganizations">;
}> {
  const user = await requireUserRecord(ctx);
  const membership = await ctx.db
    .query("userOrganizations")
    .withIndex("by_user_organization", (query) =>
      query.eq("userId", user._id).eq("organizationId", organizationId),
    )
    .unique();

  if (!membership || (membership.accessStatus ?? "active") !== "active") {
    throw new Error("Not authorized");
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status === "archived") {
    throw new Error("Not authorized");
  }

  return { user, membership };
}
