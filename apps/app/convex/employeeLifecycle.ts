import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type LifecycleEventType =
  | "hired"
  | "resigned"
  | "terminated"
  | "rehired";

type EmploymentSnapshot = Pick<
  Doc<"employees">["employment"],
  "position" | "department" | "employmentType"
>;

export async function cancelPendingEmployeeInvitations(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<void> {
  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_organization", (query) =>
      query.eq("organizationId", organizationId),
    )
    .filter((query) =>
      query.and(
        query.eq(query.field("employeeId"), employeeId),
        query.eq(query.field("status"), "pending"),
      ),
    )
    .collect();

  await Promise.all(
    invitations.map((invitation) =>
      ctx.db.patch(invitation._id, {
        status: "cancelled",
      }),
    ),
  );
}

export async function recordEmployeeLifecycleEvent(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    employeeId: Id<"employees">;
    type: LifecycleEventType;
    effectiveAt: number;
    employment: EmploymentSnapshot;
    reason?: string;
    recordedBy: Id<"users">;
    createdAt?: number;
  },
): Promise<Id<"employeeLifecycleEvents">> {
  return ctx.db.insert("employeeLifecycleEvents", {
    organizationId: args.organizationId,
    employeeId: args.employeeId,
    type: args.type,
    effectiveAt: args.effectiveAt,
    position: args.employment.position,
    department: args.employment.department,
    employmentType: args.employment.employmentType,
    reason: args.reason,
    recordedBy: args.recordedBy,
    createdAt: args.createdAt ?? Date.now(),
  });
}

export async function ensureEmployeeLifecycleBaseline(
  ctx: MutationCtx,
  employee: Doc<"employees">,
  recordedBy: Id<"users">,
): Promise<void> {
  const existing = await ctx.db
    .query("employeeLifecycleEvents")
    .withIndex("by_employee_effective_at", (query) =>
      query.eq("employeeId", employee._id),
    )
    .first();
  if (existing) return;

  await recordEmployeeLifecycleEvent(ctx, {
    organizationId: employee.organizationId,
    employeeId: employee._id,
    type: "hired",
    effectiveAt: employee.employment.hireDate,
    employment: employee.employment,
    recordedBy,
    createdAt: employee.createdAt,
  });

  if (
    employee.employment.status === "resigned" ||
    employee.employment.status === "terminated"
  ) {
    await recordEmployeeLifecycleEvent(ctx, {
      organizationId: employee.organizationId,
      employeeId: employee._id,
      type: employee.employment.status,
      effectiveAt:
        employee.employment.separationDate ??
        employee.employment.lastWorkingDay ??
        employee.updatedAt,
      employment: employee.employment,
      reason: employee.employment.separationReason,
      recordedBy,
      createdAt: employee.updatedAt,
    });
  }
}
