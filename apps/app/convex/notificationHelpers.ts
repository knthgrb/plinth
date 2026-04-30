import type { Id } from "./_generated/dataModel";

export async function getUserIdsForLeaveApprovers(
  ctx: { db: any },
  organizationId: Id<"organizations">,
): Promise<Id<"users">[]> {
  const rows = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .collect();
  const approverRoles = new Set(["owner", "admin", "hr"]);
  const seen = new Set<string>();
  const out: Id<"users">[] = [];
  for (const r of rows) {
    if (!approverRoles.has((r as { role: string }).role)) continue;
    const uid = String((r as { userId: Id<"users"> }).userId);
    if (seen.has(uid)) continue;
    seen.add(uid);
    out.push((r as { userId: Id<"users"> }).userId);
  }
  return out;
}

export async function getUserIdForEmployeeInOrg(
  ctx: { db: any },
  organizationId: Id<"organizations">,
  employeeId: Id<"employees">,
): Promise<Id<"users"> | null> {
  const rows = await (ctx.db.query("userOrganizations") as any)
    .withIndex("by_organization", (q: any) =>
      q.eq("organizationId", organizationId),
    )
    .filter((f: any) => f.eq(f.field("employeeId"), employeeId))
    .collect();
  const u = (rows[0] as { userId?: Id<"users"> } | undefined)?.userId;
  return u ?? null;
}

export type InsertInAppNotificationArgs = {
  userId: Id<"users">;
  organizationId: Id<"organizations">;
  type: "leave_submitted" | "leave_approved" | "leave_rejected" | "payslip_ready";
  title: string;
  body?: string;
  pathAfterOrg: string;
  leaveRequestId?: Id<"leaveRequests">;
  payslipId?: Id<"payslips">;
  payrollRunId?: Id<"payrollRuns">;
};

export async function insertInAppNotification(
  ctx: { db: any },
  args: InsertInAppNotificationArgs,
) {
  const now = Date.now();
  return await ctx.db.insert("notifications", {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    title: args.title,
    body: args.body,
    read: false,
    createdAt: now,
    pathAfterOrg: args.pathAfterOrg,
    leaveRequestId: args.leaveRequestId,
    payslipId: args.payslipId,
    payrollRunId: args.payrollRunId,
  });
}
