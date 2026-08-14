import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireActiveMembership } from "./access";

type LeaveAccessContext = Pick<QueryCtx | MutationCtx, "auth" | "db">;
type LeaveReviewRole = Doc<"userOrganizations">["role"];
type ReviewerEmployeeIdentifier = string | undefined;

export type LeaveReviewDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "Owner, Admin, or HR approval is required"
        | "You cannot approve your own leave request";
    };

export function canAdministerLeave(role: LeaveReviewRole): boolean {
  return role === "owner" || role === "admin" || role === "hr";
}

export function canReviewLeave({
  role,
  reviewerEmployeeId,
  requestEmployeeId,
}: {
  role: LeaveReviewRole;
  reviewerEmployeeId: ReviewerEmployeeIdentifier;
  requestEmployeeId: string;
}): LeaveReviewDecision {
  if (!canAdministerLeave(role)) {
    return {
      allowed: false,
      reason: "Owner, Admin, or HR approval is required",
    };
  }

  if (reviewerEmployeeId === requestEmployeeId) {
    return {
      allowed: false,
      reason: "You cannot approve your own leave request",
    };
  }

  return { allowed: true };
}

export function canViewSensitiveLeave({
  isRequestEmployee,
  hasActiveGrant,
}: {
  isRequestEmployee: boolean;
  hasActiveGrant: boolean;
}): boolean {
  return isRequestEmployee || hasActiveGrant;
}

export async function requireLeaveSelfService(
  ctx: LeaveAccessContext,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<Awaited<ReturnType<typeof requireActiveMembership>>> {
  const access = await requireActiveMembership(ctx, organizationId);
  if (access.membership.employeeId !== employeeId) {
    throw new Error("Not authorized");
  }

  return access;
}

export async function requireFinalLeaveReviewer(
  ctx: LeaveAccessContext,
  leaveRequestId: Id<"leaveRequests">,
): Promise<
  Awaited<ReturnType<typeof requireActiveMembership>> & {
    request: Doc<"leaveRequests">;
  }
> {
  const request = await ctx.db.get(leaveRequestId);
  if (!request) {
    throw new Error("Leave request not found");
  }

  const access = await requireActiveMembership(ctx, request.organizationId);
  const decision = canReviewLeave({
    role: access.membership.role,
    reviewerEmployeeId: access.membership.employeeId,
    requestEmployeeId: request.employeeId,
  });
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }

  return { ...access, request };
}

export async function requireSensitiveLeaveAccess(
  ctx: LeaveAccessContext,
  organizationId: Id<"organizations">,
  requestEmployeeId: Id<"employees">,
): Promise<Awaited<ReturnType<typeof requireActiveMembership>>> {
  const access = await requireActiveMembership(ctx, organizationId);
  const grant = await ctx.db
    .query("leaveSensitiveAccessGrants")
    .withIndex("by_membership_active", (query) =>
      query.eq("membershipId", access.membership._id).eq("isActive", true),
    )
    .filter((query) => query.eq(query.field("organizationId"), organizationId))
    .first();

  if (
    !canViewSensitiveLeave({
      isRequestEmployee: access.membership.employeeId === requestEmployeeId,
      hasActiveGrant: grant !== null,
    })
  ) {
    throw new Error("Not authorized");
  }

  return access;
}
